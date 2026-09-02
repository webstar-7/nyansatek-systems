/* ============================================================
   POST /.netlify/functions/renew-subscription
   Body: { reference, tenantProduct, tenantId }

   Called from INSIDE pos.html / School's app (not the storefront)
   when an admin clicks "Renew Now" -- e.g. paying ahead of the
   automatic renewal date. Verifies the payment directly with
   Paystack (never trusts the client), then extends paid_through_date
   from the tenant's CURRENT due date (not from today) -- so an early
   payment doesn't shift their regular cycle forward, it just tops it
   up. This matches the "early renewal" rule agreed for this project.
   ============================================================ */

const { CATALOG } = require("./_catalog");
const { getSupabaseFor, getJobsClient } = require("./_supabase");
const { addCycle, generateCommissions } = require("./_lib/billing");
const { corsHeaders, handlePreflight } = require("./_lib/cors");

const TENANT_TABLES = { pos: "organizations", school: "institutions" };

exports.handler = async (event) => {
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  const headers = corsHeaders(event.headers.origin);
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: "Method not allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { reference, tenantProduct, tenantId } = body;
  if (!reference || !tenantProduct || !tenantId || !TENANT_TABLES[tenantProduct]) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing or invalid fields" }) };
  }

  const jobsDb = getJobsClient();
  const db = getSupabaseFor(tenantProduct);
  const table = TENANT_TABLES[tenantProduct];

  try {
    // ---- idempotency, same pattern as verify-and-provision.js ----
    const { data: existing } = await jobsDb.from("subscription_renewals").select("*").eq("reference", reference).maybeSingle();
    if (existing) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, alreadyHandled: true }) };
    }

    const { data: tenant } = await db.from(table).select("*").eq("id", tenantId).maybeSingle();
    if (!tenant) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Tenant not found" }) };
    }

    const catalogPlan = CATALOG[tenantProduct] && CATALOG[tenantProduct].plans[tenant.plan_key];
    if (!catalogPlan) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "No matching catalog plan" }) };
    }

    // ---- verify directly with Paystack -- never trust the client ----
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });
    const verifyJson = await verifyRes.json();
    const txn = verifyJson.data;

    const isValid = verifyJson.status === true && txn && txn.status === "success" && txn.currency === "GHS" && txn.amount === catalogPlan.price;

    await jobsDb.from("subscription_renewals").insert({
      tenant_product: tenantProduct,
      tenant_id: tenantId,
      reference,
      event_type: "renewal",
      channel: txn && txn.channel === "card" ? "card" : "momo",
      amount: catalogPlan.price / 100,
      status: isValid ? "success" : "failed",
      error: isValid ? null : `verification failed: paystack_amount=${txn && txn.amount} expected=${catalogPlan.price}`,
    });

    if (!isValid) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Payment verification failed" }) };
    }

    // Extend from the CURRENT due date, not today -- paying early tops
    // up the existing cycle rather than shifting it forward.
    const newPaidThrough = addCycle(tenant.paid_through_date || new Date(), catalogPlan.cycle);
    await db.from(table).update({ paid_through_date: newPaidThrough, subscription_status: "active" }).eq("id", tenantId);

    if (tenant.sales_agent_id) {
      try {
        await generateCommissions(jobsDb, {
          tenantProduct,
          tenantId,
          agentId: tenant.sales_agent_id,
          reference,
          plan: tenant.plan_key,
          amountPaidGHS: catalogPlan.price / 100,
          eventType: "renewal",
        });
      } catch (commissionErr) {
        console.error("Renewal commission generation failed (non-fatal):", commissionErr);
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, paidThroughDate: newPaidThrough }) };
  } catch (err) {
    console.error("renew-subscription error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Internal error" }) };
  }
};

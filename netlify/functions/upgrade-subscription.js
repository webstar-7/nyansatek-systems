/* ============================================================
   POST /.netlify/functions/upgrade-subscription
   Body: { reference, tenantProduct, tenantId }

   Called from INSIDE pos.html / School's app when an admin upgrades
   monthly -> yearly. No proration: charges the yearly price now,
   resets paid_through_date to start from today (agreed as the
   simplest, clearest approach for this project). If they were on a
   card subscription, the old monthly one is canceled and a fresh
   yearly one created -- Paystack has no "change interval" operation,
   subscriptions are tied to a fixed plan.
   ============================================================ */

const { CATALOG } = require("./_catalog");
const { getSupabaseFor, getJobsClient } = require("./_supabase");
const { addCycle, createCardSubscription, cancelCardSubscription, generateCommissions } = require("./_lib/billing");
const { corsHeaders, handlePreflight } = require("./_lib/cors");

const TENANT_TABLES = { pos: "organizations", school: "institutions" };

// Store count/student count limits are derived from plan, same logic
// as the provisioners -- kept in sync manually since these live in
// separate repos. See _provisioners/pos.js and _provisioners/school.js.
function computeLimitsForUpgrade(tenantProduct) {
  if (tenantProduct === "pos") return { max_stores: 3 }; // already unconditional -- see pos.js
  if (tenantProduct === "school") return { max_students: 800 }; // yearly always means 800 -- see school.js
  return {};
}

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
    const { data: existing } = await jobsDb.from("subscription_renewals").select("*").eq("reference", reference).maybeSingle();
    if (existing) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, alreadyHandled: true }) };
    }

    const { data: tenant } = await db.from(table).select("*").eq("id", tenantId).maybeSingle();
    if (!tenant) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Tenant not found" }) };
    }
    if (tenant.plan_key === "yearly") {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Already on the yearly plan" }) };
    }

    const yearlyPlan = CATALOG[tenantProduct] && CATALOG[tenantProduct].plans.yearly;
    if (!yearlyPlan) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "No yearly catalog plan found" }) };
    }

    // ---- verify directly with Paystack, against the YEARLY price ----
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });
    const verifyJson = await verifyRes.json();
    const txn = verifyJson.data;

    const isValid = verifyJson.status === true && txn && txn.status === "success" && txn.currency === "GHS" && txn.amount === yearlyPlan.price;

    await jobsDb.from("subscription_renewals").insert({
      tenant_product: tenantProduct,
      tenant_id: tenantId,
      reference,
      event_type: "upgrade",
      channel: txn && txn.channel === "card" ? "card" : "momo",
      amount: yearlyPlan.price / 100,
      status: isValid ? "success" : "failed",
      error: isValid ? null : `verification failed: paystack_amount=${txn && txn.amount} expected=${yearlyPlan.price}`,
    });

    if (!isValid) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Payment verification failed" }) };
    }

    // No proration -- reset to start fresh from today, per the agreed rule.
    const newPaidThrough = addCycle(new Date(), "yearly");
    const limits = computeLimitsForUpgrade(tenantProduct);

    const update = {
      plan_key: "yearly",
      plan_cycle: "yearly",
      paid_through_date: newPaidThrough,
      subscription_status: "active",
      ...limits,
    };

    if (txn.channel === "card" && txn.authorization && txn.authorization.authorization_code) {
      // Retire the old monthly subscription (if any) so Paystack doesn't
      // keep charging it alongside the new yearly one.
      if (tenant.paystack_subscription_code) {
        try {
          await cancelCardSubscription(tenant.paystack_subscription_code);
        } catch (cancelErr) {
          console.error("Failed to cancel old monthly subscription (non-fatal, continuing with upgrade):", cancelErr);
        }
      }
      update.payment_channel = "card";
      update.paystack_authorization_code = txn.authorization.authorization_code;
      update.paystack_subscription_code = await createCardSubscription({
        email: tenant.contact_email || tenant.email,
        planCode: yearlyPlan.paystackPlanCode,
        authorizationCode: txn.authorization.authorization_code,
      });
    } else {
      update.payment_channel = "momo";
      // momo_phone/momo_provider stay as whatever was already on file
      // unless this payment used different details -- Paystack's verify
      // response doesn't reliably expose reusable momo details, so we
      // don't overwrite what's already stored from signup/checkout.
    }

    await db.from(table).update(update).eq("id", tenantId);

    if (tenant.sales_agent_id) {
      try {
        await generateCommissions(jobsDb, {
          tenantProduct,
          tenantId,
          agentId: tenant.sales_agent_id,
          reference,
          plan: "yearly",
          amountPaidGHS: yearlyPlan.price / 100,
          eventType: "upgrade",
        });
      } catch (commissionErr) {
        console.error("Upgrade commission generation failed (non-fatal):", commissionErr);
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, paidThroughDate: newPaidThrough }) };
  } catch (err) {
    console.error("upgrade-subscription error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Internal error" }) };
  }
};

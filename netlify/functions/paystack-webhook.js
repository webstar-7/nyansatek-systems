/* ============================================================
   POST /.netlify/functions/paystack-webhook
   Configure this URL in your Paystack dashboard under
   Settings → API Keys & Webhooks -- for BOTH Test and Live mode.

   Handles four distinct cases, all arriving as charge.success
   (or, for failures, invoice.payment_failed / charge.failed):

   1. Initial signup -- reference starts "NYT-" (set by checkout.js).
      Forwarded to verify-and-provision.js exactly as before.

   2. Our own MoMo renewal charge succeeding -- reference starts
      "RNW-" (set by charge-momo-renewals.js). Update paid_through_date,
      mark the renewal row success, generate commissions.

   3. A Paystack-subscription-driven CARD renewal succeeding --
      identified by a `plan` object in the payload (Paystack's own
      docs warn charge.success fires for these too, not just one-time
      charges). We match it to a tenant via paystack_subscription_code,
      since we don't control this reference format.

   4. A renewal failing -- invoice.payment_failed (card) or
      charge.failed (momo). Suspends that tenant's access immediately.
   ============================================================ */

const crypto = require("crypto");
const { CATALOG } = require("./_catalog");
const { getSupabaseFor, getJobsClient } = require("./_supabase");
const { addCycle, generateCommissions } = require("./_lib/billing");

const TENANT_TABLES = { pos: "organizations", school: "institutions" };

// Our own references are self-describing: RNW-{product}-{tenantId}-{timestamp}
function parseOwnReference(reference) {
  if (!reference || !reference.startsWith("RNW-")) return null;
  const parts = reference.split("-");
  if (parts.length < 3) return null;
  return { product: parts[1], tenantId: parts[2] };
}

// Paystack's own subscription references aren't ours to parse -- find the
// tenant by the subscription_code we stored at signup, checking both
// projects since the webhook doesn't tell us which product it's for.
async function findTenantBySubscriptionCode(subscriptionCode) {
  for (const product of ["pos", "school"]) {
    const db = getSupabaseFor(product);
    const table = TENANT_TABLES[product];
    const { data } = await db.from(table).select("*").eq("paystack_subscription_code", subscriptionCode).maybeSingle();
    if (data) return { product, tenant: data };
  }
  return null;
}

async function handleRenewalSuccess({ product, tenant, channel, reference }) {
  const db = getSupabaseFor(product);
  const table = TENANT_TABLES[product];
  const jobsDb = getJobsClient();
  const catalogPlan = CATALOG[product] && CATALOG[product].plans[tenant.plan_key];
  if (!catalogPlan) {
    console.error(`Renewal success but no catalog entry for ${product}/${tenant.plan_key}`);
    return;
  }

  const newPaidThrough = addCycle(tenant.paid_through_date || new Date(), catalogPlan.cycle);
  await db.from(table).update({ paid_through_date: newPaidThrough, subscription_status: "active" }).eq("id", tenant.id);

  await jobsDb
    .from("subscription_renewals")
    .update({ status: "success" })
    .eq("reference", reference);

  if (tenant.sales_agent_id) {
    try {
      await generateCommissions(jobsDb, {
        tenantProduct: product,
        tenantId: tenant.id,
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
}

async function handleRenewalFailure({ product, tenantId, reference, reason }) {
  const db = getSupabaseFor(product);
  const table = TENANT_TABLES[product];
  const jobsDb = getJobsClient();

  await db.from(table).update({ subscription_status: "suspended" }).eq("id", tenantId);
  await jobsDb
    .from("subscription_renewals")
    .update({ status: "failed", error: String(reason || "").slice(0, 500) })
    .eq("reference", reference);
}

exports.handler = async (event) => {
  const signature = event.headers["x-paystack-signature"];
  const secret = process.env.PAYSTACK_SECRET_KEY;

  const expected = crypto.createHmac("sha512", secret).update(event.body).digest("hex");
  if (signature !== expected) {
    return { statusCode: 401, body: "Invalid signature" };
  }

  const payload = JSON.parse(event.body);

  try {
    if (payload.event === "charge.success") {
      const { reference, metadata, plan } = payload.data;

      const ownRef = parseOwnReference(reference);

      if (reference && reference.startsWith("NYT-")) {
        // ---- Case 1: initial signup ----
        const baseUrl = process.env.URL || `https://${event.headers.host}`;
        await fetch(`${baseUrl}/.netlify/functions/verify-and-provision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reference,
            order: {
              product: metadata.product,
              plan: metadata.plan,
              businessName: metadata.businessName,
              ownerName: metadata.ownerName,
              phone: metadata.phone,
              email: payload.data.customer.email,
              location: metadata.location,
            },
          }),
        });
      } else if (ownRef) {
        // ---- Case 2: our own MoMo renewal charge succeeded ----
        const db = getSupabaseFor(ownRef.product);
        const table = TENANT_TABLES[ownRef.product];
        const { data: tenant } = await db.from(table).select("*").eq("id", ownRef.tenantId).maybeSingle();
        if (tenant) {
          await handleRenewalSuccess({ product: ownRef.product, tenant, channel: "momo", reference });
        }
      } else if (plan) {
        // ---- Case 3: Paystack-subscription-driven card renewal ----
        const subscriptionCode = plan.subscription_code || (payload.data.subscription && payload.data.subscription.subscription_code);
        const found = subscriptionCode ? await findTenantBySubscriptionCode(subscriptionCode) : null;
        if (found) {
          await handleRenewalSuccess({ product: found.product, tenant: found.tenant, channel: "card", reference });
        } else {
          console.error("charge.success had a plan object but no matching tenant found for subscription:", subscriptionCode);
        }
      }
      // Any other charge.success (e.g. a one-off test charge) is ignored.
    } else if (payload.event === "invoice.payment_failed") {
      // ---- Case 4a: card renewal failed ----
      const subscriptionCode = payload.data.subscription && payload.data.subscription.subscription_code;
      const found = subscriptionCode ? await findTenantBySubscriptionCode(subscriptionCode) : null;
      if (found) {
        await handleRenewalFailure({
          product: found.product,
          tenantId: found.tenant.id,
          reference: payload.data.reference || `card-fail-${found.tenant.id}`,
          reason: "invoice.payment_failed",
        });
      }
    } else if (payload.event === "charge.failed") {
      // ---- Case 4b: our own MoMo renewal charge failed / was declined ----
      const ownRef = parseOwnReference(payload.data.reference);
      if (ownRef) {
        await handleRenewalFailure({
          product: ownRef.product,
          tenantId: ownRef.tenantId,
          reference: payload.data.reference,
          reason: payload.data.gateway_response || "charge.failed",
        });
      }
    }
  } catch (err) {
    // Log but still return 200 -- see note below on why we never want
    // Paystack retrying a webhook that failed for a reason a retry won't fix.
    console.error("Webhook handling error:", err);
  }

  // Always 200 quickly so Paystack doesn't retry unnecessarily.
  return { statusCode: 200, body: "ok" };
};

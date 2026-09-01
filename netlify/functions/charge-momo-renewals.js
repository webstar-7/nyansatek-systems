/* ============================================================
   Scheduled function -- runs daily (see netlify.toml).

   Finds every MoMo-paying tenant (across BOTH Supabase projects)
   whose paid_through_date has arrived, and initiates that cycle's
   charge via Paystack's Charge API. This only STARTS the charge --
   MoMo payments complete offline (the customer approves via a PIN
   prompt on their phone), so the actual success/failure, the
   paid_through_date update, and commission generation all happen
   later in paystack-webhook.js when Paystack's webhook tells us
   what happened.

   Card renewals need NONE of this -- Paystack's own Subscriptions
   engine charges those silently on its own schedule.
   ============================================================ */

const { CATALOG } = require("./_catalog");
const { getSupabaseFor, getJobsClient } = require("./_supabase");
const { chargeMomo } = require("./_lib/billing");

const TENANT_TABLES = { pos: "organizations", school: "institutions" };

async function processProduct(product, jobsDb) {
  const db = getSupabaseFor(product);
  const table = TENANT_TABLES[product];
  const today = new Date().toISOString().split("T")[0];

  const { data: due, error } = await db
    .from(table)
    .select("*")
    .eq("payment_channel", "momo")
    .eq("subscription_status", "active")
    .lte("paid_through_date", today);

  if (error) {
    console.error(`Failed to fetch due ${product} tenants:`, error);
    return { attempted: 0, failed: 0 };
  }

  let attempted = 0;
  let failed = 0;

  for (const tenant of due || []) {
    const catalogPlan = CATALOG[product] && CATALOG[product].plans[tenant.plan_key];
    if (!catalogPlan) {
      console.error(`No catalog entry for ${product}/${tenant.plan_key} on tenant ${tenant.id} -- skipping`);
      continue;
    }
    if (!tenant.momo_phone || !tenant.momo_provider) {
      console.error(`Tenant ${tenant.id} is momo but missing phone/provider -- skipping`);
      continue;
    }

    attempted++;
    const reference = `RNW-${product}-${tenant.id}-${Date.now()}`;

    await jobsDb.from("subscription_renewals").insert({
      tenant_product: product,
      tenant_id: tenant.id,
      reference,
      event_type: "renewal",
      channel: "momo",
      amount: catalogPlan.price / 100,
      status: "pending",
    });

    try {
      const contactEmail = tenant.contact_email || tenant.email;
      const result = await chargeMomo({
        email: contactEmail,
        amountPesewas: catalogPlan.price,
        phone: tenant.momo_phone,
        provider: tenant.momo_provider,
        reference,
      });

      if (!result.ok) {
        failed++;
        await jobsDb
          .from("subscription_renewals")
          .update({ status: "failed", error: JSON.stringify(result.raw).slice(0, 500) })
          .eq("reference", reference);
        // Suspend immediately on a failed/declined charge attempt itself
        // (a prompt that never even sent). A prompt that WAS sent but not
        // yet approved is handled separately when the webhook eventually
        // reports charge.failed or timeout.
        await db.from(table).update({ subscription_status: "suspended" }).eq("id", tenant.id);
      }
      // If result.ok, the charge is now pending the customer's PIN
      // approval -- we wait for the webhook, we don't assume success here.
    } catch (chargeErr) {
      failed++;
      console.error(`MoMo renewal charge failed for tenant ${tenant.id}:`, chargeErr);
      await jobsDb
        .from("subscription_renewals")
        .update({ status: "failed", error: String(chargeErr.message || chargeErr).slice(0, 500) })
        .eq("reference", reference);
      await db.from(table).update({ subscription_status: "suspended" }).eq("id", tenant.id);
    }
  }

  return { attempted, failed };
}

exports.handler = async () => {
  const jobsDb = getJobsClient();
  const posResult = await processProduct("pos", jobsDb);
  const schoolResult = await processProduct("school", jobsDb);
  const cleanupResult = await cleanupStalePending(jobsDb);

  console.log("MoMo renewal run:", { pos: posResult, school: schoolResult, cleanup: cleanupResult });
  return { statusCode: 200, body: JSON.stringify({ pos: posResult, school: schoolResult, cleanup: cleanupResult }) };
};

// ---- Safety net: if a customer never responds to the PIN prompt at all, ----
// ---- Paystack may not always send a clear charge.failed event -- without ----
// ---- this, that tenant would stay "pending" forever with access never ----
// ---- actually suspended. Anything still pending after 24h is treated as ----
// ---- a failed renewal. ----
async function cleanupStalePending(jobsDb) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: stale, error } = await jobsDb
    .from("subscription_renewals")
    .select("*")
    .eq("status", "pending")
    .eq("channel", "momo")
    .lt("created_at", cutoff);

  if (error) {
    console.error("Failed to fetch stale pending renewals:", error);
    return { suspended: 0 };
  }

  let suspended = 0;
  for (const row of stale || []) {
    const db = getSupabaseFor(row.tenant_product);
    const table = TENANT_TABLES[row.tenant_product];
    await db.from(table).update({ subscription_status: "suspended" }).eq("id", row.tenant_id);
    await jobsDb
      .from("subscription_renewals")
      .update({ status: "failed", error: "timed out waiting for customer PIN approval" })
      .eq("id", row.id);
    suspended++;
  }
  return { suspended };
}

/* ============================================================
   Shared billing helpers -- used by verify-and-provision.js,
   charge-momo-renewals.js, and paystack-webhook.js.

   Two renewal tracks, because Paystack's Subscriptions API only
   supports Card + Nigerian Direct Debit -- NOT Mobile Money
   (confirmed via Paystack's own docs, Aug 2026):
     - CARD: a real Paystack Subscription is created once; Paystack
       itself charges silently every cycle, no code of ours runs.
     - MOMO: no persistent "subscription" exists on Paystack's side.
       We store the phone + provider, and charge-momo-renewals.js
       (a daily scheduled function) calls the Charge API fresh each
       cycle with those same details. The customer still approves
       via PIN each time -- that's a Ghana-wide MoMo constraint, not
       something we can bypass.
   ============================================================ */

const PAYSTACK_BASE = "https://api.paystack.co";

function paystackHeaders() {
  return {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    "Content-Type": "application/json",
  };
}

// ---- Date math for renewal cycles ----
function addCycle(fromDate, cycle) {
  const d = new Date(fromDate);
  if (cycle === "yearly") {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString().split("T")[0]; // date-only, matches the `date` column type
}

// ---- Card: create a real Paystack Subscription so future charges are silent ----
async function createCardSubscription({ email, planCode, authorizationCode }) {
  if (!planCode) {
    // No Paystack Plan configured yet for this catalog entry -- the
    // initial payment still succeeded, it just won't auto-renew until
    // a plan code is added to _catalog.js. Don't fail the signup over this.
    console.warn("No paystackPlanCode set -- skipping subscription creation");
    return null;
  }
  const res = await fetch(`${PAYSTACK_BASE}/subscription`, {
    method: "POST",
    headers: paystackHeaders(),
    body: JSON.stringify({ customer: email, plan: planCode, authorization: authorizationCode }),
  });
  const json = await res.json();
  if (!res.ok || !json.status) {
    console.error("Paystack subscription creation failed:", json);
    return null;
  }
  return json.data.subscription_code;
}

// ---- MoMo: initiate one charge attempt (used both at signup time is NOT ----
// ---- needed -- the initial payment already happened via Inline; this is ----
// ---- only ever called by the scheduled renewal job) ----
async function chargeMomo({ email, amountPesewas, phone, provider, reference }) {
  const res = await fetch(`${PAYSTACK_BASE}/charge`, {
    method: "POST",
    headers: paystackHeaders(),
    body: JSON.stringify({
      email,
      amount: amountPesewas,
      reference,
      mobile_money: { phone, provider },
    }),
  });
  const json = await res.json();
  return { ok: res.ok && json.status, data: json.data, raw: json };
}

// ---- Commission generation: rep gets their %, their manager (if any) ----
// ---- gets their own separate override % -- same reference, two rows, ----
// ---- made possible by the (agent_id, reference) composite unique key. ----
async function generateCommissions(jobsDb, { tenantProduct, tenantId, agentId, reference, plan, amountPaidGHS, eventType }) {
  if (!agentId) return; // no sales code was ever linked to this tenant -- nothing to attribute

  const { data: rep } = await jobsDb.from("sales_agents").select("*").eq("id", agentId).maybeSingle();
  if (!rep || !rep.is_active) return;

  const repCommission = Math.round(amountPaidGHS * (rep.commission_rate / 100) * 100) / 100;
  await jobsDb.from("sales_attributions").insert({
    agent_id: rep.id,
    reference,
    product: tenantProduct,
    plan,
    amount_paid: amountPaidGHS,
    commission_amount: repCommission,
    event_type: eventType,
    tenant_product: tenantProduct,
    tenant_id: tenantId,
  });

  if (rep.manager_id) {
    const { data: manager } = await jobsDb.from("sales_agents").select("*").eq("id", rep.manager_id).maybeSingle();
    if (manager && manager.is_active) {
      const managerCommission = Math.round(amountPaidGHS * (manager.commission_rate / 100) * 100) / 100;
      await jobsDb.from("sales_attributions").insert({
        agent_id: manager.id,
        reference,
        product: tenantProduct,
        plan,
        amount_paid: amountPaidGHS,
        commission_amount: managerCommission,
        event_type: eventType,
        tenant_product: tenantProduct,
        tenant_id: tenantId,
      });
    }
  }
}

module.exports = { addCycle, createCardSubscription, chargeMomo, generateCommissions };

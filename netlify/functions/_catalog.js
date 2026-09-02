/* ============================================================
   Server-side catalog — NEVER trust the price sent by the client.
   Keep in sync with js/products.js on the frontend.
   Prices are in pesewas (GHS * 100), matching Paystack's amount unit.

   Two plans per product (monthly / yearly) -- see notes below on how
   each product's feature limits are now derived from cycle, not a
   separate paid tier:
     - POS: the 3-store rebuild is available to every POS customer
       regardless of plan (see _provisioners/pos.js) -- store count
       is no longer plan-gated.
     - School: monthly = up to 300 students; yearly = up to 800
       students (see _provisioners/school.js) -- the higher student
       cap is a yearly-commitment benefit, not a separate paid tier.

   paystackPlanCode: required for CARD subscriptions (Paystack's
   Subscriptions API only supports Card + Nigerian Direct Debit --
   Mobile Money is NOT supported, see _lib/billing.js). Create each
   Plan once in the Paystack Dashboard (Payments -> Plans -> New Plan),
   matching this exact price/interval, then paste the resulting
   plan_code (starts PLN_...) in below. Until filled in, card
   subscriptions can't be created and initial card payments will
   still work fine, they just won't auto-renew.
   ============================================================ */

const CATALOG = {
  pos: {
    name: "NYANSATEK POS",
    loginUrl: "https://nyansatek.shop",
    plans: {
      standard: { label: "Monthly", price: 12000, cycle: "monthly", paystackPlanCode: "PLN_q10raivw1qw0kc5" },
      yearly:   { label: "Yearly", price: 120000, cycle: "yearly", paystackPlanCode: "PLN_oc0d5oae4utmmos" },
    },
  },
  school: {
    name: "NYANSATEK School",
    loginUrl: "https://nyansatek.school",
    plans: {
      standard: { label: "Monthly — up to 300 students", price: 15000, cycle: "monthly", paystackPlanCode: "PLN_pido6g7veebfcx7" },
      yearly:   { label: "Yearly — up to 800 students", price: 150000, cycle: "yearly", paystackPlanCode: "PLN_7t3qirj8td8nfew" },
    },
  },
};

module.exports = { CATALOG };

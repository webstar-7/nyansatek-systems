/* ============================================================
   Server-side catalog — NEVER trust the price sent by the client.
   Keep in sync with js/products.js on the frontend.
   Prices are in pesewas (GHS * 100), matching Paystack's amount unit.

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
      standard: { label: "Single store", price: 12000, cycle: "monthly", paystackPlanCode: null },
      multi:    { label: "Up to 3 stores", price: 26000, cycle: "monthly", paystackPlanCode: null },
      yearly:   { label: "Single store — yearly", price: 120000, cycle: "yearly", paystackPlanCode: null },
    },
  },
  school: {
    name: "NYANSATEK School",
    // TODO: swap to https://nyansatek.school once that domain is live
    loginUrl: "https://nyansatek-attendance.netlify.app",
    plans: {
      standard: { label: "Up to 300 students", price: 15000, cycle: "monthly", paystackPlanCode: null },
      multi:    { label: "Up to 800 students", price: 28000, cycle: "monthly", paystackPlanCode: null },
      yearly:   { label: "Up to 300 students — yearly", price: 150000, cycle: "yearly", paystackPlanCode: null },
    },
  },
};

module.exports = { CATALOG };

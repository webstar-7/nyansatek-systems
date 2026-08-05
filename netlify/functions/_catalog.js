/* ============================================================
   Server-side catalog — NEVER trust the price sent by the client.
   Keep in sync with js/products.js on the frontend.
   Prices are in pesewas (GHS * 100), matching Paystack's amount unit.
   ============================================================ */

const CATALOG = {
  pos: {
    name: "NYANSATEK POS",
    loginUrl: "https://nyansatek.shop",
    plans: {
      standard: { label: "Single store", price: 12000, cycle: "monthly" },
      multi:    { label: "Up to 3 stores", price: 26000, cycle: "monthly" },
      yearly:   { label: "Single store — yearly", price: 120000, cycle: "yearly" },
    },
  },
  school: {
    name: "NYANSATEK School",
    // TODO: swap to https://nyansatek.school once that domain is live
    loginUrl: "https://nyansatek-attendance.netlify.app",
    plans: {
      standard: { label: "Up to 300 students", price: 15000, cycle: "monthly" },
      multi:    { label: "Up to 800 students", price: 28000, cycle: "monthly" },
      yearly:   { label: "Up to 300 students — yearly", price: 150000, cycle: "yearly" },
    },
  },
};

module.exports = { CATALOG };

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
      standard: { label: "Single store", price: 120, cycle: "monthly" },
      multi:    { label: "Up to 3 stores", price: 260, cycle: "monthly" },
      yearly:   { label: "Single store — yearly", price: 1200, cycle: "yearly" },
    },
  },
  school: {
    name: "NYANSATEK School",
    loginUrl: "https://nyansatek.school",
    plans: {
      standard: { label: "Up to 300 students", price: 150, cycle: "monthly" },
      multi:    { label: "Up to 800 students", price: 280, cycle: "monthly" },
      yearly:   { label: "Up to 300 students — yearly", price: 1500, cycle: "yearly" },
    },
  },
};

module.exports = { CATALOG };

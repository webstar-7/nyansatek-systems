/* ============================================================
   Product catalog — single source of truth for pricing.
   IMPORTANT: this list must be mirrored server-side
   (netlify/functions/_catalog.js) since client-side prices
   should never be trusted for the actual charge amount.
   ============================================================ */

const NYANSATEK_CATALOG = {
  pos: {
    name: "NYANSATEK POS",
    liveUrl: "https://nyansatek.shop",
    plans: {
      standard: { label: "Single store", price: 12000, cycle: "monthly", cycleLabel: "per month" }, // amount in pesewas (GHS * 100)
      multi:    { label: "Up to 3 stores", price: 26000, cycle: "monthly", cycleLabel: "per month" },
      yearly:   { label: "Single store — yearly", price: 120000, cycle: "yearly", cycleLabel: "per year" }
    }
  },
  school: {
    name: "NYANSATEK School",
    liveUrl: "https://nyansatek-attendance.netlify.app",
    plans: {
      standard: { label: "Up to 300 students", price: 15000, cycle: "monthly", cycleLabel: "per month" },
      multi:    { label: "Up to 800 students", price: 28000, cycle: "monthly", cycleLabel: "per month" },
      yearly:   { label: "Up to 300 students — yearly", price: 150000, cycle: "yearly", cycleLabel: "per year" }
    }
  }
};

function formatGHS(pesewas) {
  return "GH₵" + (pesewas / 100).toLocaleString("en-GH", { minimumFractionDigits: 0 });
}

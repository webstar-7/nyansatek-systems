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
      standard: { label: "Monthly", price: 12000, cycle: "monthly", cycleLabel: "per month" }, // amount in pesewas (GHS * 100)
      yearly:   { label: "Yearly", price: 120000, cycle: "yearly", cycleLabel: "per year" }
    }
  },
  school: {
    name: "NYANSATEK School",
    liveUrl: "https://nyansatek-attendance.netlify.app",
    plans: {
      standard: { label: "Monthly — up to 300 students", price: 15000, cycle: "monthly", cycleLabel: "per month" },
      yearly:   { label: "Yearly — up to 800 students", price: 150000, cycle: "yearly", cycleLabel: "per year" }
    }
  }
};

function formatGHS(pesewas) {
  return "GH₵" + (pesewas / 100).toLocaleString("en-GH", { minimumFractionDigits: 0 });
}

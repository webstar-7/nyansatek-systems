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
      standard: { label: "Monthly", price: 20000, cycle: "monthly", cycleLabel: "per month" }, // amount in pesewas (GHS * 100)
      yearly:   { label: "Yearly", price: 200000, cycle: "yearly", cycleLabel: "per year" }
    }
  },
  school: {
    name: "NYANSATEK School",
    liveUrl: "https://nyansatek.school",
    plans: {
      monthly:     { label: "Monthly — up to 300 students",   price: 50000,   cycle: "monthly", cycleLabel: "per month", includesSms: 7500 },
      yearly_300:  { label: "Yearly — up to 300 students",    price: 500000,  cycle: "yearly",  cycleLabel: "per year",  includesSms: 7500 },
      yearly_500:  { label: "Yearly — up to 500 students",    price: 800000,  cycle: "yearly",  cycleLabel: "per year",  includesSms: 12500 },
      yearly_800:  { label: "Yearly — up to 800 students",    price: 1200000, cycle: "yearly",  cycleLabel: "per year",  includesSms: 20000 },
      yearly_1000: { label: "Yearly — up to 1,000 students",  price: 1500000, cycle: "yearly",  cycleLabel: "per year",  includesSms: 25000 },
      yearly_1500: { label: "Yearly — up to 1,500 students",  price: 2000000, cycle: "yearly",  cycleLabel: "per year",  includesSms: 37500 },
      yearly_2000: { label: "Yearly — up to 2,000 students",  price: 2500000, cycle: "yearly",  cycleLabel: "per year",  includesSms: 50000 },
      yearly_2500: { label: "Yearly — up to 2,500 students",  price: 3000000, cycle: "yearly",  cycleLabel: "per year",  includesSms: 62500 },
      yearly_3000: { label: "Yearly — up to 3,000 students",  price: 3500000, cycle: "yearly",  cycleLabel: "per year",  includesSms: 75000 },
      yearly_3500: { label: "Yearly — up to 3,500 students",  price: 4000000, cycle: "yearly",  cycleLabel: "per year",  includesSms: 87500 },
      yearly_4000: { label: "Yearly — up to 4,000 students",  price: 4500000, cycle: "yearly",  cycleLabel: "per year",  includesSms: 100000 },
      yearly_4500: { label: "Yearly — up to 4,500 students",  price: 5000000, cycle: "yearly",  cycleLabel: "per year",  includesSms: 112500 }
    }
  }
};

function formatGHS(pesewas) {
  return "GH₵" + (pesewas / 100).toLocaleString("en-GH", { minimumFractionDigits: 0 });
}

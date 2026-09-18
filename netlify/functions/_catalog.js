/* ============================================================
   Server-side catalog — NEVER trust the price sent by the client.
   Keep in sync with js/products.js on the frontend.
   Prices are in pesewas (GHS * 100), matching Paystack's amount unit.

   POS: two plans (monthly / yearly). Yearly is priced below 12x
   monthly specifically to encourage the annual commitment (200/mo
   would be 2400/yr at parity; yearly is 2000, a real discount).

   School: pricing is tiered by "up to N students" for the YEARLY
   plans, plus a single flat-rate MONTHLY plan for schools not ready
   to commit annually. The "up to N" framing means natural
   subsidization within a tier (a 250-student school on the "up to
   300" tier costs less to serve than one with the full 300, so the
   tier's real margin is healthier than a worst-case per-student
   calculation suggests) -- this is deliberate, not an oversight.

   includesSms: the monthly SMS allowance bundled into each plan,
   enforced by sms_billing.monthly_allowance (see
   sms-metering-migration.sql) -- Gate/Bus notifications always send
   regardless of this limit; only Bulk SMS and Fee Defaulter reminders
   are gated by it. Sized at ~25 SMS/student/month (~300/year).

   The flat monthly plan is capped at "up to 300 students" with the
   same allowance as the smallest yearly tier -- pricing it uncapped
   would let a large school pay the smallest plan's rate indefinitely
   with no incentive to move to a tier that actually reflects their
   size, undercutting the entire tiered structure below it.

   paystackPlanCode: all 14 plans now created in the Paystack Dashboard
   (Payments -> Plans) and confirmed live -- codes below were read off
   a dashboard screenshot; worth a quick copy-paste verification
   against the real dashboard rather than trusting this transcription
   blindly, though nothing in the current one-time-payment renewal
   flow actually reads this field yet (only `price` is verified) -- it
   only matters once/if real Paystack Card Subscriptions get built on
   top of these.
   ================================================================ */

const CATALOG = {
  pos: {
    name: "NYANSATEK POS",
    loginUrl: "https://nyansatek.shop",
    plans: {
      standard: { label: "Monthly", price: 20000, cycle: "monthly", paystackPlanCode: "PLN_ez02qfzpibedqdc" },
      yearly:   { label: "Yearly", price: 200000, cycle: "yearly", paystackPlanCode: "PLN_dkear4a4gtcs5lo" },
    },
  },
  school: {
    name: "NYANSATEK School",
    loginUrl: "https://nyansatek.school",
    plans: {
      monthly:     { label: "Monthly — up to 300 students",   price: 50000,   cycle: "monthly", studentCap: 300,  includesSms: 7500,   paystackPlanCode: "PLN_bcjf15xnpn0gi1k" },
      yearly_300:  { label: "Yearly — up to 300 students",    price: 500000,  cycle: "yearly",  studentCap: 300,  includesSms: 7500,   paystackPlanCode: "PLN_rxdsv75rd07wbtf" },
      yearly_500:  { label: "Yearly — up to 500 students",    price: 800000,  cycle: "yearly",  studentCap: 500,  includesSms: 12500,  paystackPlanCode: "PLN_oozs5ekdidbpwtq" },
      yearly_800:  { label: "Yearly — up to 800 students",    price: 1200000, cycle: "yearly",  studentCap: 800,  includesSms: 20000,  paystackPlanCode: "PLN_eitxxlbe4rnfnn8" },
      yearly_1000: { label: "Yearly — up to 1,000 students",  price: 1500000, cycle: "yearly",  studentCap: 1000, includesSms: 25000,  paystackPlanCode: "PLN_y4axcsjww832hnb" },
      yearly_1500: { label: "Yearly — up to 1,500 students",  price: 2000000, cycle: "yearly",  studentCap: 1500, includesSms: 37500,  paystackPlanCode: "PLN_uo91nehe3ntpbk8" },
      yearly_2000: { label: "Yearly — up to 2,000 students",  price: 2500000, cycle: "yearly",  studentCap: 2000, includesSms: 50000,  paystackPlanCode: "PLN_f2dglqfekpe1zi8" },
      yearly_2500: { label: "Yearly — up to 2,500 students",  price: 3000000, cycle: "yearly",  studentCap: 2500, includesSms: 62500,  paystackPlanCode: "PLN_t7dnk8ju82p9hv0" },
      yearly_3000: { label: "Yearly — up to 3,000 students",  price: 3500000, cycle: "yearly",  studentCap: 3000, includesSms: 75000,  paystackPlanCode: "PLN_yjsyequiszhtxj2" },
      yearly_3500: { label: "Yearly — up to 3,500 students",  price: 4000000, cycle: "yearly",  studentCap: 3500, includesSms: 87500,  paystackPlanCode: "PLN_jaocxu7w3isr0mo" },
      yearly_4000: { label: "Yearly — up to 4,000 students",  price: 4500000, cycle: "yearly",  studentCap: 4000, includesSms: 100000, paystackPlanCode: "PLN_3to649nkq1zjrfz" },
      yearly_4500: { label: "Yearly — up to 4,500 students",  price: 5000000, cycle: "yearly",  studentCap: 4500, includesSms: 112500, paystackPlanCode: "PLN_k6gnd0l7yi8e25z" },
    },
  },
};

module.exports = { CATALOG };

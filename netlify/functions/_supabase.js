const { createClient } = require("@supabase/supabase-js");

const PROJECTS = {
  pos: {
    url: process.env.SUPABASE_POS_URL,
    key: process.env.SUPABASE_POS_SERVICE_ROLE_KEY,
  },
  // restaurants (nyansatek.rest) live in the POS project, as organizations with vertical = 'food'
  rest: {
    url: process.env.SUPABASE_POS_URL,
    key: process.env.SUPABASE_POS_SERVICE_ROLE_KEY,
  },
  school: {
    url: process.env.SUPABASE_SCHOOL_URL,
    key: process.env.SUPABASE_SCHOOL_SERVICE_ROLE_KEY,
  },
  gold: {
    url: process.env.SUPABASE_GOLD_URL,
    key: process.env.SUPABASE_GOLD_SERVICE_ROLE_KEY,
  },
  // NYANSATEK HRMS (nyansatek.space): its tables live in the `hrms` schema, not `public`
  hrms: {
    url: process.env.SUPABASE_HRMS_URL,
    key: process.env.SUPABASE_HRMS_SERVICE_ROLE_KEY,
    schema: "hrms",
  },
  // nyansatek-misc: company-wide data shared across products (sales agents, commissions)
  misc: {
    url: process.env.SUPABASE_MISC_URL,
    key: process.env.SUPABASE_MISC_SERVICE_ROLE_KEY,
  },
};

const clientCache = {};

function getSupabaseFor(product) {
  const cfg = PROJECTS[product];
  if (!cfg || !cfg.url || !cfg.key) {
    throw new Error(
      `Missing Supabase config for product "${product}". Check SUPABASE_${product.toUpperCase()}_URL / _SERVICE_ROLE_KEY in Netlify env vars.`
    );
  }
  if (!clientCache[product]) {
    clientCache[product] = createClient(cfg.url, cfg.key, {
      auth: { persistSession: false, autoRefreshToken: false },
      ...(cfg.schema ? { db: { schema: cfg.schema } } : {}),
    });
  }
  return clientCache[product];
}

function getJobsClient() {
  return getSupabaseFor("pos"); // provisioning_jobs and subscription_renewals live in the POS project
}

// sales_agents, sales_attributions and the agents' portal logins live in nyansatek-misc
function getAgentsClient() {
  return getSupabaseFor("misc");
}

// True when a product's database keys are set in Netlify. The checkout asks this BEFORE taking
// payment (see checkout-ready.js), so nobody is charged for a product that cannot be delivered.
function isConfigured(product) {
  const cfg = PROJECTS[product];
  return !!(cfg && cfg.url && cfg.key);
}

module.exports = { getSupabaseFor, getJobsClient, getAgentsClient, isConfigured };

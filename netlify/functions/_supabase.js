/* ============================================================
   Supabase admin clients — one per Supabase project.

   You run TWO separate Supabase projects (the free-tier limit),
   one behind nyansatek.shop (POS) and one behind
   nyansatek-attendance.netlify.app (School). This storefront has
   to be able to write into whichever one the customer actually
   bought into, so there's no single shared client — you ask for
   the right one by product.

   The `provisioning_jobs` tracking table (purchase → account
   status) doesn't belong to either product. It lives in the POS
   project by convention — see getJobsClient() below — purely
   because that's the more established project, not because jobs
   are POS-specific.

   Required Netlify env vars:
     SUPABASE_POS_URL
     SUPABASE_POS_SERVICE_ROLE_KEY
     SUPABASE_SCHOOL_URL
     SUPABASE_SCHOOL_SERVICE_ROLE_KEY
   ============================================================ */

const { createClient } = require("@supabase/supabase-js");

const PROJECTS = {
  pos: {
    url: process.env.SUPABASE_POS_URL,
    key: process.env.SUPABASE_POS_SERVICE_ROLE_KEY,
  },
  school: {
    url: process.env.SUPABASE_SCHOOL_URL,
    key: process.env.SUPABASE_SCHOOL_SERVICE_ROLE_KEY,
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
    });
  }
  return clientCache[product];
}

// provisioning_jobs lives in the POS project — see note above.
function getJobsClient() {
  return getSupabaseFor("pos");
}

module.exports = { getSupabaseFor, getJobsClient };

/* ============================================================
   Shared CORS handling for endpoints called cross-origin from
   pos.html (nyansatek.shop) and School's app (its own domain) --
   unlike verify-and-provision.js, which is only ever called from
   the storefront itself (same origin, no CORS needed).
   ============================================================ */

const ALLOWED_ORIGINS = [
  "https://nyansatek.shop",
  "https://nyansatek-attendance.netlify.app", // TODO: swap once nyansatek.school is live
  "https://nyansatek.systems",
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Call at the top of any handler that needs CORS. Returns a response to
// return immediately if this was a preflight OPTIONS request, or null
// if the caller should continue handling the real request.
function handlePreflight(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(event.headers.origin), body: "" };
  }
  return null;
}

module.exports = { corsHeaders, handlePreflight };

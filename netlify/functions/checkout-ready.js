/* ============================================================
   GET /.netlify/functions/checkout-ready?product=hrms

   Asked by the checkout page BEFORE it opens the payment window.
   Payment happens in the browser, and only afterwards does
   verify-and-provision.js create the account. If a product's
   database keys were missing from Netlify, the customer would be
   charged and then get nothing. This answers "can this product be
   delivered right now?" so the page can stop first.

   Returns { ready: true } or { ready: false }. It says nothing
   about why, and never returns a key.
   ============================================================ */

const { CATALOG } = require("./_catalog");
const { isConfigured } = require("./_supabase");

exports.handler = async (event) => {
  const product = event.queryStringParameters && event.queryStringParameters.product;
  const ready = !!(product && CATALOG[product] && isConfigured(product) && isConfigured("pos") && process.env.PAYSTACK_SECRET_KEY);
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({ ready }),
  };
};

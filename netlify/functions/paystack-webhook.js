/* ============================================================
   POST /.netlify/functions/paystack-webhook
   Configure this URL in your Paystack dashboard under
   Settings → API Keys & Webhooks.

   Why this exists alongside the client-side callback in
   checkout.js: if a customer pays successfully but closes the
   tab or loses connection before success.html finishes calling
   verify-and-provision, this webhook is what still gets their
   account created without anyone on our side noticing the gap.

   Both paths converge on the same verify-and-provision logic
   and the same idempotency check, so whichever one fires first
   "wins" and the other becomes a no-op.
   ============================================================ */

const crypto = require("crypto");

exports.handler = async (event) => {
  const signature = event.headers["x-paystack-signature"];
  const secret = process.env.PAYSTACK_SECRET_KEY;

  const expected = crypto.createHmac("sha512", secret).update(event.body).digest("hex");
  if (signature !== expected) {
    return { statusCode: 401, body: "Invalid signature" };
  }

  const payload = JSON.parse(event.body);

  if (payload.event === "charge.success") {
    const { reference, metadata } = payload.data;

    // Re-use the exact same verification + provisioning path as
    // the client-side flow — never provision directly off webhook
    // payload contents.
    const baseUrl = process.env.URL || `https://${event.headers.host}`;
    await fetch(`${baseUrl}/.netlify/functions/verify-and-provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reference,
        order: {
          product: metadata.product,
          plan: metadata.plan,
          businessName: metadata.businessName,
          ownerName: metadata.ownerName,
          phone: metadata.phone,
          email: payload.data.customer.email,
          location: metadata.location,
        },
      }),
    });
  }

  // Always 200 quickly so Paystack doesn't retry unnecessarily.
  return { statusCode: 200, body: "ok" };
};

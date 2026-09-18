// pay-sms-overage
//
// Confirms an SMS overage payment (School only — POS has no SMS
// metering) after the client has already run a Paystack Inline
// payment. Re-verifies the transaction against Paystack directly and
// records it in sms_overage_payments, which already has a UNIQUE
// constraint on paystack_reference (see sms-metering-migration.sql) —
// that constraint is this function's idempotency guarantee.
//
// Unlike renew/upgrade, the amount here is genuinely dynamic (however
// much SMS overage a specific school racked up that month, not a
// catalog price) — so there's nothing in _catalog.js to match against.
// What this verifies is that Paystack actually confirms a successful
// payment, and it records the REAL Paystack amount (never the
// client-claimed one) against the billing period the client says it's
// for.
//
// Deploy: netlify/functions/pay-sms-overage.js
//
// Request body:
//   { reference: string, tenantProduct: "school", tenantId: uuid,
//     amount: number (GHS, client's claimed amount -- sanity-check
//       only, never trusted as the recorded amount),
//     period: string ("YYYY-MM") }
//
// Response:
//   200 { ok: true }
//   4xx/5xx { ok: false, error: string }

const { getSupabaseFor } = require('./_supabase');

function jsonResponse(statusCode, bodyObj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(bodyObj),
  };
}

async function verifyPaystackTransaction(reference) {
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });
  const json = await res.json();
  if (!res.ok || !json.status) {
    throw new Error(json.message || 'Could not verify transaction with Paystack');
  }
  return json.data;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON body' });
  }

  const { reference, tenantProduct, tenantId, period } = body;
  if (!reference || !tenantId || !period) {
    return jsonResponse(400, { ok: false, error: 'reference, tenantId, and period are required' });
  }
  if (tenantProduct && tenantProduct !== 'school') {
    return jsonResponse(400, { ok: false, error: 'SMS overage billing only applies to School' });
  }
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return jsonResponse(400, { ok: false, error: "period must be in 'YYYY-MM' format" });
  }

  let supabase;
  try {
    supabase = getSupabaseFor('school');
  } catch (e) {
    return jsonResponse(500, { ok: false, error: e.message });
  }

  // ── Verify the payment actually happened, and for how much ──
  let txn;
  try {
    txn = await verifyPaystackTransaction(reference);
  } catch (e) {
    return jsonResponse(502, { ok: false, error: `Payment verification failed: ${e.message}` });
  }
  if (txn.status !== 'success') {
    return jsonResponse(402, { ok: false, error: `Payment was not successful (status: ${txn.status})` });
  }

  const verifiedAmount = Math.round((txn.amount / 100) * 100) / 100; // pesewas -> GHS, 2dp

  // ── Sanity check only, not a source of truth ──
  if (typeof body.amount === 'number' && Math.abs(body.amount - verifiedAmount) > 0.01) {
    console.warn(`SMS overage payment amount mismatch for ${tenantId}: client claimed GH₵${body.amount}, Paystack confirms GH₵${verifiedAmount}. Recording the verified amount.`);
  }

  // ── Record it. The unique constraint on paystack_reference is what
  // makes this idempotent -- a duplicate call just fails here and we
  // treat that as "already recorded," not an error to surface. ──
  const { error: insertErr } = await supabase.from('sms_overage_payments').insert({
    institution_id: tenantId,
    billing_period: period,
    amount: verifiedAmount,
    paystack_reference: reference,
  });

  if (insertErr) {
    if (insertErr.code === '23505' /* unique_violation */) {
      return jsonResponse(200, { ok: true }); // already recorded — safe no-op
    }
    return jsonResponse(500, { ok: false, error: `Could not record payment: ${insertErr.message}` });
  }

  return jsonResponse(200, { ok: true });
};

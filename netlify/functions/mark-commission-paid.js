/* ============================================================
   POST /.netlify/functions/mark-commission-paid
   Header: Authorization: Bearer <supabase access token>
   Body: { attributionId, paid: true|false }

   Restricted to accountant_hr and master roles -- checked
   server-side against the verified caller, never trusted from
   the client.
   ============================================================ */

const { getJobsClient } = require("./_supabase");
const { getAuthenticatedAgent } = require("./_lib/agent-auth");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { agent, error } = await getAuthenticatedAgent(event);
  if (error) return { statusCode: 401, body: JSON.stringify({ error }) };

  if (agent.role !== "accountant_hr" && agent.role !== "master") {
    return { statusCode: 403, body: JSON.stringify({ error: "Not authorized to mark commissions as paid" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { attributionId, paid } = body;
  if (!attributionId) {
    return { statusCode: 400, body: JSON.stringify({ error: "attributionId is required" }) };
  }

  const jobsDb = getJobsClient();
  const update = paid
    ? { status: "paid", paid_at: new Date().toISOString() }
    : { status: "unpaid", paid_at: null };

  const { error: updateErr } = await jobsDb.from("sales_attributions").update(update).eq("id", attributionId);
  if (updateErr) {
    return { statusCode: 500, body: JSON.stringify({ error: updateErr.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};

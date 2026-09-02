/* ============================================================
   POST /.netlify/functions/set-agent-status
   Header: Authorization: Bearer <supabase access token>
   Body: { agentId, isActive: true|false }

   Master only -- deactivating blocks that agent's portal login
   immediately and (for a Sales Manager) stops new reps from being
   able to register under their code, without deleting their
   history or existing commission records.
   ============================================================ */

const { getJobsClient } = require("./_supabase");
const { getAuthenticatedAgent } = require("./_lib/agent-auth");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { agent, error } = await getAuthenticatedAgent(event);
  if (error) return { statusCode: 401, body: JSON.stringify({ error }) };

  if (agent.role !== "master") {
    return { statusCode: 403, body: JSON.stringify({ error: "Master only" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { agentId, isActive } = body;
  if (!agentId || typeof isActive !== "boolean") {
    return { statusCode: 400, body: JSON.stringify({ error: "agentId and isActive are required" }) };
  }

  const jobsDb = getJobsClient();
  const { error: updateErr } = await jobsDb.from("sales_agents").update({ is_active: isActive }).eq("id", agentId);
  if (updateErr) {
    return { statusCode: 500, body: JSON.stringify({ error: updateErr.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};

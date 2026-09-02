/* ============================================================
   Shared auth helper for the team portal's backend endpoints.

   The portal signs in client-side via Supabase Auth (same POS
   project sales_agents.auth_user_id was created in), then sends
   that session's access token to these endpoints. sales_agents and
   sales_attributions have RLS enabled with NO policies -- on
   purpose, so the anon key can't touch them at all. Every read/write
   goes through here: verify the token server-side, look up the
   matching agent row, and let the SERVICE ROLE client (which
   bypasses RLS) do the actual query once we know who's asking.
   ============================================================ */

const { getJobsClient } = require("./_supabase");

async function getAuthenticatedAgent(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { error: "Missing authorization" };
  }
  const token = authHeader.slice(7);
  const jobsDb = getJobsClient();

  const { data: userData, error: userErr } = await jobsDb.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return { error: "Invalid or expired session" };
  }

  const { data: agent, error: agentErr } = await jobsDb
    .from("sales_agents")
    .select("*")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();

  if (agentErr || !agent) {
    return { error: "No agent record found for this account" };
  }
  if (!agent.is_active) {
    return { error: "This account has been deactivated" };
  }

  return { agent };
}

module.exports = { getAuthenticatedAgent };

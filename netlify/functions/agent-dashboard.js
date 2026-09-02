/* ============================================================
   POST /.netlify/functions/agent-dashboard
   Header: Authorization: Bearer <supabase access token>

   Returns different data shapes depending on the caller's role --
   see getAuthenticatedAgent() in _lib/agent-auth.js for how the
   caller's identity is established server-side.
   ============================================================ */

const { getJobsClient } = require("./_supabase");
const { getAuthenticatedAgent } = require("./_lib/agent-auth");

exports.handler = async (event) => {
  const { agent, error } = await getAuthenticatedAgent(event);
  if (error) return { statusCode: 401, body: JSON.stringify({ error }) };

  const jobsDb = getJobsClient();

  try {
    if (agent.role === "sales_rep") {
      const { data: commissions } = await jobsDb
        .from("sales_attributions")
        .select("*")
        .eq("agent_id", agent.id)
        .order("created_at", { ascending: false });

      const total = (commissions || []).reduce((s, c) => s + c.commission_amount, 0);
      const unpaid = (commissions || []).filter((c) => c.status === "unpaid").reduce((s, c) => s + c.commission_amount, 0);

      return { statusCode: 200, body: JSON.stringify({ ok: true, agent, commissions, total, unpaid }) };
    }

    if (agent.role === "sales_manager") {
      const [{ data: ownCommissions }, { data: team }] = await Promise.all([
        jobsDb.from("sales_attributions").select("*").eq("agent_id", agent.id).order("created_at", { ascending: false }),
        jobsDb.from("sales_agents").select("*").eq("manager_id", agent.id).order("full_name"),
      ]);

      const teamIds = (team || []).map((t) => t.id);
      let teamCommissions = [];
      if (teamIds.length) {
        const { data } = await jobsDb.from("sales_attributions").select("*").in("agent_id", teamIds);
        teamCommissions = data || [];
      }

      const teamWithStats = (team || []).map((rep) => {
        const repCommissions = teamCommissions.filter((c) => c.agent_id === rep.id);
        return {
          ...rep,
          totalSales: repCommissions.reduce((s, c) => s + c.amount_paid, 0),
          totalCommission: repCommissions.reduce((s, c) => s + c.commission_amount, 0),
          saleCount: repCommissions.length,
        };
      });

      const ownTotal = (ownCommissions || []).reduce((s, c) => s + c.commission_amount, 0);

      return { statusCode: 200, body: JSON.stringify({ ok: true, agent, ownCommissions, ownTotal, team: teamWithStats }) };
    }

    if (agent.role === "accountant_hr" || agent.role === "master") {
      const { data: allCommissions } = await jobsDb
        .from("sales_attributions")
        .select("*, sales_agents(full_name, code, role)")
        .order("created_at", { ascending: false });

      const totalOwed = (allCommissions || []).filter((c) => c.status === "unpaid").reduce((s, c) => s + c.commission_amount, 0);
      const totalPaid = (allCommissions || []).filter((c) => c.status === "paid").reduce((s, c) => s + c.commission_amount, 0);

      let allAgents = null;
      if (agent.role === "master") {
        const { data } = await jobsDb.from("sales_agents").select("*").order("created_at", { ascending: false });
        allAgents = data;
      }

      return { statusCode: 200, body: JSON.stringify({ ok: true, agent, allCommissions, totalOwed, totalPaid, allAgents }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: "Unknown role" }) };
  } catch (err) {
    console.error("agent-dashboard error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal error" }) };
  }
};

/* ============================================================
   GET /.netlify/functions/provision-status?reference=NYT-xxx
   Lets the success page poll job progress without re-triggering
   provisioning.
   ============================================================ */

const { getJobsClient } = require("./_supabase");

exports.handler = async (event) => {
  const reference = event.queryStringParameters && event.queryStringParameters.reference;
  if (!reference) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing reference" }) };
  }

  // provisioning_jobs always lives in the POS project — see _supabase.js
  const supabase = getJobsClient();
  const { data, error } = await supabase
    .from("provisioning_jobs")
    .select("state, result, error")
    .eq("reference", reference)
    .maybeSingle();

  if (error || !data) {
    return { statusCode: 404, body: JSON.stringify({ state: "unknown" }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ state: data.state, result: data.result, error: data.error }),
  };
};

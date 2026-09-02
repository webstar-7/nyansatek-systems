/* ============================================================
   POST /.netlify/functions/register-agent
   Body: { role, fullName, email, phone, region, password,
           inviteCode (Manager/Accountant only), managerCode (Rep only) }

   Zero human review, instant approval -- this IS the application
   process. Two gates keep it from being wide open:
     - Sales Manager / Accountant-HR require MASTER_INVITE_CODE
       (a private env var only Robert knows and hands out personally).
     - Sales Rep requires an EXISTING active Sales Manager's own code,
       which permanently links them to that manager's team.
   Master itself is never created here -- there's only one, created
   directly, not through this form.

   Same-origin call (this page lives on the storefront itself), so no
   CORS handling needed here, unlike renew/upgrade-subscription.js.
   ============================================================ */

const { getJobsClient } = require("./_supabase");

const REGION_CODES = {
  Ahafo: "AH", Ashanti: "AS", Bono: "BO", "Bono East": "BE", Central: "CE",
  Eastern: "EA", "Greater Accra": "GA", "North East": "NE", Northern: "NO",
  Oti: "OT", Savannah: "SA", "Upper East": "UE", "Upper West": "UW",
  Volta: "VO", Western: "WE", "Western North": "WN",
};

const COMMISSION_RATES = { sales_rep: 10, sales_manager: 5, accountant_hr: 0 };

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { role, fullName, email, phone, region, password, inviteCode, managerCode } = body;

  if (!["sales_rep", "sales_manager", "accountant_hr"].includes(role)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid role" }) };
  }
  if (!fullName || !email || !phone || !region || !password) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields" }) };
  }
  if (!REGION_CODES[region]) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid region" }) };
  }
  if (password.length < 8) {
    return { statusCode: 400, body: JSON.stringify({ error: "Password must be at least 8 characters" }) };
  }

  const jobsDb = getJobsClient(); // sales_agents lives in the POS project regardless of role

  try {
    let managerId = null;

    if (role === "sales_manager" || role === "accountant_hr") {
      if (!inviteCode || inviteCode !== process.env.MASTER_INVITE_CODE) {
        return { statusCode: 403, body: JSON.stringify({ error: "Invalid invite code" }) };
      }
    } else if (role === "sales_rep") {
      if (!managerCode) {
        return { statusCode: 400, body: JSON.stringify({ error: "A recruiting manager's code is required" }) };
      }
      const { data: manager } = await jobsDb
        .from("sales_agents")
        .select("*")
        .eq("role", "sales_manager")
        .ilike("code", managerCode.trim())
        .eq("is_active", true)
        .maybeSingle();
      if (!manager) {
        return { statusCode: 404, body: JSON.stringify({ error: "That manager code wasn't found or is inactive" }) };
      }
      managerId = manager.id;
    }

    // ---- create the actual login ----
    const { data: authUser, error: authErr } = await jobsDb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, role },
    });
    if (authErr) {
      const msg = /already.*registered|already exists/i.test(authErr.message || "")
        ? "An account with this email already exists."
        : `Could not create account: ${authErr.message}`;
      return { statusCode: 400, body: JSON.stringify({ error: msg }) };
    }

    // ---- generate the unique code: N + region + global sequence ----
    // Requires a one-time SQL setup step -- see the note at the bottom
    // of this file. Supabase's client can't call nextval() on a raw
    // sequence directly; it needs a wrapping SQL function.
    const { data: seq, error: seqErr } = await jobsDb.rpc("nextval_sales_code");
    if (seqErr) {
      console.error("nextval_sales_code RPC failed -- has the one-time setup SQL been run?", seqErr);
      return { statusCode: 500, body: JSON.stringify({ error: "Server not fully configured yet. Please try again shortly or contact support." }) };
    }
    const code = `N${REGION_CODES[region]}${String(seq).padStart(4, "0")}`;

    const { error: insertErr } = await jobsDb.from("sales_agents").insert({
      full_name: fullName,
      email,
      phone,
      role,
      code,
      region,
      manager_id: managerId,
      commission_rate: COMMISSION_RATES[role],
      is_active: true,
      auth_user_id: authUser.user.id,
    });

    if (insertErr) {
      // Roll back the auth user so a failed registration doesn't leave
      // an orphaned login with no matching agent record.
      await jobsDb.auth.admin.deleteUser(authUser.user.id);
      return { statusCode: 500, body: JSON.stringify({ error: `Could not save your record: ${insertErr.message}` }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, code }) };
  } catch (err) {
    console.error("register-agent error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal error" }) };
  }
};

/* ============================================================
   ONE-TIME SETUP NEEDED before this works, run in the POS project:

   create or replace function nextval_sales_code()
   returns integer language sql as $$
     select nextval('sales_code_seq')::integer;
   $$;

   (Supabase's client can't call nextval() on a raw sequence directly
   via .rpc() -- it needs a wrapping SQL function. This one-liner
   provides that.)

   Also add MASTER_INVITE_CODE as a new Netlify environment variable
   on the storefront site -- pick your own private phrase, never
   share it publicly, hand it out personally to whoever you're
   bringing on as a Sales Manager or Accountant/HR.
   ============================================================ */

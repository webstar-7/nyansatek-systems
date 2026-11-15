/* ============================================================
   HRMS provisioner — NYANSATEK HRMS (the NYANSATEK Employee
   Management System, nyansatek.space), in the nyansatek-hrms
   Supabase project. Everything lives in that project's `hrms`
   schema; the client passed in here is already scoped to it
   (see _supabase.js), so .from("organizations") means
   hrms.organizations.

   Structure this relies on:
     hrms.organizations(id, name, country, currency, timezone,
       plan_key, status, paid_through_date, created_by,
       external_refs, ...)
       - plan_key is 'open' for organizations created before HRMS
         was sold; a purchase sets it to the catalog plan key
         ('standard' | 'yearly').
       - status is 'active' | 'trial' | 'suspended' | 'cancelled'.
         There is no subscription_status column here: the caller
         writes `status` instead (see verify-and-provision.js).
       - inserting a row fires triggers that seed leave types,
         attendance settings and call settings for the new org.
     hrms.org_members(org_id, user_id, role, email, display_name)
       - the buyer becomes the 'owner'.
     hrms.org_billing(org_id, plan_cycle, payment_channel, ...)
       - payment details. No RLS policies, so only this service
         key can read or write it; the app never sees it.

   The owner signs in at nyansatek.space with their EMAIL (the
   "Email" tab), not a business name. Staff IDs are created later,
   inside the app.

   Steps:
     1. Create the Supabase Auth user (email + temporary password).
     2. Create the organization.
     3. Add the buyer as its owner.
     4. Create the billing row.
   Any failure after step 1 deletes the organization (if created)
   and the auth user.
   ============================================================ */

async function provisionHRMS({ supabase, business, credentials, catalogPlan, reference }) {
  // ---- 1. The login ----
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email: business.email,
    password: credentials.tempPassword,
    email_confirm: true, // a paying customer, not a self sign-up
    // must_change_password makes the app ask for a new password at the first sign-in
    user_metadata: { full_name: business.ownerName, app: "hrms", must_change_password: true },
  });
  if (authErr) throw new Error(`Failed to create auth user: ${authErr.message}`);
  const userId = authData.user.id;

  let orgId = null;
  try {
    // ---- 2. The organization ----
    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .insert({
        name: business.businessName,
        country: "Ghana",
        currency: "GHS",
        timezone: "Africa/Accra",
        plan_key: business.plan,
        status: "active",
        created_by: userId,
        external_refs: { signup_reference: reference },
      })
      .select()
      .single();
    if (orgErr) throw new Error(`Failed to create organization: ${orgErr.message}`);
    orgId = org.id;

    // ---- 3. The buyer owns it ----
    const { error: memberErr } = await supabase.from("org_members").insert({
      org_id: orgId,
      user_id: userId,
      role: "owner",
      email: business.email,
      display_name: business.ownerName,
    });
    if (memberErr) throw new Error(`Failed to add the owner: ${memberErr.message}`);

    // ---- 4. Billing details (filled in further by the caller) ----
    const { error: billErr } = await supabase.from("org_billing").insert({
      org_id: orgId,
      plan_cycle: catalogPlan.cycle,
      signup_reference: reference,
      contact_email: business.email,
      contact_phone: business.phone,
    });
    if (billErr) throw new Error(`Failed to create billing row: ${billErr.message}`);

    return { id: orgId, authUserId: userId };
  } catch (err) {
    if (orgId) await supabase.from("organizations").delete().eq("id", orgId).then(() => {}, () => {});
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    throw err;
  }
}

module.exports = { provisionHRMS };

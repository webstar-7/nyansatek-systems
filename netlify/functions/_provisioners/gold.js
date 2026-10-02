/* ============================================================
   Gold provisioner — matches gold_schema.sql in the dedicated
   Gold Supabase project (see schema/gold_schema.sql).

   Mirrors provisionPOS's structure exactly:
     organizations(id, business_name, contact_email, is_active,
       plan_key, plan_cycle, signup_reference, pound_rate,
       blade_rate, resale_rate, world_gold_usd_oz, usd_ghs_rate)
     profiles(id, org_id, display_name, role, must_change_password,
       created_at, full_name, login_username, is_active, phone, address)
       - role: 'master' | 'owner' | 'staff'
       - profiles.id IS the auth.users.id (real Supabase Auth login)
       - NOTE: unlike the live POS project, the Gold Supabase project
         has no on_auth_user_created trigger -- this environment's
         Supabase connector blocks creating triggers directly on
         auth.users. So this provisioner INSERTs the profiles row
         itself right after creating the auth user, instead of
         relying on a trigger + UPDATE.
     login_lookup(business_name, login_email) -- same two-step
       login resolution as the live POS app: the login form tries
       login_lookup (owner, by business name) first, then
       staff_login_lookup (staff, by username).

   Provisioning steps:
     1. Create a Supabase Auth user (email + temp password).
     2. Create the organizations row (seeded with the default
        pricing rates -- the owner can change these from the app
        once logged in).
     3. INSERT the profiles row for this user: org_id, display_name,
        full_name, login_username, phone, address, must_change_password,
        role='owner'.
     4. Insert the login_lookup row so business-name login works.
     5. Seed an opening cashfloat row at 0 so the Cash & Balances
        view isn't empty/confusing on first login.

   Any failure after step 1 rolls back the auth user.
   ============================================================ */

async function provisionGold({ supabase, slug, business, credentials, catalogPlan, reference }) {
  // ---- 1. Create the actual login (Supabase Auth) ----
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email: business.email,
    password: credentials.tempPassword,
    email_confirm: true,
    user_metadata: { full_name: business.ownerName },
  });

  if (authErr) throw new Error(`Failed to create auth user: ${authErr.message}`);
  const userId = authData.user.id;

  try {
    // ---- 2. Create the organization (tenant) ----
    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .insert({
        business_name: business.businessName,
        contact_email: business.email,
        is_active: true,
        plan_key: business.plan,
        plan_cycle: catalogPlan.cycle,
        signup_reference: reference,
      })
      .select()
      .single();

    if (orgErr) throw new Error(`Failed to create organization: ${orgErr.message}`);

    // ---- 3. INSERT the profile row ourselves (no auth.users trigger
    //         exists in this Supabase project -- see header note) ----
    const { data: insertedProfile, error: profileErr } = await supabase
      .from("profiles")
      .insert({
        id: userId,
        org_id: org.id,
        display_name: business.ownerName,
        full_name: business.ownerName,
        role: "owner",
        must_change_password: true,
        login_username: slug,
        is_active: true,
        phone: business.phone,
        address: business.location,
      })
      .select()
      .maybeSingle();

    if (profileErr) throw new Error(`Failed to create profile: ${profileErr.message}`);
    if (!insertedProfile) {
      throw new Error("Profile row insert returned no data for the new auth user.");
    }

    // ---- 4. Make business-name login actually resolve ----
    const { error: lookupErr } = await supabase.from("login_lookup").insert({
      business_name: business.businessName,
      login_email: business.email,
    });

    if (lookupErr) throw new Error(`Failed to create login_lookup row: ${lookupErr.message}`);

    // ---- 5. Seed an opening (zero) cashfloat entry so Cash & Balances
    //         isn't an empty, confusing screen on first login ----
    const { error: floatErr } = await supabase.from("cashfloat").insert({
      org_id: org.id,
      amount: 0,
      note: "Opening balance",
    });

    if (floatErr) throw new Error(`Failed to seed opening cashfloat: ${floatErr.message}`);

    return { id: org.id, authUserId: userId };
  } catch (err) {
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    throw err;
  }
}

module.exports = { provisionGold };

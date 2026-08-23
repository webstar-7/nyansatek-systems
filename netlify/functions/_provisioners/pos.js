/* ============================================================
   POS provisioner — matches the real nyansatek-pos schema.

   Confirmed structure (via information_schema, Aug 2026):
     organizations(id, business_name, contact_email, created_at, is_active)
     profiles(id, org_id, display_name, role, must_change_password,
               created_at, full_name, login_username, is_active,
               phone, address)
       - role is constrained to: 'master' | 'admin' | 'cashier'
       - 'master' is reserved for the developer/platform owner
         (cross-tenant visibility) — NEVER assigned here.
         A business buying through checkout is the tenant owner,
         so they get 'admin'. They can create 'cashier' staff
         accounts themselves once logged in.
       - profiles.id is the SAME uuid as the corresponding
         auth.users row -- this app uses Supabase Auth for real
         sign-in, not a plaintext/hashed password column.
     staff_login_lookup -- a security-definer VIEW (not a table)
       mapping login_username -> login_email per org, used at
       sign-in time to resolve "username" to an actual email
       Supabase Auth can authenticate against.
     stores(id, org_id, name, created_at)

   So creating a real, working login here means THREE steps,
   not one insert:
     1. Create a Supabase Auth user (email + temp password)
     2. Create the organizations row
     3. Create the profiles row with id = that auth user's id,
        role = 'admin' (tenant owner tier — 'master' stays
        reserved for the developer's own cross-tenant access)
     4. Create the first store

   If any step after (1) fails, the auth user is rolled back
   (deleted) so a failed purchase never leaves an orphaned login
   floating in auth.users with no matching profile/org.
   ============================================================ */

async function provisionPOS({ supabase, slug, business, credentials }) {
  // ---- 1. Create the actual login (Supabase Auth) ----
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email: business.email,
    password: credentials.tempPassword,
    email_confirm: true, // skip email verification -- they're paying customers, not signups
    user_metadata: { full_name: business.ownerName },
  });

  if (authErr) throw new Error(`Failed to create auth user: ${authErr.message}`);
  const userId = authData.user.id;

  try {
    // ---- 2. Create the organization ----
    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .insert({
        business_name: business.businessName,
        contact_email: business.email,
        is_active: true,
      })
      .select()
      .single();

    if (orgErr) throw new Error(`Failed to create organization: ${orgErr.message}`);

    // ---- 3. Create the profile, linked to both the auth user and the org ----
    const { error: profileErr } = await supabase.from("profiles").insert({
      id: userId, // matches auth.users.id -- this IS the login
      org_id: org.id,
      display_name: business.ownerName,
      full_name: business.ownerName,
      role: "admin", // tenant owner tier — 'master' is reserved for the developer
      must_change_password: true,
      login_username: slug,
      is_active: true,
      phone: business.phone,
      address: business.location,
    });

    if (profileErr) throw new Error(`Failed to create profile: ${profileErr.message}`);

    // ---- 4. Seed the first store so the POS isn't empty on first login ----
    const { error: storeErr } = await supabase.from("stores").insert({
      org_id: org.id,
      name: "Main Store",
    });

    if (storeErr) throw new Error(`Failed to create store: ${storeErr.message}`);

    return { id: org.id, authUserId: userId };
  } catch (err) {
    // Roll back the auth user so a failed purchase never leaves a
    // dangling login with no organization/profile behind it.
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    throw err;
  }
}

module.exports = { provisionPOS };

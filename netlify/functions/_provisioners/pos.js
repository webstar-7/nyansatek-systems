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
         auth.users row — this app uses Supabase Auth for real
         sign-in, not a plaintext/hashed password column.
     staff_login_lookup — a security-definer VIEW (not a table)
       mapping login_username -> login_email per org, used at
       sign-in time to resolve "username" to an actual email
       Supabase Auth can authenticate against.
     stores(id, org_id, name, created_at)

   IMPORTANT — discovered via pg_trigger (Aug 2026): this project
   has an existing trigger `on_auth_user_created` that fires
   AFTER INSERT on auth.users and runs handle_new_user(), which
   does:
       insert into public.profiles (id, role) values (new.id, 'cashier');
   That means the moment we create the auth user below, a bare
   profiles row ALREADY EXISTS with role='cashier' and every
   other column NULL. We must UPDATE that row, not INSERT a new
   one — an insert collides on the primary key every time.

   Provisioning steps:
     1. Create a Supabase Auth user (email + temp password) —
        the trigger fires automatically here, creating a bare
        profiles row we don't control the initial contents of.
     2. Create the organizations row
     3. UPDATE the (already-existing) profiles row: set org_id,
        display_name, full_name, login_username, phone, address,
        must_change_password, is_active, and correct role to
        'admin' (overriding the trigger's default 'cashier').
     4. Create the first store

   If any step after (1) fails, the auth user is rolled back
   (deleted) — which also removes the trigger-created profiles
   row via cascade, since it's tied to auth.users.id.
   ============================================================ */

async function provisionPOS({ supabase, slug, business, credentials }) {
  // ---- 1. Create the actual login (Supabase Auth) ----
  // NOTE: this synchronously fires on_auth_user_created, which
  // inserts a bare public.profiles row for us before this call
  // even returns.
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

    // ---- 3. UPDATE the profile the trigger already created ----
    // Do NOT insert here -- the on_auth_user_created trigger beat
    // us to it with a bare (id, role='cashier') row.
    const { data: updatedProfile, error: profileErr } = await supabase
      .from("profiles")
      .update({
        org_id: org.id,
        display_name: business.ownerName,
        full_name: business.ownerName,
        role: "admin", // tenant owner tier -- overriding the trigger's default 'cashier'
        must_change_password: true,
        login_username: slug,
        is_active: true,
        phone: business.phone,
        address: business.location,
      })
      .eq("id", userId)
      .select()
      .maybeSingle();

    if (profileErr) throw new Error(`Failed to update profile: ${profileErr.message}`);
    if (!updatedProfile) {
      // The trigger didn't create a row for some reason -- don't
      // silently continue with a half-provisioned account.
      throw new Error("No profile row found to update for the new auth user (expected on_auth_user_created to have created one).");
    }

    // ---- 4. Seed the first store so the POS isn't empty on first login ----
    const { error: storeErr } = await supabase.from("stores").insert({
      org_id: org.id,
      name: "Main Store",
    });

    if (storeErr) throw new Error(`Failed to create store: ${storeErr.message}`);

    return { id: org.id, authUserId: userId };
  } catch (err) {
    // Roll back the auth user so a failed purchase never leaves a
    // dangling login. Deleting the auth user also removes the
    // trigger-created profiles row tied to it.
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    throw err;
  }
}

module.exports = { provisionPOS };

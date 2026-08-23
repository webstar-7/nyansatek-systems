/* ============================================================
   School provisioner — matches the real nyansatek-attendance
   schema (nyansatek.school).

   Confirmed structure (via information_schema, Aug 2026):
     institutions(id, name, type, contact_phone, contact_email,
                   address, is_active, created_at)
       - type is constrained to: 'school' | 'office' | 'other'
     inst_profiles(id, institution_id, display_name, role,
                     must_change_password, created_at, photo_url,
                     gender, date_of_birth, is_active, email,
                     phone, staff_code)
       - role is constrained to: 'master' | 'admin' | 'gate' |
         'teacher' | 'parent'
       - 'master' is reserved for the developer/platform owner
         (cross-tenant visibility) — NEVER assigned here.
         A school buying through checkout is the tenant owner,
         so they get 'admin'. Teacher/gate/parent accounts are
         created by the admin once logged in.
       - inst_profiles.id is the SAME uuid as the corresponding
         auth.users row — Supabase Auth handles real sign-in.
     inst_login_lookup(institution_name, login_email) — a plain
       BASE TABLE (not a view/derived), with no foreign keys.
       The login screen looks up an institution name typed by
       the user and resolves it to the email Supabase Auth
       actually authenticates against. Provisioning MUST insert
       a row here directly, or the school admin will have a
       working auth user with no way to log in by name.
     school_classes(id, institution_id, class_name, level,
                     class_teacher, class_teacher_id, is_active,
                     created_at)

   Provisioning steps:
     1. Create a Supabase Auth user (email + temp password)
     2. Create the institutions row (type = 'school')
     3. Create the inst_profiles row, id = that auth user's id,
        role = 'admin'
     4. Create the inst_login_lookup row so name-based login
        actually resolves to the right account
     5. Seed a first class so the school isn't empty on login

   If any step after (1) fails, the auth user is rolled back
   (deleted) so a failed purchase never leaves an orphaned login
   with no institution/profile behind it.
   ============================================================ */

async function provisionSchool({ supabase, slug, business, credentials }) {
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
    // ---- 2. Create the institution ----
    const { data: institution, error: instErr } = await supabase
      .from("institutions")
      .insert({
        name: business.businessName,
        type: "school",
        contact_phone: business.phone,
        contact_email: business.email,
        address: business.location,
        is_active: true,
      })
      .select()
      .single();

    if (instErr) throw new Error(`Failed to create institution: ${instErr.message}`);

    // ---- 3. Create the profile, linked to both the auth user and the institution ----
    const { error: profileErr } = await supabase.from("inst_profiles").insert({
      id: userId, // matches auth.users.id -- this IS the login
      institution_id: institution.id,
      display_name: business.ownerName,
      role: "admin", // tenant owner tier — 'master' is reserved for the developer
      must_change_password: true,
      email: business.email,
      phone: business.phone,
      is_active: true,
    });

    if (profileErr) throw new Error(`Failed to create inst_profiles row: ${profileErr.message}`);

    // ---- 4. Make name-based login actually resolve ----
    // inst_login_lookup is a plain table, not auto-derived —
    // without this row, the login screen has no way to turn the
    // institution name the admin types into the email Supabase
    // Auth needs.
    const { error: lookupErr } = await supabase.from("inst_login_lookup").insert({
      institution_name: business.businessName,
      login_email: business.email,
    });

    if (lookupErr) throw new Error(`Failed to create inst_login_lookup row: ${lookupErr.message}`);

    // ---- 5. Seed a first class so the school isn't empty on first login ----
    const { error: classErr } = await supabase.from("school_classes").insert({
      institution_id: institution.id,
      class_name: "Class 1",
      is_active: true,
    });

    if (classErr) throw new Error(`Failed to create school_classes row: ${classErr.message}`);

    return { id: institution.id, authUserId: userId };
  } catch (err) {
    // Roll back the auth user so a failed purchase never leaves a
    // dangling login with no institution/profile behind it.
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    throw err;
  }
}

module.exports = { provisionSchool };

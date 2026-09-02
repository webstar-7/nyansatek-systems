/* ============================================================
   School provisioner — matches the real nyansatek-attendance
   schema (nyansatek.school).

   Confirmed structure (via information_schema, Aug 2026):
     institutions(id, name, type, contact_phone, contact_email,
                   address, is_active, created_at, plan_key,
                   plan_cycle, max_students, signup_reference)
       - type is constrained to: 'school' | 'office' | 'other'
       - plan_key/plan_cycle/max_students added Aug 2026 so the real
         School app can enforce plan limits -- previously the
         purchased plan only lived in provisioning_jobs.payload,
         invisible to the tenant record itself. signup_reference
         ties the row back to its originating Paystack transaction.
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

   IMPORTANT — discovered via pg_trigger (Aug 2026): this project
   has an existing trigger `on_inst_user_created` that fires
   AFTER INSERT on auth.users and runs handle_new_inst_user(),
   which does:
       insert into public.inst_profiles (id, role) values (new.id, 'gate');
   That means the moment we create the auth user below, a bare
   inst_profiles row ALREADY EXISTS with role='gate' and every
   other column NULL. We must UPDATE that row, not INSERT a new
   one — an insert collides on the primary key every time.

   Provisioning steps:
     1. Create a Supabase Auth user (email + temp password) —
        the trigger fires automatically here, creating a bare
        inst_profiles row we don't control the initial contents of.
     2. Create the institutions row (type = 'school')
     3. UPDATE the (already-existing) inst_profiles row: set
        institution_id, display_name, email, phone, is_active,
        must_change_password, and correct role to 'admin'
        (overriding the trigger's default 'gate').
     4. Create the inst_login_lookup row so name-based login
        actually resolves to the right account
     5. Seed a first class so the school isn't empty on login

   If any step after (1) fails, the auth user is rolled back
   (deleted) — which also removes the trigger-created
   inst_profiles row via cascade, since it's tied to auth.users.id.
   ============================================================ */

async function provisionSchool({ supabase, slug, business, credentials, catalogPlan, reference }) {
  // With only 2 plans left (monthly/yearly, see _catalog.js), the higher
  // student cap is now a yearly-commitment benefit rather than a
  // separate paid tier: monthly = 300 students, yearly = 800 students.
  const maxStudents = business.plan === "yearly" ? 800 : 300;

  // ---- 1. Create the actual login (Supabase Auth) ----
  // NOTE: this synchronously fires on_inst_user_created, which
  // inserts a bare public.inst_profiles row for us before this
  // call even returns.
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
        plan_key: business.plan,
        plan_cycle: catalogPlan.cycle,
        max_students: maxStudents,
        signup_reference: reference,
      })
      .select()
      .single();

    if (instErr) throw new Error(`Failed to create institution: ${instErr.message}`);

    // ---- 3. UPDATE the profile the trigger already created ----
    // Do NOT insert here -- the on_inst_user_created trigger beat
    // us to it with a bare (id, role='gate') row.
    const { data: updatedProfile, error: profileErr } = await supabase
      .from("inst_profiles")
      .update({
        institution_id: institution.id,
        display_name: business.ownerName,
        role: "admin", // tenant owner tier -- overriding the trigger's default 'gate'
        must_change_password: true,
        email: business.email,
        phone: business.phone,
        is_active: true,
      })
      .eq("id", userId)
      .select()
      .maybeSingle();

    if (profileErr) throw new Error(`Failed to update inst_profiles row: ${profileErr.message}`);
    if (!updatedProfile) {
      throw new Error("No inst_profiles row found to update for the new auth user (expected on_inst_user_created to have created one).");
    }

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
      level: "Basic 1", // required column -- discovered via NOT NULL violation, Aug 2026
      is_active: true,
    });

    if (classErr) throw new Error(`Failed to create school_classes row: ${classErr.message}`);

    return { id: institution.id, authUserId: userId };
  } catch (err) {
    // Roll back the auth user so a failed purchase never leaves a
    // dangling login. Deleting the auth user also removes the
    // trigger-created inst_profiles row tied to it.
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    throw err;
  }
}

module.exports = { provisionSchool };

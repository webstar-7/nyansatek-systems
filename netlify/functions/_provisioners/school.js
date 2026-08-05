/* ============================================================
   School provisioner
   Adapt table/column names to match the nyansatek-attendance
   schema once it's finalized under nyansatek.school.
   ============================================================ */

async function provisionSchool({ supabase, slug, business, credentials }) {
  const { data: tenant, error: tenantErr } = await supabase
    .from("schools")
    .insert({
      slug,
      name: business.businessName,
      admin_name: business.ownerName,
      phone: business.phone,
      email: business.email,
      location: business.location,
      plan: business.plan,
      status: "active",
      username: slug,
      password_needs_reset: true,
      temp_password: credentials.tempPassword,
    })
    .select()
    .single();

  if (tenantErr) throw new Error(`Failed to create school: ${tenantErr.message}`);

  // Seed the standard 3-term academic year and a starter class
  // so attendance can be taken immediately.
  const terms = ["Term 1", "Term 2", "Term 3"];
  await supabase.from("terms").insert(
    terms.map((name) => ({ school_id: tenant.id, name }))
  );
  await supabase.from("classes").insert([{ school_id: tenant.id, name: "Class 1" }]);

  return tenant;
}

module.exports = { provisionSchool };

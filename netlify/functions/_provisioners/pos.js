/* ============================================================
   POS provisioner
   Adapt the table/column names below to match your existing
   tenant-onboarding-template.sql schema for nyansatek.shop.
   ============================================================ */

async function provisionPOS({ supabase, slug, business, credentials }) {
  // 1. Create the business/tenant row
  const { data: tenant, error: tenantErr } = await supabase
    .from("businesses")
    .insert({
      slug,
      name: business.businessName,
      owner_name: business.ownerName,
      phone: business.phone,
      email: business.email,
      location: business.location,
      product: "pos",
      plan: business.plan,
      status: "active",
      username: slug,
      password_needs_reset: true,
      // Store a hash, not the plain password, in production.
      // This demo assumes your existing login flow hashes on
      // first "Set a New Password" — adapt as needed.
      temp_password: credentials.tempPassword,
    })
    .select()
    .single();

  if (tenantErr) throw new Error(`Failed to create business: ${tenantErr.message}`);

  // 2. Seed sensible defaults so the shop isn't empty on first login
  const defaultCategories = ["General", "Beverages", "Provisions", "Toiletries"];
  await supabase.from("categories").insert(
    defaultCategories.map((name) => ({ business_id: tenant.id, name }))
  );

  // 3. Set up the 3-store structure referenced in the POS UI
  await supabase.from("stores").insert([
    { business_id: tenant.id, name: "Main Store" },
  ]);

  return tenant;
}

module.exports = { provisionPOS };

/* ============================================================
   POST /.netlify/functions/verify-and-provision
   Body: { reference, order: { product, plan, businessName,
           ownerName, phone, email, location } }

   This is the heart of "no human interaction":
   1. Re-verify the transaction directly with Paystack (never
      trust amount/status from the client or the URL).
   2. Idempotency check — a reference is only ever provisioned once,
      even if this endpoint is called twice (e.g. webhook + client
      callback both fire).
   3. Create the tenant + starter data, in whichever Supabase
      PROJECT actually backs the product purchased (POS and
      School are two separate projects — see _supabase.js).
   4. Send credentials by SMS + email.

   Every step's progress is written to `provisioning_jobs`, which
   lives in the POS project regardless of which product was
   bought (it's the storefront's own bookkeeping table, not
   tenant data — see getJobsClient() in _supabase.js).
   ============================================================ */

const { CATALOG } = require("./_catalog");
const { getSupabaseFor, getJobsClient } = require("./_supabase");
const { generateBusinessSlug, generateTempPassword } = require("./_lib/credentials");
const { sendSMS, sendEmail, welcomeEmailHTML } = require("./_lib/notify");
const { provisionPOS } = require("./_provisioners/pos");
const { provisionSchool } = require("./_provisioners/school");

const PROVISIONERS = { pos: provisionPOS, school: provisionSchool };

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const { reference, order } = body;
  if (!reference || !order) {
    return { statusCode: 400, body: "Missing reference or order details" };
  }

  const catalogProduct = CATALOG[order.product];
  const catalogPlan = catalogProduct && catalogProduct.plans[order.plan];
  if (!catalogProduct || !catalogPlan) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Unknown product or plan" }) };
  }

  // Jobs table always lives in the POS project (bookkeeping, not tenant data).
  const jobsDb = getJobsClient();
  // Tenant data goes into whichever project actually backs this product.
  const tenantDb = getSupabaseFor(order.product);

  try {
    // ---- idempotency: has this reference already been handled? ----
    const { data: existing } = await jobsDb
      .from("provisioning_jobs")
      .select("*")
      .eq("reference", reference)
      .maybeSingle();

    if (existing) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, alreadyHandled: true }) };
    }

    // Claim this reference immediately so a concurrent call
    // (e.g. webhook firing at the same moment) doesn't double-provision.
    await jobsDb.from("provisioning_jobs").insert({
      reference,
      state: "verifying",
      product: order.product,
      payload: order,
    });

    // ---- 1. verify the transaction with Paystack directly ----
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    const verifyJson = await verifyRes.json();

    const txn = verifyJson.data;
    const isValid =
      verifyJson.status === true &&
      txn &&
      txn.status === "success" &&
      txn.currency === "GHS" &&
      txn.amount === catalogPlan.price;

    if (!isValid) {
      await jobsDb
        .from("provisioning_jobs")
        .update({ state: "failed", error: "payment_verification_failed" })
        .eq("reference", reference);
      return { statusCode: 402, body: JSON.stringify({ ok: false, error: "Payment could not be verified" }) };
    }

    // ---- 2. create the tenant in the RIGHT Supabase project ----
    await jobsDb.from("provisioning_jobs").update({ state: "seeding" }).eq("reference", reference);

    const slug = generateBusinessSlug(order.businessName);
    const tempPassword = generateTempPassword();
    const provisioner = PROVISIONERS[order.product];
    const tenant = await provisioner({
      supabase: tenantDb, // <-- POS orders write to the POS project, School orders to the School project
      slug,
      business: { ...order, plan: order.plan },
      credentials: { tempPassword },
    });

    // ---- 3. notify the customer ----
    await jobsDb.from("provisioning_jobs").update({ state: "notifying" }).eq("reference", reference);

    const smsText = `Welcome to ${catalogProduct.name}! Login: ${catalogProduct.loginUrl} | User: ${slug} | Pass: ${tempPassword}`;
    await Promise.allSettled([
      sendSMS(order.phone, smsText),
      sendEmail({
        to: order.email,
        subject: `Your ${catalogProduct.name} account is ready`,
        html: welcomeEmailHTML({
          ownerName: order.ownerName,
          productName: catalogProduct.name,
          loginUrl: catalogProduct.loginUrl,
          username: slug,
          tempPassword,
        }),
      }),
    ]);

    // ---- 4. mark complete ----
    const result = {
      productName: catalogProduct.name,
      loginUrl: catalogProduct.loginUrl,
      username: slug,
      tempPassword,
      tenantId: tenant.id,
    };

    await jobsDb
      .from("provisioning_jobs")
      .update({ state: "complete", result })
      .eq("reference", reference);

    return { statusCode: 200, body: JSON.stringify({ ok: true, result }) };
  } catch (err) {
    console.error("Provisioning failed:", err);
    await jobsDb
      .from("provisioning_jobs")
      .update({ state: "failed", error: String(err.message || err) })
      .eq("reference", reference);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: "Provisioning failed" }) };
  }
};

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

    // Claim this reference immediately so a concurrent call (e.g. the
    // Paystack webhook and the browser's own callback both firing for
    // the same purchase) doesn't double-provision. `reference` has a
    // UNIQUE constraint, so if another request claimed it a moment ago,
    // this insert fails — and unlike before, we now actually check for
    // that and stop here instead of silently continuing on to create a
    // second account for the same purchase.
    const { error: claimErr } = await jobsDb.from("provisioning_jobs").insert({
      reference,
      state: "verifying",
      product: order.product,
      payload: order,
    });

    if (claimErr) {
      // Someone else (webhook or client callback) is already handling
      // this exact reference. Not an error from the customer's point
      // of view — just step back and let that other request finish.
      return { statusCode: 200, body: JSON.stringify({ ok: true, alreadyHandled: true }) };
    }

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
      // Build a specific, diagnosable reason instead of a generic
      // message — this gets stored on the job and is readable via
      // provision-status without needing to dig through function logs.
      const reasons = [];
      if (verifyRes.status !== 200) reasons.push(`http_status=${verifyRes.status}`);
      if (verifyJson.status !== true) reasons.push(`paystack_status_false: ${verifyJson.message || "no message"}`);
      if (!txn) reasons.push("no_transaction_data_returned");
      if (txn && txn.status !== "success") reasons.push(`txn_status=${txn.status}`);
      if (txn && txn.currency !== "GHS") reasons.push(`currency=${txn.currency}`);
      if (txn && txn.amount !== catalogPlan.price) {
        reasons.push(`amount_mismatch: paystack=${txn.amount} expected=${catalogPlan.price}`);
      }

      await jobsDb
        .from("provisioning_jobs")
        .update({ state: "failed", error: `payment_verification_failed [${reasons.join("; ")}]` })
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

    // The two products authenticate differently on the real login
    // screens: POS resolves profiles.login_username (a friendly
    // slug) via the staff_login_lookup view, so the slug IS the
    // real credential there. School's login screen takes an email
    // directly (teachers/parents log in by email too, so the whole
    // product is email-identified) -- sending the slug as "User:"
    // there produces a credential the login page structurally can't
    // accept (it HTML5-validates as an email field).
    const loginIdentifier = order.product === "school" ? order.email : slug;

    const smsText = `Welcome to ${catalogProduct.name}! Login: ${catalogProduct.loginUrl} | User: ${loginIdentifier} | Pass: ${tempPassword}`;
    await Promise.allSettled([
      sendSMS(order.phone, smsText),
      sendEmail({
        to: order.email,
        subject: `Your ${catalogProduct.name} account is ready`,
        html: welcomeEmailHTML({
          ownerName: order.ownerName,
          productName: catalogProduct.name,
          loginUrl: catalogProduct.loginUrl,
          username: loginIdentifier,
          tempPassword,
        }),
      }),
    ]);

    // ---- 4. mark complete ----
    const result = {
      productName: catalogProduct.name,
      loginUrl: catalogProduct.loginUrl,
      username: loginIdentifier,
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

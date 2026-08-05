/* ============================================================
   Notifications — SMS via Hubtel, email via Resend.
   Swap providers here without touching provisioning logic.
   ============================================================ */

async function sendSMS(phone, message) {
  const clientId = process.env.HUBTEL_CLIENT_ID;
  const clientSecret = process.env.HUBTEL_CLIENT_SECRET;
  const from = process.env.HUBTEL_SENDER_ID || "NYANSATEK";
  if (!clientId || !clientSecret) {
    console.warn("Hubtel not configured — skipping SMS send");
    return { skipped: true };
  }

  // Normalize to international format for Ghana numbers (e.g. 0244xxxxxx -> 233244xxxxxx)
  const to = phone.startsWith("0") ? "233" + phone.slice(1) : phone.replace(/\D/g, "");

  const url = `https://smsc.hubtel.com/v1/messages/send?clientid=${clientId}&clientsecret=${clientSecret}&from=${encodeURIComponent(
    from
  )}&to=${to}&content=${encodeURIComponent(message)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Hubtel SMS failed: ${res.status}`);
  return res.json();
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "NYANSATEK Systems <accounts@nyansatek.systems>";
  if (!apiKey) {
    console.warn("Resend not configured — skipping email send");
    return { skipped: true };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend email failed: ${res.status}`);
  return res.json();
}

function welcomeEmailHTML({ ownerName, productName, loginUrl, username, tempPassword }) {
  return `
  <div style="font-family:Arial,sans-serif; max-width:520px; margin:0 auto; color:#1a1a1a;">
    <h2 style="color:#B98637;">Welcome to ${productName}</h2>
    <p>Hi ${ownerName},</p>
    <p>Your account is ready. Here are your login details:</p>
    <table style="width:100%; border-collapse:collapse; margin:16px 0;">
      <tr><td style="padding:8px 0; color:#555;">Login URL</td><td style="padding:8px 0;"><a href="${loginUrl}">${loginUrl}</a></td></tr>
      <tr><td style="padding:8px 0; color:#555;">Username</td><td style="padding:8px 0;">${username}</td></tr>
      <tr><td style="padding:8px 0; color:#555;">Temporary password</td><td style="padding:8px 0;"><strong>${tempPassword}</strong></td></tr>
    </table>
    <p>You'll be asked to set your own password the first time you sign in.</p>
    <p>Questions? Reply to this email or call 0536 340 578.</p>
    <p>— NYANSATEK Systems</p>
  </div>`;
}

module.exports = { sendSMS, sendEmail, welcomeEmailHTML };

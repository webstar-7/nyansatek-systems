/* ============================================================
   NYANSATEK Systems — checkout.js
   Reads product/plan from the URL, collects business details,
   and opens Paystack Inline for payment. On success, the
   Paystack reference + business details are handed to the
   provisioning function, and the customer is sent to success.html
   to watch (and receive) their new account.

   REQUIRES: js/products.js loaded first, and
   window.PAYSTACK_PUBLIC_KEY set below to your real key.
   ============================================================ */

const PAYSTACK_PUBLIC_KEY = "pk_live_f06348c9521967084c78419c709c740c7d3b51d2";

const params = new URLSearchParams(window.location.search);
const productId = params.get("product") || "pos";
const planId = params.get("plan") || "standard";
// Where the buyer came from. Only known values are passed on: "store" (a shop from "List your
// shop" on nyansatek.store) or "food" (a restaurant from "List your restaurant" on nyansatek.food).
// Its online add-on is then switched on and its request to join that marketplace sent automatically
// when the account is made (see _provisioners/pos.js).
const source = ["store", "food"].includes(params.get("source")) ? params.get("source") : "";

const product = NYANSATEK_CATALOG[productId];
const plan = product ? product.plans[planId] : null;

const els = {
  crumb: document.getElementById("crumb-product"),
  sProduct: document.getElementById("summary-product"),
  sPlan: document.getElementById("summary-plan"),
  sPrice: document.getElementById("summary-price"),
  sCycle: document.getElementById("summary-cycle"),
  total: document.getElementById("total-amount"),
  form: document.getElementById("checkout-form"),
  payBtn: document.getElementById("pay-btn"),
  errBox: document.getElementById("status-error"),
  infoBox: document.getElementById("status-info"),
};

function showError(msg) {
  els.errBox.textContent = msg;
  els.errBox.classList.add("show");
  els.infoBox.classList.remove("show");
}
function showInfo(msg) {
  els.infoBox.textContent = msg;
  els.infoBox.classList.add("show");
  els.errBox.classList.remove("show");
}

if (!product || !plan) {
  showError("We couldn't find that product or plan. Please go back and choose again.");
  els.payBtn.disabled = true;
} else {
  els.crumb.textContent = product.name;
  els.sProduct.textContent = product.name;
  els.sPlan.textContent = plan.label;
  els.sPrice.textContent = formatGHS(plan.price);
  els.sCycle.textContent = plan.cycleLabel;
  els.total.textContent = formatGHS(plan.price);
  document.title = `Checkout — ${product.name} — NYANSATEK Systems`;
  // Products you sign in to with an email (HRMS): the name is the organization's name, not a login.
  if (product.loginBy === "email") {
    const nameLabel = document.querySelector('label[for="businessName"]');
    const nameHint = document.querySelector("#businessName + .hint");
    const emailHint = document.querySelector("#email + .hint");
    if (nameLabel) nameLabel.textContent = "Organization name";
    if (nameHint) nameHint.textContent = "Shown to your staff inside the app. You can change it later.";
    if (emailHint) emailHint.textContent = "You sign in with this email. Your receipt and temporary password go here too.";
  }
}

// Can this product be delivered right now? Asked before any payment is taken (see checkout-ready.js).
// Only a clear "no" stops the checkout: if the question itself cannot be asked (offline blip, the
// function not deployed yet), we carry on exactly as before rather than turn every buyer away.
async function checkoutReady() {
  try {
    const res = await fetch("/.netlify/functions/checkout-ready?product=" + encodeURIComponent(productId), { cache: "no-store" });
    if (!res.ok) return true;
    const json = await res.json();
    return json.ready !== false;
  } catch (e) {
    return true;
  }
}

els.form.addEventListener("submit", async function (e) {
  e.preventDefault();
  if (!product || !plan) return;

  const businessName = document.getElementById("businessName").value.trim();
  const ownerName = document.getElementById("ownerName").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const email = document.getElementById("email").value.trim();
  const location = document.getElementById("location").value.trim();
  const salesCode = document.getElementById("salesCode").value.trim();
  const momoProvider = document.getElementById("momoProvider").value;

  if (!businessName || !ownerName || !phone || !email || !location) {
    showError("Please fill in every field before continuing to payment.");
    return;
  }

  els.payBtn.disabled = true;
  els.payBtn.textContent = "Checking…";
  if (!(await checkoutReady())) {
    els.payBtn.disabled = false;
    els.payBtn.textContent = "Pay with Mobile Money or Card";
    showError("We can't take online orders for " + product.name + " right now, so nothing has been charged. Please call or WhatsApp 0536 340 578 and we will set you up.");
    return;
  }
  els.payBtn.textContent = "Opening payment window…";

  // Reference generated client-side for tracking; the backend
  // re-verifies the actual amount/status with Paystack directly,
  // so this value is never trusted for the charge itself.
  const reference = `NYT-${productId}-${Date.now()}`;

  const handler = PaystackPop.setup({
    key: PAYSTACK_PUBLIC_KEY,
    email: email,
    amount: plan.price, // pesewas
    currency: "GHS",
    ref: reference,
    channels: ["mobile_money", "card"],
    metadata: {
      product: productId,
      plan: planId,
      businessName,
      ownerName,
      phone,
      location,
      source,
      custom_fields: [
        { display_name: "Business", variable_name: "business_name", value: businessName },
        { display_name: "Product", variable_name: "product", value: product.name },
      ],
    },
    callback: function (response) {
      // Hand off to success.html, which calls the provisioning
      // function and polls until the account is ready.
      const payload = {
        reference: response.reference,
        product: productId,
        plan: planId,
        businessName, ownerName, phone, email, location, salesCode, momoProvider, source,
      };
      sessionStorage.setItem("nyansatek_order", JSON.stringify(payload));
      window.location.href = "success.html?ref=" + encodeURIComponent(response.reference);
    },
    onClose: function () {
      els.payBtn.disabled = false;
      els.payBtn.textContent = "Pay with Mobile Money or Card";
      showInfo("Payment window closed. No charge was made — you can try again when ready.");
    },
  });

  handler.openIframe();
});

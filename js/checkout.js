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

const PAYSTACK_PUBLIC_KEY = "pk_test_REPLACE_WITH_YOUR_PAYSTACK_PUBLIC_KEY";

const params = new URLSearchParams(window.location.search);
const productId = params.get("product") || "pos";
const planId = params.get("plan") || "standard";

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
}

els.form.addEventListener("submit", function (e) {
  e.preventDefault();
  if (!product || !plan) return;

  const businessName = document.getElementById("businessName").value.trim();
  const ownerName = document.getElementById("ownerName").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const email = document.getElementById("email").value.trim();
  const location = document.getElementById("location").value.trim();

  if (!businessName || !ownerName || !phone || !email || !location) {
    showError("Please fill in every field before continuing to payment.");
    return;
  }

  els.payBtn.disabled = true;
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
        businessName, ownerName, phone, email, location,
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

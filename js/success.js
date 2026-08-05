/* ============================================================
   NYANSATEK Systems — success.js
   Calls the provisioning function with the paid reference,
   then polls for completion and reveals the new login.
   ============================================================ */

const orderRaw = sessionStorage.getItem("nyansatek_order");
const params = new URLSearchParams(window.location.search);
const reference = params.get("ref") || (orderRaw && JSON.parse(orderRaw).reference);

const stepEls = {
  account: document.querySelector('[data-step="account"]'),
  data: document.querySelector('[data-step="data"]'),
  notify: document.querySelector('[data-step="notify"]'),
};
const resultBlock = document.getElementById("result-block");
const errorBlock = document.getElementById("error-block");

function setStep(name, state) {
  const el = stepEls[name];
  if (!el) return;
  el.classList.remove("done", "active", "pending");
  el.classList.add(state);
  el.querySelector(".dot").textContent = state === "done" ? "✓" : "";
}

function showResult(data) {
  document.getElementById("res-system").textContent = data.productName;
  document.getElementById("res-url").textContent = data.loginUrl;
  document.getElementById("res-username").textContent = data.username;
  document.getElementById("res-password").textContent = data.tempPassword;
  document.getElementById("go-to-system").href = data.loginUrl;
  resultBlock.style.display = "block";
}

function showFailure() {
  document.getElementById("err-ref").textContent = reference || "—";
  errorBlock.style.display = "block";
}

async function run() {
  if (!reference) {
    showFailure();
    return;
  }

  const order = orderRaw ? JSON.parse(orderRaw) : null;

  try {
    // Kick off provisioning (idempotent server-side on `reference`).
    const startRes = await fetch("/.netlify/functions/verify-and-provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference, order }),
    });

    if (!startRes.ok) throw new Error("start failed");
    setStep("account", "done");
    setStep("data", "active");

    // Poll job status until done or failed (max ~40s).
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const statusRes = await fetch(
        "/.netlify/functions/provision-status?reference=" + encodeURIComponent(reference)
      );
      if (!statusRes.ok) continue;
      const status = await statusRes.json();

      if (status.state === "seeding") {
        setStep("data", "active");
      } else if (status.state === "notifying") {
        setStep("data", "done");
        setStep("notify", "active");
      } else if (status.state === "complete") {
        setStep("data", "done");
        setStep("notify", "done");
        showResult(status.result);
        sessionStorage.removeItem("nyansatek_order");
        return;
      } else if (status.state === "failed") {
        throw new Error(status.error || "provisioning failed");
      }
    }
    throw new Error("timeout");
  } catch (err) {
    showFailure();
  }
}

run();

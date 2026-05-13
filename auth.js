// ============================================================
// auth.js - SaleStation
// Authentication: login, register, forgot password, Paystack
// Loaded by: auth.html only
// ============================================================

// FIX 18: selectedPlan was previously declared in shared.js (global pollution).
// It belongs only here — auth.js is the only file that uses it.
let selectedPlan = "starter";

function updatePlanPriceDisplay() {
  // Subscription prices are ALWAYS in ZAR - always show R prefix regardless of selected country
  const trialEl = document.getElementById("plan-price-trial");
  const starterEl = document.getElementById("plan-price-starter");
  const premiumEl = document.getElementById("plan-price-premium");
  if (trialEl) trialEl.innerHTML = `R0<span>/7 days</span>`;
  if (starterEl)
    starterEl.innerHTML = `R${PLAN_LIMITS.starter.price}<span>/mo</span>`;
  if (premiumEl)
    premiumEl.innerHTML = `R${PLAN_LIMITS.premium.price}<span>/mo</span>`;
  // Show international note if non-ZAR country selected
  const currencyVal =
    document.getElementById("reg-currency")?.value || "ZAR|R|South Africa";
  const parts = currencyVal.split("|");
  let intlNote = document.getElementById("intl-currency-note");
  if (!intlNote) {
    intlNote = document.createElement("div");
    intlNote.id = "intl-currency-note";
    intlNote.style.cssText =
      "font-size:11px;color:var(--blue);background:var(--blue-bg);border:1px solid #c0d1f5;border-radius:var(--radius);padding:8px 10px;margin-top:8px";
    const planTrialEl = document.getElementById("plan-trial");
    if (planTrialEl) planTrialEl.parentNode.insertBefore(intlNote, planTrialEl);
  }
  if (parts[0] && parts[0] !== "ZAR") {
    intlNote.style.display = "block";
    intlNote.textContent = `All subscription prices are in South African Rand (ZAR). As a ${parts[2]} business, your bank will convert the charge to ${parts[0]} at the prevailing exchange rate.`;
  } else {
    intlNote.style.display = "none";
  }
}

function goToPlanPage() {
  const bizTypeEl = document.getElementById("reg-biz-type");
  if (bizTypeEl && !bizTypeEl.value) {
    bizTypeEl.classList.add("invalid");
    toast("Please select a business type", "error");
    return;
  }
  if (bizTypeEl) bizTypeEl.classList.remove("invalid");
  const bizName = document.getElementById("reg-biz").value.trim();
  const owner = document.getElementById("reg-owner").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;

  ["reg-biz", "reg-owner", "reg-email", "reg-password"].forEach((id) =>
    document.getElementById(id).classList.remove("invalid")
  );
  let errors = [];
  if (!bizName) {
    document.getElementById("reg-biz").classList.add("invalid");
    errors.push("Business name");
  }
  if (!owner) {
    document.getElementById("reg-owner").classList.add("invalid");
    errors.push("Owner name");
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    document.getElementById("reg-email").classList.add("invalid");
    errors.push("Valid email");
  }
  if (!password || password.length < 6) {
    document.getElementById("reg-password").classList.add("invalid");
    errors.push("Password (min. 6 chars)");
  }
  if (errors.length) {
    toast("Please fill in: " + errors.join(", "), "error");
    return;
  }

  const store = getStore();
  if (store.users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
    document.getElementById("reg-email").classList.add("invalid");
    toast("An account with this email already exists", "error");
    return;
  }
  showPage("register-plan-page");
  updatePlanPriceDisplay();
  // Pre-select the plan if the user arrived via a plan-specific link from the pricing page
  if (window._preselectedPlan) {
    selectPlan(window._preselectedPlan);
    window._preselectedPlan = null;
  }
}

function showForgotPassword() {
  // Fix 14: Password reset via email lookup (sets a temporary password displayed to user)
  openModal(
    "Reset Password",
    `
        <p style="font-size:13px;color:var(--gray-500);margin-bottom:16px">Enter the email address associated with your account. A new temporary password will be shown.</p>
        <div class="form-group"><label class="form-label">Email Address</label><input id="fp-email" class="form-input" type="email" placeholder="name@business.com" /></div>
        <div style="display:flex;gap:10px;margin-top:4px">
          <button class="btn btn-outline btn-lg" style="flex:1" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary btn-lg" style="flex:2" onclick="handleForgotPassword()">Reset Password</button>
        </div>
      `
  );
}

function handleForgotPassword() {
  const email = document.getElementById("fp-email")?.value.trim().toLowerCase();
  if (!email) {
    toast("Please enter your email address", "error");
    return;
  }
  const store = getStore();
  const user = store.users.find((u) => u.email.toLowerCase() === email);
  if (!user) {
    toast("No account found with that email address", "error");
    return;
  }
  // Generate a cryptographically stronger temporary password
  const arr = new Uint32Array(2);
  crypto.getRandomValues(arr);
  const tempPass =
    "T" +
    arr[0].toString(36).toUpperCase() +
    arr[1].toString(36).toUpperCase().slice(0, 4);
  updateStore((d) => ({
    ...d,
    users: d.users.map((u) =>
      u.email.toLowerCase() === email ? { ...u, password: tempPass } : u
    ),
  }));
  // Close first modal then open second - lock the overlay so clicking outside won't close the password modal
  document.getElementById("modal-overlay").classList.remove("open");
  setTimeout(() => {
    document.getElementById("modal-title").innerHTML = "Password Reset";
    document.getElementById("modal-body").innerHTML = `
        <div style="text-align:center;padding:12px 0">
          <p style="font-size:13px;color:var(--gray-600);margin-bottom:16px">Your temporary password is:</p>
          <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius);padding:14px;font-family:var(--font-mono);font-size:20px;font-weight:700;letter-spacing:.1em;margin-bottom:16px">${tempPass}</div>
          <p style="font-size:12px;color:var(--gray-400);margin-bottom:20px">Please log in and change your password in Account Settings immediately.</p>
          <button class="btn btn-primary btn-full btn-lg" onclick="closeModal()">OK, I've noted it</button>
        </div>
      `;
    // Remove click-outside-to-close for this critical modal
    const overlay = document.getElementById("modal-overlay");
    overlay.classList.add("open");
    overlay.onclick = null; // prevent accidental close while temp password is shown
    // SS-006: Restore the standard close handler when user acknowledges the password.
    // Doing it here (on the OK button) means any subsequent normal modals
    // opened in the same session will still close on backdrop-click.
    const okBtn = overlay.querySelector(".btn-primary");
    if (okBtn) {
      okBtn.addEventListener(
        "click",
        () => {
          overlay.onclick = closeModal;
        },
        { once: true }
      );
    }
  }, 50);
}

function handleLogin() {
  const email = document.getElementById("login-email").value.trim();
  const pass = document.getElementById("login-password").value;

  const store = getStore();

  applyScheduledUpgrades();

  const user = store.users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === pass
  );
  if (!user) {
    toast("Invalid email or password", "error");
    return;
  }
  if (user.status === "suspended" || user.status === "inactive") {
    toast(
      "Your account has been suspended. Please contact support for assistance.",
      "error"
    );
    return;
  }

  if (user.businessId) {
    const biz = store.businesses.find((b) => b.id === user.businessId);
    if (biz && biz.status === "inactive") {
      // Check if it's inactive due to subscription expiry (not admin suspension)
      const subStatus = getSubStatus(user.businessId);
      if (subStatus !== null && !subStatus.active) {
        // Subscription expired - show plan selection modal (no trial)

        showLoginSubscriptionModal(user, biz);
        return;
      }
      toast("Your business account is inactive. Contact support.", "error");

      return;
    }
    // Check subscription expiry for active businesses
    const st = getSubStatus(user.businessId);
    if (st && !st.active) {
      showLoginSubscriptionModal(user, biz);
      return;
    }
  }

  const rememberMe =
    document.getElementById("login-remember-me")?.checked || false;
  const userWithPrefs = { ...user, _rememberMe: rememberMe };
  updateStore((d) => ({ ...d, currentUser: userWithPrefs }));
  currentUser = userWithPrefs;
  document.getElementById("login-email").value = "";
  document.getElementById("login-password").value = "";
  redirectToRolePage();
}

// Module-level state for plan selectors - declared early so all login/renewal
// functions below can reference them without any temporal-dead-zone risk.
let _renewSelectedPlan = "starter";
let _loginSubSelectedPlan = "starter";
let completeRenewOverride = null; // one-shot override for login-renewal flow

// One-shot callback executed when user confirms plan in the login-renewal modal
let _pendingLoginRenewal = null;

function _handleLoginSubContinue() {
  if (typeof _pendingLoginRenewal === "function") {
    _pendingLoginRenewal();
  }
}

function showLoginSubscriptionModal(user, biz) {
  // Show plan selection modal (paid plans only, no trial)
  const featureList = (plan) => {
    const limits = PLAN_LIMITS[plan];
    if (!limits) return "";
    return (limits.features || []).map((f) => `<li>${f}</li>`).join("");
  };

  const zarStarterPrice =
    "R" +
    Number(PLAN_LIMITS.starter.price).toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
    });
  const zarPremiumPrice =
    "R" +
    Number(PLAN_LIMITS.premium.price).toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
    });

  openModal(
    `Subscription Required`,
    `
      <div style="text-align:center;margin-bottom:20px">
        <div style="width:44px;height:44px;background:var(--red-bg);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
          <svg width="20" height="20" fill="none" stroke="var(--red)" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div style="font-size:15px;font-weight:700;font-family:var(--font-mono);margin-bottom:4px">Subscription Expired</div>
        <div style="font-size:13px;color:var(--gray-500)">Choose a plan to reactivate <strong>${sanitize(
          biz.name
        )}</strong> and continue.</div>
      </div>
      <div id="login-sub-starter" class="plan-card selected" onclick="selectLoginPlan('starter')" style="cursor:pointer">
        <div class="plan-card-header">
          <span class="plan-name">Starter</span>
          <span class="plan-price">${zarStarterPrice}<span>/mo</span></span>
        </div>
        <div style="font-size:10px;color:var(--gray-500);margin-bottom:8px;font-family:var(--font-mono)">Billed in ZAR</div>
        <ul class="plan-features">${featureList("starter")}</ul>
      </div>
      <div id="login-sub-premium" class="plan-card" onclick="selectLoginPlan('premium')" style="cursor:pointer">
        <div class="plan-card-header">
          <span class="plan-name">Premium <span class="plan-badge-tag popular-badge">Popular</span></span>
          <span class="plan-price">${zarPremiumPrice}<span>/mo</span></span>
        </div>
        <div style="font-size:10px;color:var(--blue);margin-bottom:8px;font-family:var(--font-mono)">Billed in ZAR • international customers charged in rands</div>
        <ul class="plan-features">${featureList("premium")}</ul>
      </div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn btn-outline btn-lg" style="flex:1" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary btn-lg" style="flex:2" onclick="_handleLoginSubContinue()">${
          Icon.paystack
        } Continue to Payment</button>
      </div>
      <p style="font-size:11px;color:var(--gray-400);text-align:center;margin-top:10px">Cancelling this dialog will return you to the login screen. Your account remains locked until a plan is active.</p>
    `
  );

  // Reset plan selection state
  _loginSubSelectedPlan = "starter";
  selectLoginPlan("starter");

  // Set the one-shot pending renewal handler
  _pendingLoginRenewal = function () {
    const plan = _loginSubSelectedPlan || "starter";
    _pendingLoginRenewal = null; // clear immediately
    closeModal();

    // For expired-subscription login renewals, start fresh from payment date -
    // never carry over any old (expired) remaining time.
    completeRenewOverride = function (renewedPlan) {
      completeRenewOverride = null; // one-shot - clear immediately

      const dur = PLAN_LIMITS[renewedPlan]?.durationDays || 30;
      const newExpiry = new Date(Date.now() + dur * 86400000).toISOString();

      updateStore((d) => ({
        ...d,
        businesses: d.businesses.map((b) =>
          b.id === biz.id ? { ...b, status: "active", plan: renewedPlan } : b
        ),
        subscriptions: d.subscriptions.map((s) =>
          s.businessId === biz.id
            ? {
                ...s,
                plan: renewedPlan,
                status: "active",
                expiresAt: newExpiry,
                nextPlan: null,
              }
            : s
        ),
      }));

      const freshUser = getStore().users.find((u) => u.id === user.id);
      currentUser = freshUser || user;
      updateStore((d) => ({ ...d, currentUser: currentUser }));
      document.getElementById("login-email").value = "";
      document.getElementById("login-password").value = "";
      toast("Subscription renewed! Welcome back.", "success");
      redirectToRolePage();
    };

    simulatePaystack(
      biz.name,
      user.name,
      biz.email || user.email,
      "",
      plan,
      false,
      null,
      true
    );
  };
}

function selectPlan(plan) {
  selectedPlan = plan;
  ["trial", "starter", "premium"].forEach((p) => {
    const el = document.getElementById(`plan-${p}`);
    if (el) el.classList.toggle("selected", p === plan);
  });
}

function handleRegister() {
  const bizName = document.getElementById("reg-biz").value.trim();
  const ownerName = document.getElementById("reg-owner").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;

  if (!bizName || !ownerName || !email || !password) {
    toast("Please go back and fill in all required fields", "error");
    showPage("register-page");
    return;
  }

  // Final email uniqueness check
  const store = getStore();
  if (store.users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
    toast("An account with this email already exists", "error");
    showPage("register-page");
    document.getElementById("reg-email").classList.add("invalid");
    return;
  }

  // All plans (including trial) go through Paystack simulation
  simulatePaystack(bizName, ownerName, email, password, selectedPlan, false);
}

// ============================================================
// PAYSTACK PUBLIC KEY - replace with your actual key
// ============================================================
const PAYSTACK_PUBLIC_KEY = "pk_test_328d06e1e7acac75cab1175db7c135a8f1697132";

// One-shot handler for the payment confirm button inside simulatePaystack modals
let _pendingPaystackConfirm = null;

function _handlePaystackConfirm() {
  if (typeof _pendingPaystackConfirm === "function") {
    _pendingPaystackConfirm();
  }
}

function simulatePaystack(
  bizName,
  ownerName,
  email,
  password,
  plan,
  isUpgrade,
  onSuccess,
  isRenew
) {
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
  const price = limits.price;

  // SS-017: Block trial renewals - trials can only be activated on first registration.
  // A paid user who finds this code path with plan='trial' & isRenew=true would get
  // a free 7-day extension; guard it explicitly here.
  if (isRenew && plan === "trial") {
    toast(
      "Trial plan cannot be renewed. Please choose a paid plan to continue.",
      "error"
    );
    return;
  }

  // Free trial - skip Paystack, go straight to completion
  if (price === 0) {
    openModal(
      `${Icon.paystack} Activate Trial`,
      `
        <div style="text-align:center;padding:16px 0">
          <div style="font-size:28px;font-weight:900;font-family:var(--font-mono);margin-bottom:8px">Free Trial</div>
          <div style="font-size:13px;color:var(--gray-500);margin-bottom:20px">Plan: <strong>${limits.label}</strong> - No payment required.</div>
          <div style="background:var(--gray-50);border:1px solid var(--gray-100);border-radius:var(--radius);padding:12px;margin-bottom:20px;text-align:left;font-size:12px">
    <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:var(--gray-500)">Amount</span><strong>R0.00 (Free)</strong></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:var(--gray-500)">Plan</span><strong>${limits.label}</strong></div>
    <div style="display:flex;justify-content:space-between"><span style="color:var(--gray-500)">Duration</span><strong>${limits.durationDays} days</strong></div>
          </div>
          <div style="display:flex;gap:10px;">
    <button class="btn btn-outline btn-lg" style="flex:1" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary btn-lg" style="flex:2" onclick="_handlePaystackConfirm()">
      ${Icon.checkCircle} Activate Trial
    </button>
          </div>
        </div>
      `
    );
    _pendingPaystackConfirm = () => {
      _pendingPaystackConfirm = null;
      closeModal();
      if (isRenew) {
        completeRenew(plan);
      } else if (isUpgrade) {
        completeUpgrade(plan);
      } else {
        completeRegistration(bizName, ownerName, email, password, plan);
      }
    };
    return;
  }

  // Paid plans - show summary modal with real Paystack button
  // Subscription prices are ALWAYS charged in ZAR (South African Rand)
  const zarPrice =
    "R" +
    Number(price).toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  // Check if user is non-ZAR (during registration via reg-currency, or via logged-in business)
  let isNonZAR = false;
  let localCurrencyNote = "";
  if (currentUser && currentUser.businessId) {
    const _biz = getStore().businesses.find(
      (b) => b.id === currentUser.businessId
    );
    if (_biz && _biz.currency && _biz.currency !== "ZAR") {
      isNonZAR = true;
      localCurrencyNote = `<div style="background:var(--blue-bg);border:1px solid #c0d1f5;border-radius:var(--radius);padding:10px 12px;margin-bottom:16px;font-size:12px;color:var(--blue);text-align:left">
                    <strong>International Payment Note:</strong> This subscription is billed in ZAR (South African Rand). Your bank will convert <strong>${zarPrice}</strong> to your local currency (${_biz.currency}) at the prevailing exchange rate at the time of payment.
                </div>`;
    }
  } else {
    // During registration - check the currency dropdown
    const regCurrEl = document.getElementById("reg-currency");
    if (regCurrEl) {
      const parts = regCurrEl.value.split("|");
      if (parts[0] && parts[0] !== "ZAR") {
        isNonZAR = true;
        localCurrencyNote = `<div style="background:var(--blue-bg);border:1px solid #c0d1f5;border-radius:var(--radius);padding:10px 12px;margin-bottom:16px;font-size:12px;color:var(--blue);text-align:left">
                        <strong>International Payment Note:</strong> All SaleStation subscriptions are billed in ZAR (South African Rand). Your bank will convert <strong>${zarPrice}</strong> to your local currency (${parts[0]}) at the prevailing exchange rate at the time of payment.
                    </div>`;
      }
    }
  }
  openModal(
    `${Icon.paystack} Confirm Subscription`,
    `
        <div style="text-align:center;padding:16px 0">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--gray-400);font-family:var(--font-mono);margin-bottom:8px">Payment (billed in ZAR)</div>
          <div style="font-size:28px;font-weight:900;font-family:var(--font-mono);margin-bottom:4px">${zarPrice}</div>
          <div style="font-size:13px;color:var(--gray-500);margin-bottom:4px">Plan: <strong>${limits.label}</strong></div>
          <div style="font-size:12px;color:var(--gray-400);margin-bottom:16px">Click "Pay Now" to securely complete payment.</div>
          ${localCurrencyNote}
          <div style="background:var(--gray-50);border:1px solid var(--gray-100);border-radius:var(--radius);padding:12px;margin-bottom:20px;text-align:left;font-size:12px">
    <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:var(--gray-500)">Amount (ZAR)</span><strong>${zarPrice}</strong></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:var(--gray-500)">Plan</span><strong>${limits.label}</strong></div>
    <div style="display:flex;justify-content:space-between"><span style="color:var(--gray-500)">Duration</span><strong>${limits.durationDays} days</strong></div>
          </div>
          <div style="display:flex;gap:10px;">
    <button class="btn btn-outline btn-lg" style="flex:1" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary btn-lg" style="flex:2" onclick="_handlePaystackConfirm()">
      ${Icon.paystack} Pay Now
    </button>
          </div>
        </div>
      `
  );

  _pendingPaystackConfirm = () => {
    _pendingPaystackConfirm = null;
    const handler = PaystackPop.setup({
      key: PAYSTACK_PUBLIC_KEY,
      email:
        email ||
        (currentUser &&
          (getStore().businesses.find((b) => b.id === currentUser.businessId)
            ?.email ||
            currentUser.email)) ||
        "",
      amount: price * 100, // Paystack uses kobo/cents - ZAR cents
      currency: "ZAR",
      ref: "SS-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      metadata: {
        custom_fields: [
          { display_name: "Plan", variable_name: "plan", value: limits.label },
          {
            display_name: "Business",
            variable_name: "business",
            value: bizName || "",
          },
        ],
      },
      onClose: function () {
        toast("Payment cancelled.", "error");
      },
      callback: function (response) {
        // Payment verified by Paystack - process on our side
        closeModal();
        toast("Payment successful! Setting up your account...", "success");
        if (isRenew) {
          completeRenew(plan);
        } else if (isUpgrade) {
          completeUpgrade(plan);
        } else {
          completeRegistration(bizName, ownerName, email, password, plan);
        }
      },
    });
    handler.openIframe();
  };
}

function completeRegistration(bizName, ownerName, email, password, plan) {
  const bizId = `biz-${uid()}`;
  const ownerId = `user-${uid()}`;
  const now = new Date().toISOString();
  const dur = PLAN_LIMITS[plan]?.durationDays || 30;
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0); // start of processing day
  const expiry = new Date(
    startDate.getTime() + dur * 24 * 60 * 60 * 1000
  ).toISOString();
  const normalizedEmail = email.toLowerCase();

  const currencyVal =
    document.getElementById("reg-currency")?.value || "ZAR|R|South Africa";
  const [currencyCode, currencySymbol, country] = currencyVal.split("|");
  const bizTypeEl = document.getElementById("reg-biz-type");
  const businessType = bizTypeEl ? bizTypeEl.value : "other";
  updateStore((d) => ({
    ...d,
    businesses: [
      ...d.businesses,
      {
        id: bizId,
        name: sanitize(bizName),
        email: normalizedEmail,
        plan,
        status: "active",
        ownerId,
        createdAt: now,
        currency: currencyCode,
        currencySymbol,
        country,
        businessType,
      },
    ],
    users: [
      ...d.users,
      {
        id: ownerId,
        name: sanitize(ownerName),
        email: normalizedEmail,
        password,
        role: "admin",
        businessId: bizId,
        status: "active",
      },
    ],
    subscriptions: [
      ...d.subscriptions,
      {
        businessId: bizId,
        plan,
        status: "active",
        startedAt: now,
        expiresAt: expiry,
      },
    ],
    currentUser: {
      id: ownerId,
      name: sanitize(ownerName),
      email: normalizedEmail,
      password,
      role: "admin",
      businessId: bizId,
      status: "active",
    },
  }));

  currentUser = getStore().currentUser;
  ["reg-biz", "reg-owner", "reg-email", "reg-password"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.value = "";
      el.classList.remove("invalid");
    }
  });

  toast(
    plan === "trial"
      ? "Trial activated! Welcome to SaleStation."
      : "Payment successful! Welcome to SaleStation.",
    "success"
  );
  redirectToRolePage();
}

// ============================================================
// SS-015: Warn user before navigating away from a partially-filled registration form.
(function attachFormAbandonWarning() {
  const regFields = ["reg-biz", "reg-owner", "reg-email", "reg-password"];
  function hasAnyInput() {
    return regFields.some((id) => {
      const el = document.getElementById(id);
      return el && el.value.trim().length > 0;
    });
  }
  // Intercept "Back to Home" anchor clicks on auth pages
  document.querySelectorAll("#auth-container a[href]").forEach((a) => {
    a.addEventListener("click", function (e) {
      if (hasAnyInput()) {
        if (
          !confirm("You have unsaved registration information. Leave anyway?")
        ) {
          e.preventDefault();
        }
      }
    });
  });
  // Intercept browser/tab close when form has data
  window.addEventListener("beforeunload", function (e) {
    // On auth.html, auth-container is always shown - just check for input
    if (hasAnyInput()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
})();

(function init() {
  // If arriving from landing page "Get Started" / "Register" links, jump straight
  // to the register page instead of showing login.
  const hash = window.location.hash;
  if (hash === "#register") {
    history.replaceState(null, "", window.location.pathname);
    showPage("register-page");
    return;
  }
  // Plan-specific register links from the pricing section (#register-trial, #register-starter, #register-premium)
  const planMatch = hash.match(/^#register-(trial|starter|premium)$/);
  if (planMatch) {
    const targetPlan = planMatch[1];
    history.replaceState(null, "", window.location.pathname);
    showPage("register-page");
    // Store the intended plan so Step 2 pre-selects it
    window._preselectedPlan = targetPlan;
    return;
  }
  const store = getStore();
  if (store.currentUser) {
    currentUser = store.currentUser;
    // Check if still valid
    const freshUser = store.users.find((u) => u.id === currentUser.id);
    if (
      !freshUser ||
      freshUser.status === "suspended" ||
      freshUser.status === "inactive"
    ) {
      updateStore((d) => ({ ...d, currentUser: null }));
      return;
    }
    if (currentUser.businessId) {
      const biz = store.businesses.find((b) => b.id === currentUser.businessId);
      if (biz && biz.status === "inactive") {
        updateStore((d) => ({ ...d, currentUser: null }));
        return;
      }
      // SS-001: Check subscription on every reload - a user whose sub
      // expired overnight must not bypass the renewal gate silently.
      if (currentUser.role !== "super-admin") {
        const st = getSubStatus(currentUser.businessId);
        if (st && !st.active) {
          // Business is no longer active - force it inactive and bail.
          updateStore((d) => ({
            ...d,
            businesses: d.businesses.map((b) =>
              b.id === currentUser.businessId ? { ...b, status: "inactive" } : b
            ),
            currentUser: null,
          }));
          currentUser = null;
          toast(
            "Your subscription has expired. Please log in to renew.",
            "error"
          );
          return;
        }
      }
    }
    redirectToRolePage();
  }
})();

// ============================================================
// POST-LOGIN REDIRECT - navigate to role-specific page
// ============================================================
function redirectToRolePage() {
  if (!currentUser) {
    window.location.href = "auth.html";
    return;
  }
  const role = currentUser.role;
  if (role === "super-admin") window.location.href = "super-admin.html";
  else if (role === "cashier") window.location.href = "cashier.html";
  else window.location.href = "admin.html";
}

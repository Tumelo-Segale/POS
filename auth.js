// ============================================================
// auth.js - SaleStation
// Authentication: login, register, forgot password.
// Loaded by: auth.html ONLY.
// simulatePaystack, completeRenew, completeUpgrade,
// showLoginSubscriptionModal, selectLoginPlan, selectRenewPlan,
// and all plan-change state now live in shared.js so they are
// available to admin.html and cashier.html too.
// ============================================================

// selectedPlan is auth.html-only: tracks the plan chosen on the
// registration step-2 card. (Not needed on app pages.)
let selectedPlan = "starter";

// showPage is only used on auth.html (single-page auth flow).
function showPage(id) {
  document
    .querySelectorAll("#auth-container > div")
    .forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

function updatePlanPriceDisplay() {
  const trialEl = document.getElementById("plan-price-trial");
  const starterEl = document.getElementById("plan-price-starter");
  const premiumEl = document.getElementById("plan-price-premium");
  if (trialEl) trialEl.innerHTML = `R0<span>/7 days</span>`;
  if (starterEl)
    starterEl.innerHTML = `R${PLAN_LIMITS.starter.price}<span>/mo</span>`;
  if (premiumEl)
    premiumEl.innerHTML = `R${PLAN_LIMITS.premium.price}<span>/mo</span>`;
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
  if (window._preselectedPlan) {
    selectPlan(window._preselectedPlan);
    window._preselectedPlan = null;
  }
}

function showForgotPassword() {
  openModal(
    "Reset Password",
    `
    <p style="font-size:13px;color:var(--gray-500);margin-bottom:16px">Enter the email address associated with your account. A new temporary password will be shown.</p>
    <div class="form-group"><label class="form-label">Email Address</label><input id="fp-email" class="form-input" type="email" placeholder="name@business.com"/></div>
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
  document.getElementById("modal-overlay").classList.remove("open");
  setTimeout(() => {
    document.getElementById("modal-title").innerHTML = "Password Reset";
    document.getElementById("modal-body").innerHTML = `
      <div style="text-align:center;padding:12px 0">
        <p style="font-size:13px;color:var(--gray-600);margin-bottom:16px">Your temporary password is:</p>
        <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius);padding:14px;font-family:var(--font-mono);font-size:20px;font-weight:700;letter-spacing:.1em;margin-bottom:16px">${tempPass}</div>
        <p style="font-size:12px;color:var(--gray-400);margin-bottom:20px">Please log in and change your password in Account Settings immediately.</p>
        <button class="btn btn-primary btn-full btn-lg" onclick="closeModal()">OK, I've noted it</button>
      </div>`;
    const overlay = document.getElementById("modal-overlay");
    overlay.classList.add("open");
    overlay.onclick = null;
    const okBtn = overlay.querySelector(".btn-primary");
    if (okBtn)
      okBtn.addEventListener(
        "click",
        () => {
          overlay.onclick = closeModal;
        },
        { once: true }
      );
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
      const subStatus = getSubStatus(user.businessId);
      if (subStatus !== null && !subStatus.active) {
        showLoginSubscriptionModal(user, biz);
        return;
      }
      toast("Your business account is inactive. Contact support.", "error");
      return;
    }
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
  const store = getStore();
  if (store.users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
    toast("An account with this email already exists", "error");
    showPage("register-page");
    document.getElementById("reg-email").classList.add("invalid");
    return;
  }
  simulatePaystack(bizName, ownerName, email, password, selectedPlan, false);
}

function completeRegistration(bizName, ownerName, email, password, plan) {
  const bizId = `biz-${uid()}`;
  const ownerId = `user-${uid()}`;
  const now = new Date().toISOString();
  const dur = PLAN_LIMITS[plan]?.durationDays || 30;
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
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

// completeRenew and completeUpgrade are defined in admin.js (they need
// currentUser.businessId). On auth.html they are only reached via
// showLoginSubscriptionModal which sets completeRenewOverride to handle
// the logic inline, so completeRenew is never directly called on auth.html.
// Provide safe stubs so shared.js simulatePaystack callback doesn't throw.
function completeRenew(plan) {
  if (completeRenewOverride) {
    const fn = completeRenewOverride;
    completeRenewOverride = null;
    fn(plan);
  }
}
function completeUpgrade(plan) {
  // Not used on auth.html - stub for safety.
}

(function attachFormAbandonWarning() {
  const regFields = ["reg-biz", "reg-owner", "reg-email", "reg-password"];
  function hasAnyInput() {
    return regFields.some((id) => {
      const el = document.getElementById(id);
      return el && el.value.trim().length > 0;
    });
  }
  document.querySelectorAll("#auth-container a[href]").forEach((a) => {
    a.addEventListener("click", function (e) {
      if (
        hasAnyInput() &&
        !confirm("You have unsaved registration information. Leave anyway?")
      )
        e.preventDefault();
    });
  });
  window.addEventListener("beforeunload", function (e) {
    if (hasAnyInput()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
})();

(function init() {
  const hash = window.location.hash;
  if (hash === "#register") {
    history.replaceState(null, "", window.location.pathname);
    showPage("register-page");
    return;
  }
  const planMatch = hash.match(/^#register-(trial|starter|premium)$/);
  if (planMatch) {
    history.replaceState(null, "", window.location.pathname);
    showPage("register-page");
    window._preselectedPlan = planMatch[1];
    return;
  }
  const store = getStore();
  if (store.currentUser) {
    currentUser = store.currentUser;
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
      if (currentUser.role !== "super-admin") {
        const st = getSubStatus(currentUser.businessId);
        if (st && !st.active) {
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

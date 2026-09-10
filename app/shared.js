// ============================================================
// shared.js - SaleStation
// Core utilities, storage, auth state, app shell, icons.
// Loaded by: index.html, super-admin.html, admin.html, cashier.html
// ============================================================

// ============================================================
// STORAGE
// ============================================================
// localStorage-backed multi-tenant POS. BroadcastChannel gives
// real-time cross-tab sync. RENEWAL_WINDOW_DAYS is the single
// source of truth for the renewal window (issue #1 fix).

(function injectCSP() {
  if (document.querySelector('meta[http-equiv="Content-Security-Policy"]'))
    return;
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://js.paystack.co https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://paystack.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://api.paystack.co https://checkout.paystack.com https://paystack.com",
    "img-src 'self' data: https:",
    "frame-src https://checkout.paystack.com https://paystack.com",
  ].join("; ");
  document.head.prepend(meta);
})();

// ============================================================
// CONSTANTS
// ============================================================
const ROLES = Object.freeze({
  SUPER_ADMIN: "super-admin",
  ADMIN: "admin",
  CASHIER: "cashier",
});
const STORAGE_KEY = "salestation_v6";
// Single source of truth for the renewal window. Used in renderSubscriptions
// and handleUpgrade/handleRenew to gate access consistently. (Fixes issue #1/#12)
const RENEWAL_WINDOW_DAYS = 2;
const PAYSTACK_PUBLIC_KEY = "pk_test_328d06e1e7acac75cab1175db7c135a8f1697132";

const PLAN_LIMITS = {
  trial: {
    cashiers: 1,
    items: 15,
    statements: [],
    price: 0,
    label: "Trial",
    graceDays: 0,
    durationDays: 7,
    features: [
      "Max 1 Cashier",
      "Max 15 Items",
      "Full POS Checkout",
      "Cash & Card Payments",
      "Transaction Receipts",
      "Basic Inventory Management",
      "Contact Support",
      "No statement exports",
      "No grace period",
    ],
  },
  starter: {
    cashiers: 2,
    items: 50,
    statements: ["weekly"],
    price: 200,
    label: "Starter",
    graceDays: 2,
    durationDays: 30,
    features: [
      "Max 2 Cashiers",
      "Max 50 Items",
      "Full POS Checkout",
      "Cash & Card Payments",
      "Transaction Receipts",
      "Inventory Management & Stock Tracking",
      "Weekly Statement Export (CSV/Excel)",
      "Discount & Promo Support",
      "2-day grace period",
      "Contact Support",
    ],
  },
  premium: {
    cashiers: Infinity,
    items: Infinity,
    statements: ["weekly", "monthly", "yearly"],
    price: 500,
    label: "Premium",
    graceDays: 2,
    durationDays: 30,
    features: [
      "Unlimited Cashiers",
      "Unlimited Items",
      "Full POS Checkout",
      "Cash & Card Payments",
      "Transaction Receipts",
      "Advanced Inventory & Stock Alerts",
      "Multi-Store Management (up to 3 locations)",
      "Audit Action Logs",
      "Weekly, Monthly & Yearly Exports",
      "Discount & Promo Support",
      "2-day grace period",
      "Priority Support",
    ],
  },
};

const initialData = {
  users: [
    {
      id: "super-admin-1",
      name: "Tumelo Segale",
      email: "admin@salestation.app",
      password: "password",
      role: "super-admin",
      status: "active",
    },
  ],
  businesses: [],
  items: [],
  transactions: [],
  messages: [],
  subscriptions: [],
  payments: [],
  locations: [],
  auditLogs: [],
  currentUser: null,
};

let _storeCache = null;

function getStore() {
  if (_storeCache !== null) return _storeCache;
  try {
    const d = localStorage.getItem(STORAGE_KEY);
    if (!d) {
      const init = JSON.parse(JSON.stringify(initialData));
      saveStore(init);
      _storeCache = init;
      return init;
    }
    const s = JSON.parse(d);
    if (!s.locations) s.locations = [];
    if (!s.auditLogs) s.auditLogs = [];
    if (!s.payments) s.payments = [];
    if (s.items) s.items = s.items.map((i) => ({ stock: null, ...i }));
    if (s.transactions)
      s.transactions = s.transactions.map((t) =>
        t.receiptId ? t : { ...t, receiptId: null }
      );
    if (s.businesses)
      s.businesses = s.businesses.map((b) =>
        b.businessType ? b : { ...b, businessType: "other" }
      );
    if (s.subscriptions)
      s.subscriptions = s.subscriptions.map((sub) =>
        sub.startedAt
          ? sub
          : {
              ...sub,
              startedAt: sub.expiresAt
                ? new Date(
                    new Date(sub.expiresAt).getTime() -
                      (PLAN_LIMITS[sub.plan]?.durationDays || 30) * 86400000
                  ).toISOString()
                : new Date().toISOString(),
            }
      );
    _storeCache = s;
    return s;
  } catch (e) {
    return JSON.parse(JSON.stringify(initialData));
  }
}

function saveStore(data) {
  _storeCache = data;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function updateStore(fn) {
  const current = getStore();
  const next = fn(current);
  _storeCache = null;
  saveStore(next);
  broadcastChange(next);
  return next;
}

// ============================================================
// AUDIT LOG
// ============================================================
function addAuditLog(action, target) {
  if (!currentUser) return;
  const bizId = currentUser.businessId || "super-admin";
  updateStore((d) => ({
    ...d,
    auditLogs: [
      ...d.auditLogs,
      {
        id: `al-${uid()}`,
        businessId: bizId,
        userId: currentUser.id,
        userName: currentUser.name,
        role: currentUser.role,
        action,
        target: sanitize(target || ""),
        ts: new Date().toISOString(),
      },
    ],
  }));
}

// ============================================================
// SUBSCRIPTION STATUS
// ============================================================
function getSubStatus(businessId) {
  const store = getStore();
  const sub = store.subscriptions.find((s) => s.businessId === businessId);
  const biz = store.businesses.find((b) => b.id === businessId);
  if (!sub || !biz) return null;
  const now = new Date();
  const expires = new Date(sub.expiresAt);
  const grace = PLAN_LIMITS[biz.plan]?.graceDays || 0;
  const graceEnd = new Date(expires.getTime() + grace * 24 * 60 * 60 * 1000);
  const daysLeft = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));
  const graceLeft = Math.ceil((graceEnd - now) / (1000 * 60 * 60 * 24));
  if (sub.status === "cancelled") {
    if (now <= expires)
      return {
        status: "cancelled",
        label: "Cancelled",
        badge: "badge-accent",
        active: true,
        inGrace: false,
        daysLeft,
        expiresAt: sub.expiresAt,
      };
    return {
      status: "cancelled-expired",
      label: "Expired",
      badge: "badge-red",
      active: false,
      inGrace: false,
    };
  }
  if (now <= expires)
    return {
      status: "active",
      label: "Active",
      badge: "badge-green",
      active: true,
      inGrace: false,
      daysLeft,
      expiresAt: sub.expiresAt,
    };
  if (grace > 0 && now <= graceEnd)
    return {
      status: "grace",
      label: "Grace Period",
      badge: "badge-orange",
      active: true,
      inGrace: true,
      graceLeft,
    };
  return {
    status: "expired",
    label: "Expired",
    badge: "badge-red",
    active: false,
    inGrace: false,
  };
}

function enforceSubscription(businessId) {
  const st = getSubStatus(businessId);
  const store = getStore();
  const sub = store.subscriptions.find((s) => s.businessId === businessId);
  const isCancelledPastExpiry =
    sub && sub.status === "cancelled" && new Date() > new Date(sub.expiresAt);
  if (!st || !st.active || isCancelledPastExpiry) {
    updateStore((d) => ({
      ...d,
      businesses: d.businesses.map((b) =>
        b.id === businessId ? { ...b, status: "inactive" } : b
      ),
    }));
    return false;
  }
  return true;
}

function applyScheduledUpgrades() {
  const now = new Date();
  let changed = false;
  const freshStore = getStore();
  const newSubscriptions = freshStore.subscriptions.map((sub) => {
    if (sub.nextPlan && new Date(sub.expiresAt) <= now) {
      changed = true;
      const plan = sub.nextPlan;
      const dur = PLAN_LIMITS[plan]?.durationDays || 30;
      return {
        ...sub,
        plan,
        nextPlan: null,
        status: "active",
        expiresAt: new Date(Date.now() + dur * 86400000).toISOString(),
      };
    }
    return sub;
  });
  // Use freshStore snapshot for nextPlan check so we read pre-mutation values
  const newBusinesses = freshStore.businesses.map((b) => {
    const sub = freshStore.subscriptions.find((s) => s.businessId === b.id);
    if (sub && sub.nextPlan && new Date(sub.expiresAt) <= now)
      return { ...b, plan: sub.nextPlan };
    return b;
  });
  if (changed)
    updateStore((d) => ({
      ...d,
      subscriptions: newSubscriptions,
      businesses: newBusinesses,
    }));
}

// ============================================================
// PAYMENT / SUBSCRIPTION COMPLETION
// All Paystack and plan-change functions live here so they are
// available to admin.html, cashier.html, and index.html alike.
// (Fixes issues #3-#7: ReferenceErrors from missing functions)
// ============================================================

// Module-level state for plan selectors
let _renewSelectedPlan = "starter";
let _loginSubSelectedPlan = "starter";
let completeRenewOverride = null;
let _pendingLoginRenewal = null;
let _pendingPaystackConfirm = null;
let _pendingRenew = null;

function _handlePaystackConfirm(btn) {
  if (btn && btn.disabled) return; // already acknowledged; ignore repeat clicks
  lockButton(btn, "Processing…");
  if (typeof _pendingPaystackConfirm === "function") _pendingPaystackConfirm();
}
function _handleLoginSubContinue() {
  if (typeof _pendingLoginRenewal === "function") _pendingLoginRenewal();
}
function _handleRenewContinue() {
  if (typeof _pendingRenew === "function") _pendingRenew();
}

function selectLoginPlan(plan) {
  _loginSubSelectedPlan = plan;
  ["starter", "premium"].forEach((p) => {
    const el = document.getElementById("login-sub-" + p);
    if (el) el.classList.toggle("selected", p === plan);
  });
}

function selectRenewPlan(plan) {
  _renewSelectedPlan = plan;
  ["starter", "premium"].forEach((p) => {
    const el = document.getElementById("renew-plan-" + p);
    if (el) el.classList.toggle("selected", p === plan);
  });
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

  if (isRenew && plan === "trial") {
    toast("Trial plan cannot be renewed. Please choose a paid plan.", "error");
    return;
  }

  if (price === 0) {
    openModal(
      `${Icon.paystack} Activate Trial`,
      `<div style="text-align:center;padding:16px 0">
        <div style="font-size:28px;font-weight:900;font-family:var(--font-mono);margin-bottom:8px">Free Trial</div>
        <div style="font-size:13px;color:var(--gray-500);margin-bottom:20px">Plan: <strong>${limits.label}</strong> — No payment required.</div>
        <div style="background:var(--gray-50);border:1px solid var(--gray-100);border-radius:var(--radius);padding:12px;margin-bottom:20px;text-align:left;font-size:12px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:var(--gray-500)">Amount</span><strong>R0.00 (Free)</strong></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:var(--gray-500)">Plan</span><strong>${limits.label}</strong></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--gray-500)">Duration</span><strong>${limits.durationDays} days</strong></div>
        </div>
        <div style="display:flex;gap:10px">
          <button class="btn btn-outline btn-lg" style="flex:1" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary btn-lg" style="flex:2" onclick="_handlePaystackConfirm(this)">${Icon.checkCircle} Activate Trial</button>
        </div>
      </div>`
    );
    _pendingPaystackConfirm = () => {
      _pendingPaystackConfirm = null;
      closeModal();
      if (isRenew) completeRenew(plan);
      else if (isUpgrade) completeUpgrade(plan);
      else completeRegistration(bizName, ownerName, email, password, plan);
    };
    return;
  }

  const zarPrice =
    "R" +
    Number(price).toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  let localCurrencyNote = "";
  if (currentUser && currentUser.businessId) {
    const _biz = getStore().businesses.find(
      (b) => b.id === currentUser.businessId
    );
    if (_biz && _biz.currency && _biz.currency !== "ZAR") {
      localCurrencyNote = `<div style="background:var(--blue-bg);border:1px solid #c0d1f5;border-radius:var(--radius);padding:10px 12px;margin-bottom:16px;font-size:12px;color:var(--blue);text-align:left"><strong>International Payment Note:</strong> This subscription is billed in ZAR. Your bank will convert <strong>${zarPrice}</strong> to ${_biz.currency} at the prevailing exchange rate.</div>`;
    }
  } else {
    const regCurrEl = document.getElementById("reg-currency");
    if (regCurrEl) {
      const parts = regCurrEl.value.split("|");
      if (parts[0] && parts[0] !== "ZAR") {
        localCurrencyNote = `<div style="background:var(--blue-bg);border:1px solid #c0d1f5;border-radius:var(--radius);padding:10px 12px;margin-bottom:16px;font-size:12px;color:var(--blue);text-align:left"><strong>International Payment Note:</strong> All SaleStation subscriptions are billed in ZAR. Your bank will convert <strong>${zarPrice}</strong> to ${parts[0]} at the prevailing exchange rate.</div>`;
      }
    }
  }

  openModal(
    `${Icon.paystack} Confirm Subscription`,
    `<div style="text-align:center;padding:16px 0">
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
      <div style="display:flex;gap:10px">
        <button class="btn btn-outline btn-lg" style="flex:1" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary btn-lg" style="flex:2" onclick="_handlePaystackConfirm(this)">${Icon.paystack} Pay Now</button>
      </div>
    </div>`
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
      amount: price * 100,
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
        unlockButton(_lastLockedTriggerBtn);
      },
      callback: function () {
        closeModal();
        toast("Payment successful! Setting up your account...", "success");
        if (isRenew) completeRenew(plan);
        else if (isUpgrade) completeUpgrade(plan);
        else completeRegistration(bizName, ownerName, email, password, plan);
      },
    });
    handler.openIframe();
  };
}

function showLoginSubscriptionModal(user, biz) {
  const featureList = (plan) =>
    (PLAN_LIMITS[plan]?.features || []).map((f) => `<li>${f}</li>`).join("");
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
    "Subscription Required",
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
      <div class="plan-card-header"><span class="plan-name">Starter</span><span class="plan-price">${zarStarterPrice}<span>/mo</span></span></div>
      <div style="font-size:10px;color:var(--gray-500);margin-bottom:8px;font-family:var(--font-mono)">Billed in ZAR</div>
      <ul class="plan-features">${featureList("starter")}</ul>
    </div>
    <div id="login-sub-premium" class="plan-card" onclick="selectLoginPlan('premium')" style="cursor:pointer">
      <div class="plan-card-header"><span class="plan-name">Premium <span class="plan-badge-tag popular-badge">Popular</span></span><span class="plan-price">${zarPremiumPrice}<span>/mo</span></span></div>
      <div style="font-size:10px;color:var(--blue);margin-bottom:8px;font-family:var(--font-mono)">Billed in ZAR</div>
      <ul class="plan-features">${featureList("premium")}</ul>
    </div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn btn-outline btn-lg" style="flex:1" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-lg" style="flex:2" onclick="_handleLoginSubContinue()">${
        Icon.paystack
      } Continue to Payment</button>
    </div>
    <p style="font-size:11px;color:var(--gray-400);text-align:center;margin-top:10px">Cancelling returns you to the login screen. Your account remains locked until a plan is active.</p>
  `
  );
  _loginSubSelectedPlan = "starter";
  selectLoginPlan("starter");
  _pendingLoginRenewal = function () {
    const plan = _loginSubSelectedPlan || "starter";
    _pendingLoginRenewal = null;
    closeModal();
    // For login renewals, always start fresh — never carry expired remaining time.
    completeRenewOverride = function (renewedPlan) {
      completeRenewOverride = null;
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
      updateStore((d) => ({ ...d, currentUser }));
      const emailEl = document.getElementById("login-email");
      const passEl = document.getElementById("login-password");
      if (emailEl) emailEl.value = "";
      if (passEl) passEl.value = "";
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

// completeRegistration is defined in auth.js (index.html only).
// completeRenew and completeUpgrade are defined in admin.js but shared.js
// provides the stubs so cashier.html can also call completeRenew if needed.

// ============================================================
// WEBSOCKET SIMULATION (BroadcastChannel)
// ============================================================
let channel = null;
let wsSimInterval = null;

function initWebSocketSimulation() {
  try {
    channel = new BroadcastChannel("salestation_realtime");
    channel.onmessage = (event) => handleRemoteUpdate(event.data);
  } catch (e) {
    startPolling();
  }
  wsSimInterval =
    wsSimInterval ||
    setInterval(() => {
      if (currentUser && currentUser.businessId) {
        checkCancelledSubscriptionExpiry(currentUser.businessId);
        if (currentUser.role !== "super-admin") {
          const st = getSubStatus(currentUser.businessId);
          if (st && !st.active) {
            updateSubStatusBadge();
            if (activeTab === "pos") {
              if (currentUser.role === "cashier") {
                toast(
                  "Subscription expired. Contact your administrator to renew.",
                  "error"
                );
                navigate("contact");
              } else {
                toast(
                  "Subscription expired. POS transactions suspended.",
                  "error"
                );
                navigate("subscriptions");
              }
            }
          }
        }
      }
    }, 10000);
}

function broadcastChange(newStore) {
  if (channel) {
    try {
      channel.postMessage({
        type: "STORE_UPDATE",
        store: newStore,
        from: currentUser?.id,
        ts: Date.now(),
      });
    } catch (e) {}
  }
}

function handleRemoteUpdate(data) {
  const freshCurrentUserId = currentUser?.id || getStore().currentUser?.id;
  if (
    data.type === "SIDEBAR_COLLAPSE" &&
    data.from === currentUser?.id &&
    window.innerWidth > 768
  ) {
    const sb = document.getElementById("sidebar");
    if (sb) sb.classList.toggle("collapsed", !!data.collapsed);
    return;
  }
  if (data.type === "STORE_UPDATE" && data.from !== freshCurrentUserId) {
    const elapsed = Date.now() - data.ts;
    if (elapsed < 1800) {
      _storeCache = null;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data.store));
      if (activeTab && currentUser) {
        if (activeTab === "dashboard") {
          if (typeof updateDashboardChart === "function")
            updateDashboardChart();
        } else if (activeTab !== "pos") renderContent(activeTab);
        else {
          if (typeof refreshPOSItemsOnly === "function") refreshPOSItemsOnly();
        }
        const store = getStore();
        const freshUser = store.users.find((u) => u.id === currentUser.id);
        if (
          freshUser &&
          (freshUser.status === "suspended" || freshUser.status === "inactive")
        ) {
          forceLogout(
            "Your account has been suspended. You will be logged out."
          );
          return;
        }
        if (currentUser.businessId) {
          const biz = store.businesses.find(
            (b) => b.id === currentUser.businessId
          );
          if (
            biz &&
            biz.status === "inactive" &&
            currentUser.role !== "super-admin"
          ) {
            forceLogout("Your business has been deactivated.");
            return;
          }
          checkCancelledSubscriptionExpiry(currentUser.businessId);
        }
      }
    }
  }
}

function checkCancelledSubscriptionExpiry(businessId) {
  if (!currentUser || currentUser.role === "super-admin") return;
  const store = getStore();
  const sub = store.subscriptions.find((s) => s.businessId === businessId);
  if (!sub || sub.status !== "cancelled") return;
  if (new Date() > new Date(sub.expiresAt)) {
    updateStore((d) => ({
      ...d,
      businesses: d.businesses.map((b) =>
        b.id === businessId ? { ...b, status: "inactive" } : b
      ),
    }));
    forceLogout("Your subscription has ended. You have been logged out.");
  }
}

function startPolling() {
  let lastSeen = localStorage.getItem(STORAGE_KEY);
  let _pollInterval = null;
  function runPoll() {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current !== lastSeen) {
      lastSeen = current;
      _storeCache = null;
      if (activeTab && currentUser) {
        if (activeTab === "dashboard") {
          if (typeof updateDashboardChart === "function")
            updateDashboardChart();
        } else if (activeTab !== "pos") renderContent(activeTab);
        else {
          if (typeof refreshPOSItemsOnly === "function") refreshPOSItemsOnly();
        }
      }
    }
    if (currentUser && currentUser.businessId)
      checkCancelledSubscriptionExpiry(currentUser.businessId);
  }
  function startInterval() {
    if (_pollInterval) return;
    lastSeen = localStorage.getItem(STORAGE_KEY);
    _pollInterval = setInterval(runPoll, 1500);
  }
  function stopInterval() {
    if (_pollInterval) {
      clearInterval(_pollInterval);
      _pollInterval = null;
    }
  }
  if (!document.hidden) startInterval();
  document.addEventListener("visibilitychange", () =>
    document.hidden ? stopInterval() : startInterval()
  );
  wsSimInterval = { clear: stopInterval };
}

// ============================================================
// SESSION TIMEOUT (30 min)
// ============================================================
let sessionTimer = null;
let sessionWarnTimer = null;
let sessionCountdownInterval = null;

function resetSessionTimer() {
  clearTimeout(sessionTimer);
  clearTimeout(sessionWarnTimer);
  clearInterval(sessionCountdownInterval);
  const sw = document.getElementById("session-warning");
  if (sw) sw.classList.remove("show");
  if (!currentUser) return;
  if (currentUser._rememberMe) return;
  sessionWarnTimer = setTimeout(() => {
    const swEl = document.getElementById("session-warning");
    if (swEl) swEl.classList.add("show");
    let secsLeft = 120;
    function updateCountdown() {
      const m = Math.floor(secsLeft / 60),
        s = secsLeft % 60;
      const el = document.getElementById("session-countdown");
      if (el) el.textContent = `${m}:${String(s).padStart(2, "0")}`;
      secsLeft--;
    }
    updateCountdown();
    sessionCountdownInterval = setInterval(() => {
      if (secsLeft < 0) {
        clearInterval(sessionCountdownInterval);
        return;
      }
      updateCountdown();
    }, 1000);
  }, 28 * 60 * 1000);
  sessionTimer = setTimeout(() => {
    clearInterval(sessionCountdownInterval);
    forceLogout("Session expired. Logging out.");
  }, 30 * 60 * 1000);
}

let _lastSessionReset = 0;
function debouncedResetSession() {
  if (!currentUser) return;
  const now = Date.now();
  if (now - _lastSessionReset > 10000) {
    _lastSessionReset = now;
    resetSessionTimer();
  }
}
["mousemove", "keydown", "click", "touchstart"].forEach((e) =>
  document.addEventListener(e, debouncedResetSession, { passive: true })
);

// ============================================================
// UTILITIES
// ============================================================
function sanitize(str) {
  return String(str).replace(
    /[<>"'&]/g,
    (c) =>
      ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "&": "&amp;" }[
        c
      ])
  );
}
function safeAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function getCurrencySymbol() {
  if (!currentUser || !currentUser.businessId) return "R";
  try {
    const biz = getStore().businesses.find(
      (b) => b.id === currentUser.businessId
    );
    return biz?.currencySymbol || "R";
  } catch (e) {
    return "R";
  }
}
function formatCurrency(n) {
  const sym = getCurrencySymbol();
  return (
    sym +
    Number(n).toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
function formatDate(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function formatDateShort(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function uid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 9)}-${Math.random().toString(36).slice(2, 9)}`;
}
function toast(msg, type = "default") {
  const c = document.getElementById("toast-container");
  if (!c) return;
  const t = document.createElement("div");
  t.className = `toast ${
    type === "error"
      ? "toast-error"
      : type === "success"
      ? "toast-success"
      : type === "warning"
      ? "toast-warning"
      : ""
  }`;
  t.textContent = msg;
  if (type === "error") {
    const assertive = document.getElementById("toast-container-assertive");
    if (assertive) {
      assertive.textContent = "";
      setTimeout(() => {
        assertive.textContent = msg;
      }, 10);
    }
  }
  c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
function confirm2(title, msg, options) {
  return new Promise((resolve) => {
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-message").textContent = msg;
    const overlay = document.getElementById("confirm-overlay");
    overlay.classList.add("open");
    const okBtn = document.getElementById("confirm-ok-btn");
    const cancelBtn = document.getElementById("confirm-cancel-btn");
    okBtn.textContent = options?.okLabel || "Confirm";
    okBtn.className = "btn " + (options?.okClass || "btn-danger");
    okBtn.style.flex = "1";
    const cleanup = () => {
      overlay.classList.remove("open");
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      document.removeEventListener("keydown", escHandler);
      okBtn.textContent = "Confirm";
      okBtn.className = "btn btn-danger";
    };
    function escHandler(e) {
      if (e.key === "Escape") {
        cleanup();
        resolve(false);
      }
    }
    document.addEventListener("keydown", escHandler);
    okBtn.onclick = () => {
      cleanup();
      resolve(true);
    };
    cancelBtn.onclick = () => {
      cleanup();
      resolve(false);
    };
  });
}
function togglePw(inputId) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.type = inp.type === "password" ? "text" : "password";
}

// ============================================================
// ICONS
// ============================================================
const Icon = {
  dashboard: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  store: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  users: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  package: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
  cart: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`,
  close: `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  history: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 0 .5-4.5"/><polyline points="3 3 3 11 11 11"/></svg>`,
  credit: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
  settings: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l-.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  mail: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
  message: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  plus: `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  edit: `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash: `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  search: `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  download: `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  alert: `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  checkCircle: `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  location: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  log: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
  paystack: `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
  receipt: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16l3-2 3 2 3-2 3 2V4a2 2 0 0 0-2-2z"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="12" y2="15"/></svg>`,
};

// ============================================================
// AUTH STATE
// ============================================================
let currentUser = null;
let activeTab = "";

// ============================================================
// APP LAUNCH
// ============================================================
function launchApp() {
  applyScheduledUpgrades();
  document.body.style.visibility = "visible";
  const authEl = document.getElementById("auth-container");
  if (authEl) authEl.classList.add("hidden");
  const appEl = document.getElementById("app-container");
  if (appEl) appEl.classList.remove("hidden");
  document.getElementById("topbar-user-name").textContent = currentUser.name;
  document.getElementById("topbar-user-role").textContent =
    currentUser.role.replaceAll("-", " ");
  buildSidebar();
  updateSubStatusBadge();
  resetSessionTimer();
  const defaultTab = currentUser.role === "cashier" ? "pos" : "dashboard";
  navigate(defaultTab);
  initWebSocketSimulation();
  if (window.innerWidth > 768) {
    const collapsed =
      localStorage.getItem(`sidebar_collapsed_${currentUser.id}`) === "true";
    if (collapsed)
      document.getElementById("sidebar").classList.add("collapsed");
  } else {
    const mobileOpen =
      localStorage.getItem(`sidebar_mobile_open_${currentUser.id}`) === "true";
    if (mobileOpen) openMobileSidebar();
  }
}

function updateSubStatusBadge() {
  const el = document.getElementById("sub-status-badge");
  if (!el || !currentUser || !currentUser.businessId) {
    if (el) el.innerHTML = "";
    return;
  }
  const st = getSubStatus(currentUser.businessId);
  if (!st) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `<span class="badge ${st.badge}" style="font-size:10px;padding:3px 8px">${st.label}</span>`;
}

// ============================================================
// SIDEBAR & NAVIGATION
// ============================================================
const NAV_ITEMS = {
  "super-admin": [
    { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    { id: "businesses", label: "Businesses", icon: "store" },
    { id: "payments", label: "Payments", icon: "credit" },
    { id: "messages", label: "Messages", icon: "message" },
    { id: "settings", label: "Settings", icon: "settings" },
  ],
  admin: [
    { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    { id: "items", label: "Inventory", icon: "package" },
    { id: "cashiers", label: "Cashiers", icon: "users" },
    { id: "pos", label: "POS Mode", icon: "cart" },
    { id: "transactions", label: "Transactions", icon: "history" },
    { id: "receipts", label: "Receipts", icon: "receipt" },
    { id: "subscriptions", label: "Subscription", icon: "credit" },
    { id: "contact", label: "Contact Support", icon: "mail" },
    { id: "settings", label: "Settings", icon: "settings" },
  ],
  cashier: [
    { id: "pos", label: "POS", icon: "cart" },
    { id: "items", label: "Items", icon: "package" },
    { id: "orders", label: "My Orders", icon: "history" },
    { id: "contact", label: "Contact Support", icon: "mail" },
    { id: "settings", label: "Settings", icon: "settings" },
  ],
};

function buildSidebar() {
  const nav = document.getElementById("sidebar-nav");
  let items = (NAV_ITEMS[currentUser.role] || []).slice();
  const unreadMsgCount =
    currentUser.role === "super-admin"
      ? getStore().messages.filter((m) => !m.read).length
      : 0;
  if (currentUser.role === "admin") {
    const biz = getStore().businesses.find(
      (b) => b.id === currentUser.businessId
    );
    if (biz?.plan === "premium") {
      const subIdx = items.findIndex((i) => i.id === "subscriptions");
      items.splice(
        subIdx + 1,
        0,
        { id: "locations", label: "Multi-Store", icon: "location" },
        { id: "audit", label: "Audit Logs", icon: "log" }
      );
    }
  }
  let subBadgeHTML = "";
  if (currentUser.businessId) {
    const st = getSubStatus(currentUser.businessId);
    if (
      st &&
      st.active &&
      (st.inGrace || (typeof st.daysLeft === "number" && st.daysLeft <= 7))
    ) {
      const badgeColor = st.inGrace
        ? "var(--orange)"
        : st.daysLeft <= 3
        ? "var(--red)"
        : "var(--accent)";
      subBadgeHTML = `<span style="margin-left:auto;background:${badgeColor};color:white;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;font-family:var(--font-mono)">${
        st.inGrace ? "Grace" : `${st.daysLeft}d`
      }</span>`;
    } else if (st && !st.active) {
      subBadgeHTML = `<span style="margin-left:auto;background:var(--red);color:white;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;font-family:var(--font-mono)">!</span>`;
    }
  }
  const mainItems = items.filter(
    (i) => !["contact", "settings", "subscriptions"].includes(i.id)
  );
  const bottomItems = items.filter((i) =>
    ["contact", "settings", "subscriptions"].includes(i.id)
  );
  nav.innerHTML = `
    <div class="nav-section-label">Main</div>
    ${mainItems
      .map(
        (item) => `
      <div class="nav-item" data-tab="${safeAttr(
        item.id
      )}" onclick="navigate('${safeAttr(item.id)}')">
        ${Icon[item.icon] || Icon.dashboard}
        <span class="nav-item-label">${item.label}</span>
        ${
          item.id === "messages" && unreadMsgCount > 0
            ? `<span style="margin-left:auto;background:var(--red);color:white;font-size:9px;font-weight:700;padding:1px 6px;border-radius:10px;font-family:var(--font-mono);min-width:18px;text-align:center">${
                unreadMsgCount > 99 ? "99+" : unreadMsgCount
              }</span>`
            : ""
        }
      </div>`
      )
      .join("")}
    ${
      bottomItems.length > 0
        ? `<div class="nav-section-label" style="margin-top:8px">Account</div>`
        : ""
    }
    ${bottomItems
      .map(
        (item) => `
      <div class="nav-item" data-tab="${safeAttr(
        item.id
      )}" onclick="navigate('${safeAttr(item.id)}')">
        ${Icon[item.icon] || Icon.settings}
        <span class="nav-item-label">${item.label}</span>
        ${item.id === "subscriptions" ? subBadgeHTML : ""}
      </div>`
      )
      .join("")}
  `;
}

function handleHamburger() {
  if (window.innerWidth <= 768) {
    openMobileSidebar();
    try {
      localStorage.setItem(`sidebar_mobile_open_${currentUser.id}`, "true");
    } catch (e) {}
  } else {
    const sb = document.getElementById("sidebar");
    sb.classList.toggle("collapsed");
    const isCollapsed = sb.classList.contains("collapsed");
    try {
      localStorage.setItem(`sidebar_collapsed_${currentUser.id}`, isCollapsed);
    } catch (e) {}
    if (channel) {
      try {
        channel.postMessage({
          type: "SIDEBAR_COLLAPSE",
          collapsed: isCollapsed,
          from: currentUser?.id,
        });
      } catch (e) {}
    }
  }
}
function openMobileSidebar() {
  document.getElementById("sidebar").classList.add("mobile-open");
  document.getElementById("sidebar-overlay").classList.add("open");
}
function closeMobileSidebar() {
  document.getElementById("sidebar").classList.remove("mobile-open");
  document.getElementById("sidebar-overlay").classList.remove("open");
  try {
    localStorage.removeItem(`sidebar_mobile_open_${currentUser?.id}`);
  } catch (e) {}
}

// ============================================================
// SKELETON LOADERS
// Shown for one paint cycle while a (potentially heavy) tab
// render runs, so the UI never freezes on a blank screen —
// used instead of spinners for all tab/content loading.
// ============================================================
function skeletonToolbarRow() {
  return `<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
    <div class="skel skel-toolbar"></div>
  </div>`;
}
function skeletonTableHTML(rows = 6, cols = 4) {
  const row = () =>
    `<div class="skel-row">${Array.from(
      { length: cols },
      (_, i) =>
        `<div class="skel skel-cell${i === 0 ? " skel-cell-sm" : ""}"></div>`
    ).join("")}</div>`;
  return `
    <div class="skel skel-page-header"></div>
    ${skeletonToolbarRow()}
    <div class="card"><div>${Array.from({ length: rows }, row).join(
      ""
    )}</div></div>
  `;
}
function skeletonCardsHTML(n = 3) {
  return `
    <div class="skel skel-page-header"></div>
    <div style="display:flex;gap:16px;flex-wrap:wrap">
      ${Array.from(
        { length: n },
        () => `<div class="skel skel-card" style="min-width:220px"></div>`
      ).join("")}
    </div>
  `;
}
// Tabs whose content is a searchable/sortable table — these get the
// table skeleton. Everything else (POS, settings, contact) renders
// fast enough, and isn't list-shaped, so it skips the skeleton.
const SKELETON_TABLE_TABS = new Set([
  "dashboard",
  "cashiers",
  "locations",
  "audit-logs",
  "transactions",
  "receipts",
  "items",
  "subscriptions",
  "businesses",
  "payments",
  "messages",
]);
function renderContentWithSkeleton(tab) {
  const area = document.getElementById("content-area");
  if (!area || !SKELETON_TABLE_TABS.has(tab)) {
    renderContent(tab);
    return;
  }
  area.innerHTML =
    tab === "dashboard" ? skeletonCardsHTML(4) : skeletonTableHTML();
  // Two rAFs guarantee the skeleton actually paints to the screen
  // before the (synchronous, possibly heavy) real render runs.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => renderContent(tab));
  });
}

function navigate(tab) {
  if (
    activeTab === "pos" &&
    tab !== "pos" &&
    typeof posCart !== "undefined" &&
    posCart.length > 0
  ) {
    confirm2(
      "Leave POS?",
      "You have items in the cart. Navigating away will clear the cart.",
      { okLabel: "Leave & Clear", okClass: "btn-danger" }
    ).then((ok) => {
      if (!ok) return;
      posCart = [];
      _doNavigate(tab);
    });
    return;
  }
  _doNavigate(tab);
}

function _doNavigate(tab) {
  const _area = document.getElementById("content-area");
  if (_area) {
    _area.style.overflow = "";
    _area.style.padding = "";
  }
  if (
    currentUser.role !== "super-admin" &&
    currentUser.businessId &&
    !["subscriptions", "settings", "contact"].includes(tab)
  ) {
    const active = enforceSubscription(currentUser.businessId);
    if (!active) {
      toast("Subscription expired. Functionality suspended.", "error");
      tab = currentUser.role === "cashier" ? "contact" : "subscriptions";
    }
  }
  activeTab = tab;
  document
    .querySelectorAll(".nav-item[data-tab]")
    .forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
  const allItems = Object.values(NAV_ITEMS).flat();
  const label = allItems.find((i) => i.id === tab)?.label || tab;
  document.getElementById("topbar-title").textContent = label;
  const announcer = document.getElementById("page-title-announce");
  if (announcer) {
    announcer.textContent = "";
    setTimeout(() => {
      announcer.textContent = label;
    }, 50);
  }
  if (window.innerWidth <= 768) closeMobileSidebar();
  renderContentWithSkeleton(tab);
  updateSubStatusBadge();
}

// ============================================================
// CONTENT ROUTER
// ============================================================
function renderContent(tab) {
  const area = document.getElementById("content-area");
  if (currentUser.role === "super-admin") {
    if (tab === "dashboard") return renderSuperDashboard(area);
    if (tab === "businesses") return renderBusinesses(area);
    if (tab === "payments") return renderPayments(area);
    if (tab === "messages") return renderMessages(area);
    if (tab === "settings") return renderSettings(area);
  }
  if (currentUser.role === "admin") {
    if (tab === "dashboard") return renderAdminDashboard(area);
    if (tab === "items") return renderItems(area);
    if (tab === "cashiers") return renderCashiers(area);
    if (tab === "pos") return renderPOS(area);
    if (tab === "transactions") return renderTransactions(area);
    if (tab === "receipts") return renderReceipts(area);
    if (tab === "subscriptions") return renderSubscriptions(area);
    if (tab === "contact") return renderContact(area);
    if (tab === "settings") return renderSettings(area);
    if (tab === "locations") return renderLocations(area);
    if (tab === "audit") return renderAuditLogs(area);
  }
  if (currentUser.role === "cashier") {
    if (tab === "pos") return renderPOS(area);
    if (tab === "items") return renderItems(area);
    if (tab === "orders") return renderOrders(area);
    if (tab === "contact") return renderContact(area);
    if (tab === "settings") return renderSettings(area);
  }
}

// ============================================================
// MODAL HELPERS
// ============================================================
function openModal(title, bodyHTML) {
  document.getElementById("modal-title").innerHTML = title;
  document.getElementById("modal-body").innerHTML = bodyHTML;
  document.getElementById("modal-overlay").classList.add("open");
}
function closeModal(e) {
  if (!e || e.target === document.getElementById("modal-overlay")) {
    document.getElementById("modal-overlay").classList.remove("open");
    document.getElementById("modal-overlay").onclick = closeModal;
    unlockButton(_lastLockedTriggerBtn);
    _lastLockedTriggerBtn = null;
  }
}

// ============================================================
// BUTTON ACKNOWLEDGEMENT / LOCKING
// Disables & relabels a button the instant it's clicked so a
// second click (double-tap, slow network, impatience) can't
// double-submit — used for payments and other one-shot actions.
// ============================================================
// ============================================================
// SEARCH DEBOUNCE
// Delays a full tab re-render until typing pauses, so large
// tables (payments, businesses, etc.) don't re-render on every
// keystroke — matters once real data volume grows.
// ============================================================
let _searchDebounceTimer = null;
function debounceRender(fn, delay = 200) {
  clearTimeout(_searchDebounceTimer);
  _searchDebounceTimer = setTimeout(fn, delay);
}

let _lastLockedTriggerBtn = null;
function lockButton(btn, label) {
  if (!btn || btn.disabled) return false;
  if (!btn.dataset.origHtml) btn.dataset.origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add("btn-locked");
  btn.innerHTML = label || "Please wait…";
  _lastLockedTriggerBtn = btn;
  return true;
}
function unlockButton(btn) {
  if (!btn) return;
  btn.disabled = false;
  btn.classList.remove("btn-locked");
  if (btn.dataset.origHtml) {
    btn.innerHTML = btn.dataset.origHtml;
    delete btn.dataset.origHtml;
  }
}

// ============================================================
// PRIVACY POLICY MODAL
// Shared between the registration flow and any other app page
// that links to the Privacy Policy. Uses the generic openModal()
// popup (with its built-in close button) declared above.
// ============================================================
const PRIVACY_POLICY_HTML = `
  <div style="font-size:13px;color:var(--gray-600);line-height:1.7">
    <h4 style="font-family:var(--font-mono);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--black);margin-bottom:8px">1. Introduction</h4>
    <p style="margin-bottom:12px">This Privacy Policy explains how SaleStation ("we", "us", "the Platform") collects, uses, stores, and protects the information of businesses, cashiers, and visitors who use our Point of Sale system. By using SaleStation, you consent to the practices described in this Policy.</p>

    <h4 style="font-family:var(--font-mono);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--black);margin-bottom:8px">2. Information We Collect</h4>
    <p style="margin-bottom:12px">We collect information you provide directly, such as business name, owner name, email address, password (stored securely), business type, country and currency, and inventory, sales, and cashier data you enter into the Platform. We also process billing information via our payment processor for subscription payments.</p>

    <h4 style="font-family:var(--font-mono);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--black);margin-bottom:8px">3. How We Use Your Information</h4>
    <ul style="margin:0 0 12px 16px">
      <li>To create and manage your business account and user roles</li>
      <li>To operate core POS functionality - sales, inventory, receipts, and reporting</li>
      <li>To process subscription payments and manage billing cycles</li>
      <li>To communicate important account, billing, or security notices</li>
      <li>To improve the reliability, security, and performance of the Platform</li>
    </ul>

    <h4 style="font-family:var(--font-mono);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--black);margin-bottom:8px">4. Data Storage & Security</h4>
    <p style="margin-bottom:12px">Your data is stored securely and protected using industry-standard safeguards. Access to business data is restricted to authorized users within your business account based on role (super-admin, admin, cashier).</p>

    <h4 style="font-family:var(--font-mono);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--black);margin-bottom:8px">5. Data Sharing</h4>
    <p style="margin-bottom:12px">We do not sell your personal or business data to third parties. Data may be shared only with service providers strictly necessary to operate the Platform (such as our payment processor, Paystack, for subscription billing), or where required by law.</p>

    <h4 style="font-family:var(--font-mono);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--black);margin-bottom:8px">6. Your Rights (POPIA)</h4>
    <p style="margin-bottom:12px">In accordance with the Protection of Personal Information Act (POPIA) of South Africa and similar regional data protection laws, you have the right to access, correct, or request deletion of your personal information, and to withdraw consent for its processing at any time, subject to our legal and operational requirements.</p>

    <h4 style="font-family:var(--font-mono);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--black);margin-bottom:8px">7. Data Retention</h4>
    <p style="margin-bottom:12px">We retain your business data for as long as your account remains active, or as needed to comply with legal obligations. If you delete your business account, associated cashier accounts, inventory, transactions, and subscription data are permanently removed.</p>

    <h4 style="font-family:var(--font-mono);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--black);margin-bottom:8px">8. Cookies & Local Storage</h4>
    <p style="margin-bottom:12px">SaleStation uses local browser storage to keep you logged in and to maintain application state. We do not use third-party advertising cookies or trackers.</p>

    <h4 style="font-family:var(--font-mono);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--black);margin-bottom:8px">9. Changes to This Policy</h4>
    <p style="margin-bottom:12px">We may update this Privacy Policy from time to time. Material changes will be communicated to registered users via email or in-app notification. Continued use of the Platform after changes constitutes acceptance of the updated Policy.</p>

    <p style="margin-top:16px;font-size:12px;color:var(--gray-400)">Last updated: September 2026</p>
  </div>
`;

function openPrivacyPolicyModal() {
  openModal("Privacy Policy", PRIVACY_POLICY_HTML);
}

// ============================================================
// PAYMENT HISTORY (Subscription Payments)
// Logs every subscription payment event (new registration,
// renewal, upgrade) so Super Admin can see a full history of
// payments made by each business, independent of the single
// mutable `subscriptions` record used for the active plan.
// ============================================================
function addPaymentRecord(businessId, businessName, email, plan, amount, type) {
  const record = {
    id: `pay-${uid()}`,
    businessId,
    businessName,
    email,
    plan,
    amount,
    type: type || "payment", // "registration" | "renewal" | "upgrade"
    date: new Date().toISOString(),
  };
  updateStore((d) => ({
    ...d,
    payments: [...(d.payments || []), record],
  }));
  return record;
}

// ============================================================
// LOGOUT
// ============================================================
function performLogout() {
  if (wsSimInterval) {
    if (typeof wsSimInterval === "object" && wsSimInterval.clear)
      wsSimInterval.clear();
    else clearInterval(wsSimInterval);
  }
  clearTimeout(sessionTimer);
  clearTimeout(sessionWarnTimer);
  clearInterval(sessionCountdownInterval);
  const sw = document.getElementById("session-warning");
  if (sw) sw.classList.remove("show");
  try {
    if (currentUser)
      localStorage.removeItem(`sidebar_mobile_open_${currentUser.id}`);
  } catch (e) {}
  updateStore((d) => ({ ...d, currentUser: null }));
  currentUser = null;
  activeTab = "";
  window.location.replace("index.html");
}
function handleLogout() {
  confirm2("Log Out", "Are you sure you want to log out?", {
    okLabel: "Log Out",
    okClass: "btn-outline",
  }).then((ok) => {
    if (!ok) return;
    performLogout();
  });
}
function forceLogout(message) {
  if (message) toast(message, "error");
  setTimeout(performLogout, message ? 2000 : 0);
}

// ============================================================
// SHARED UTILITY: localDateStr
// Used by POS, dashboard, transactions, orders. Defined once here.
// ============================================================
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ============================================================
// SHARED: INVENTORY (read/write for admin, read-only for cashier)
// ============================================================
let _invFilterTimer = null;
// ============================================================
// SHARED: POS
// ============================================================
let posCart = [];
let posPayMethod = (() => {
  try {
    return localStorage.getItem("ss_pos_pay_method") || "cash";
  } catch (e) {
    return "cash";
  }
})();
let _posItems = [];
let _posActiveCat = "all";

// Show/hide the cart as a full-screen overlay on mobile. If `show` is
// omitted, the current state is toggled.
let _posFilterTimer = null;
// POS cart unload warning (all app pages)
window.addEventListener("beforeunload", function (e) {
  if (typeof posCart !== "undefined" && posCart && posCart.length > 0) {
    e.preventDefault();
    e.returnValue =
      "You have items in the POS cart. Closing this tab will lose the cart.";
  }
});

// ============================================================
// SHARED: CONTACT SUPPORT & SEND MESSAGE
// ============================================================
// ============================================================
// SHARED: SETTINGS (admin + cashier)
// super-admin has its own renderSettings in super-admin.js
// ============================================================

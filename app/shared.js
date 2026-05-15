// ============================================================
// shared.js - SaleStation
// Core utilities, storage, auth state, app shell, icons.
// Loaded by: auth.html, super-admin.html, admin.html, cashier.html
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
      "Transaction Receipts",
      "Contact Support",
      "No statement downloads",
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
      "Transaction Receipts",
      "Weekly Statement Export",
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
      "Transaction Receipts",
      "Multi-Store (up to 3 locations)",
      "Audit Action Logs",
      "Weekly, Monthly & Yearly Exports",
      "2-day grace period",
      "Contact Support",
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
// available to admin.html, cashier.html, and auth.html alike.
// (Fixes issues #3-#7: ReferenceErrors from missing functions)
// ============================================================

// Module-level state for plan selectors
let _renewSelectedPlan = "starter";
let _loginSubSelectedPlan = "starter";
let completeRenewOverride = null;
let _pendingLoginRenewal = null;
let _pendingPaystackConfirm = null;
let _pendingRenew = null;

function _handlePaystackConfirm() {
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
          <button class="btn btn-primary btn-lg" style="flex:2" onclick="_handlePaystackConfirm()">${Icon.checkCircle} Activate Trial</button>
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
        <button class="btn btn-primary btn-lg" style="flex:2" onclick="_handlePaystackConfirm()">${Icon.paystack} Pay Now</button>
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

// completeRegistration is defined in auth.js (auth.html only).
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
  if (_area) _area.style.overflow = "";
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
  renderContent(tab);
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
  }
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
  window.location.href = "auth.html";
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
function renderInvStockCell(item) {
  if (item.stock === null || item.stock === undefined)
    return '<span class="text-muted">-</span>';
  if (item.stock === 0)
    return `<span class="badge badge-red" style="font-family:var(--font-mono);font-size:11px">0</span>`;
  if (item.stock <= 5)
    return `<span style="color:var(--accent);font-weight:700">${item.stock}</span>`;
  return `<span>${item.stock}</span>`;
}

function renderInvRow(item, isRestaurant, showLocCol, locations) {
  const catLabels = { meals: "Meals", drinks: "Drinks", others: "Others" };
  const catCell = isRestaurant
    ? `<td><span class="badge badge-gray">${
        catLabels[item.category] || item.category || "-"
      }</span></td>`
    : "";
  const locCell = showLocCol
    ? `<td class="text-muted text-sm">${sanitize(
        locations?.find((l) => l.id === item.locationId)?.name ||
          (item.locationId ? "Unknown" : "Shared")
      )}</td>`
    : "";
  const isAdmin = currentUser.role === "admin";
  const actionCell = isAdmin
    ? `<td><div class="td-actions">
    <button class="btn btn-sm btn-outline" onclick="openItemModal('${
      item.id
    }')">${Icon.edit}</button>
    <button class="btn btn-sm ${
      item.status === "active" ? "btn-outline" : "btn-outline"
    }" onclick="toggleItemStatus('${item.id}')" title="${
        item.status === "active" ? "Deactivate" : "Activate"
      }">${item.status === "active" ? "Deactivate" : "Activate"}</button>
    <button class="btn btn-sm btn-danger-outline" onclick="deleteItem('${
      item.id
    }')">${Icon.trash}</button>
  </div></td>`
    : "";
  return `<tr>
    <td><strong>${sanitize(item.name)}</strong></td>
    ${catCell}
    <td class="text-mono">${formatCurrency(item.price)}</td>
    <td class="text-mono">${renderInvStockCell(item)}</td>
    <td><span class="badge ${
      item.status === "active" ? "badge-green" : "badge-red"
    }">${item.status}</span></td>
    ${locCell}
    ${actionCell}
  </tr>`;
}

function renderItems(area) {
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const plan = biz?.plan || "starter";
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
  const isRestaurant = biz?.businessType === "restaurant";
  const isAdmin = currentUser.role === "admin";
  const cashierLocationId = currentUser.locationId || "";
  const locations = store.locations.filter(
    (l) => l.businessId === currentUser.businessId
  );
  const hasLocations = locations.length > 0;
  const allBizItems = store.items.filter(
    (i) => i.businessId === currentUser.businessId
  );
  const items = !hasLocations
    ? allBizItems
    : allBizItems.filter((i) => {
        const shared = !i.locationId;
        if (cashierLocationId)
          return shared || i.locationId === cashierLocationId;
        return isAdmin || shared;
      });
  const activeItemCount = items.filter((i) => i.status === "active").length;
  const showLocCol = isAdmin && hasLocations;
  const catFilterHTML =
    isRestaurant && isAdmin
      ? `<select id="inv-cat-filter" class="form-select" style="height:34px;width:130px" onchange="filterInventoryItems()"><option value="all">All Categories</option><option value="meals">Meals</option><option value="drinks">Drinks</option><option value="others">Others</option></select>`
      : "";
  const locBadge =
    !isAdmin && hasLocations && cashierLocationId
      ? `<span style="font-size:12px;color:var(--gray-500);font-family:var(--font-mono);margin-left:8px">${sanitize(
          locations.find((l) => l.id === cashierLocationId)?.name || ""
        )}</span>`
      : "";
  const colCount =
    (isRestaurant ? 1 : 0) + (showLocCol ? 1 : 0) + (isAdmin ? 1 : 0) + 4;
  area.innerHTML = `
  <div class="page-header">
    <h2 class="page-title">Items <span style="font-size:13px;color:var(--gray-400);font-weight:400;font-family:var(--font-main)">${activeItemCount}${
    limits.items !== Infinity ? " / " + limits.items : ""
  } active${locBadge}</span></h2>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <div class="search-box"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--gray-400)"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input id="inv-search" type="text" placeholder="Search items..." style="padding-left:30px;height:34px" oninput="filterInventoryItems()"/></div>
      ${catFilterHTML}
      <select id="inv-status-filter" class="form-select" style="height:34px;width:140px" onchange="filterInventoryItems()"><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="out-of-stock">Out of Stock</option></select>
      ${
        isAdmin
          ? `<button class="btn btn-primary" onclick="openItemModal(null)">${Icon.plus} Add Item</button>`
          : ""
      }
    </div>
  </div>
  <div class="card"><div class="table-wrapper"><table>
    <thead><tr>
      <th>Item Name</th>${isRestaurant ? "<th>Category</th>" : ""}
      <th>Price</th><th>Stock</th><th>Status</th>
      ${showLocCol ? "<th>Location</th>" : ""}
      ${isAdmin ? "<th></th>" : ""}
    </tr></thead>
    <tbody id="inv-table-body">
      ${
        items.length === 0
          ? `<tr><td colspan="${colCount}"><div class="empty-state">${
              hasLocations && cashierLocationId
                ? "No items for your location yet."
                : "No items in inventory."
            }</div></td></tr>`
          : items
              .map((item) =>
                renderInvRow(item, isRestaurant, showLocCol, locations)
              )
              .join("")
      }
    </tbody>
  </table></div></div>`;
}

let _invFilterTimer = null;
function filterInventoryItems() {
  clearTimeout(_invFilterTimer);
  _invFilterTimer = setTimeout(_doFilterInventory, 120);
}
function _doFilterInventory() {
  const q = (document.getElementById("inv-search")?.value || "").toLowerCase();
  const statusFilter =
    document.getElementById("inv-status-filter")?.value || "all";
  const catFilter = document.getElementById("inv-cat-filter")?.value || "all";
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const isRestaurant = biz?.businessType === "restaurant";
  const isAdmin = currentUser.role === "admin";
  const cashierLocationId = currentUser.locationId || "";
  const locations = store.locations.filter(
    (l) => l.businessId === currentUser.businessId
  );
  const hasLocations = locations.length > 0;
  const showLocCol = isAdmin && hasLocations;
  const allBizItems = store.items.filter(
    (i) => i.businessId === currentUser.businessId
  );
  const items = !hasLocations
    ? allBizItems
    : allBizItems.filter((i) => {
        const shared = !i.locationId;
        if (cashierLocationId)
          return shared || i.locationId === cashierLocationId;
        return isAdmin || shared;
      });
  const filtered = items.filter((i) => {
    const matchName = i.name.toLowerCase().includes(q);
    let matchStatus;
    if (statusFilter === "out-of-stock")
      matchStatus = i.stock !== null && i.stock !== undefined && i.stock === 0;
    else matchStatus = statusFilter === "all" || i.status === statusFilter;
    const matchCat =
      !isRestaurant || catFilter === "all" || i.category === catFilter;
    return matchName && matchStatus && matchCat;
  });
  const tbody = document.getElementById("inv-table-body");
  if (!tbody) return;
  const colCount =
    (isRestaurant ? 1 : 0) + (showLocCol ? 1 : 0) + (isAdmin ? 1 : 0) + 4;
  tbody.innerHTML =
    filtered.length === 0
      ? `<tr><td colspan="${colCount}"><div class="empty-state">No items match your search.</div></td></tr>`
      : filtered
          .map((item) =>
            renderInvRow(item, isRestaurant, showLocCol, locations)
          )
          .join("");
}

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

function refreshPOSItemCache() {
  _posItems = getStore().items.filter(
    (i) => i.businessId === currentUser.businessId && i.status === "active"
  );
}

function refreshPOSItemsOnly() {
  if (activeTab !== "pos") return;
  refreshPOSItemCache();
  const q = (
    document.getElementById("pos-search-input")?.value || ""
  ).toLowerCase();
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const isRestaurant = biz?.businessType === "restaurant";
  let filtered = _posItems.filter((i) => i.name.toLowerCase().includes(q));
  if (isRestaurant && _posActiveCat !== "all")
    filtered = filtered.filter((i) => i.category === _posActiveCat);
  const grid = document.getElementById("pos-items-grid");
  if (grid) grid.innerHTML = renderPOSItemsHTML(filtered);
}

function renderPOS(area) {
  refreshPOSItemCache();
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const isRestaurant = biz?.businessType === "restaurant";
  area.style.paddingBottom = "0";
  area.style.overflow = "hidden";
  const sym = getCurrencySymbol();
  // Category label map for display
  const CAT_LABELS = {
    all: "All",
    meals: "Meals",
    drinks: "Drinks",
    others: "Others",
  };
  const catTabs = isRestaurant
    ? `
    <div class="pos-cat-tabs">
      ${["all", "meals", "drinks", "others"]
        .map(
          (c) =>
            `<button class="btn btn-sm pos-cat-btn${
              _posActiveCat === c ? " active-cat" : " btn-outline"
            }" data-cat="${c}" onclick="setPOSCat('${c}')">${
              CAT_LABELS[c]
            }</button>`
        )
        .join("")}
    </div>`
    : "";
  area.innerHTML = `
<div class="pos-layout">
  <div class="pos-items-panel">
    ${catTabs}
    <div class="pos-search">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input id="pos-search-input" type="text" placeholder="Search items…" oninput="filterPOSItems()" autocomplete="off"/>
    </div>
    <div class="pos-items-grid" id="pos-items-grid">
      ${renderPOSItemsHTML(_posItems)}
    </div>
  </div>
  <div class="pos-cart">
    <div class="pos-cart-header">${
      Icon.cart
    } Cart <span id="pos-cart-count" style="margin-left:auto;font-size:11px;color:var(--gray-400)"></span></div>
    <div class="pos-cart-items" id="pos-cart-items"></div>
    <div class="pos-cart-footer">
      <div class="total-row"><span class="total-label">Subtotal</span><span class="total-amount text-mono" id="pos-subtotal">${sym}0.00</span></div>
      <div class="total-row" style="border-top:2px solid var(--black);padding-top:10px;margin-top:4px">
        <span class="grand-total-label">Total</span>
        <span class="grand-total-amount" id="pos-total">${sym}0.00</span>
      </div>
      <div class="payment-toggle">
        <button class="pay-btn${
          posPayMethod === "cash" ? " active" : ""
        }" id="pay-btn-cash" onclick="setPayMethod('cash')">Cash</button>
        <button class="pay-btn${
          posPayMethod === "card" ? " active" : ""
        }" id="pay-btn-card" onclick="setPayMethod('card')">Card</button>
      </div>
      <button class="btn btn-primary btn-full btn-lg" onclick="handlePOSCheckout()">${
        Icon.cart
      } Checkout</button>
    </div>
  </div>
</div>`;
  updateCartUI();
}

function renderPOSItemsHTML(items) {
  if (items.length === 0)
    return `<div style="grid-column:1/-1;text-align:center;padding:40px 20px;color:var(--gray-400);font-size:13px">No items found.</div>`;
  return items
    .map((item) => {
      const outOfStock =
        item.stock !== null && item.stock !== undefined && item.stock === 0;
      const lowStock =
        !outOfStock &&
        item.stock !== null &&
        item.stock !== undefined &&
        item.stock <= 5;
      const cartLine = posCart.find((c) => c.id === item.id);
      const qty = cartLine ? cartLine.quantity : 0;
      // Use proper CSS classes: pos-item-btn (has border), pos-item-btn.pos-item-out-of-stock (greyed), pos-item-btn.pos-item-low-stock (amber)
      let cls = "pos-item-btn";
      if (outOfStock) cls += " pos-item-out-of-stock";
      else if (lowStock) cls += " pos-item-low-stock";
      return `<button class="${cls}" data-id="${
        item.id
      }" onclick="addToCartById(this)" ${
        outOfStock ? 'disabled aria-disabled="true"' : ""
      } type="button">
      ${
        qty > 0
          ? `<span style="position:absolute;top:6px;right:6px;background:var(--black);color:white;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;font-family:var(--font-mono);line-height:16px">${qty}</span>`
          : ""
      }
      <span class="pos-item-name">${sanitize(item.name)}</span>
      <span class="pos-item-price">${formatCurrency(item.price)}</span>
      ${
        outOfStock
          ? `<span style="font-size:10px;color:var(--red);font-family:var(--font-mono);font-weight:600">Out of stock</span>`
          : ""
      }
      ${
        lowStock
          ? `<span style="font-size:10px;color:#8a6200;font-family:var(--font-mono);font-weight:600">${item.stock} left</span>`
          : ""
      }
    </button>`;
    })
    .join("");
}

let _posFilterTimer = null;
function filterPOSItems() {
  clearTimeout(_posFilterTimer);
  _posFilterTimer = setTimeout(_doFilterPOS, 80);
}
function _doFilterPOS() {
  const q = (
    document.getElementById("pos-search-input")?.value || ""
  ).toLowerCase();
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const isRestaurant = biz?.businessType === "restaurant";
  let filtered = _posItems.filter((i) => i.name.toLowerCase().includes(q));
  if (isRestaurant && _posActiveCat !== "all")
    filtered = filtered.filter((i) => i.category === _posActiveCat);
  const grid = document.getElementById("pos-items-grid");
  if (grid) grid.innerHTML = renderPOSItemsHTML(filtered);
}

function setPOSCat(cat) {
  _posActiveCat = cat;
  // Update only the tab button states — no full POS re-render
  document.querySelectorAll(".pos-cat-btn").forEach((btn) => {
    const isActive = btn.dataset.cat === cat;
    btn.className =
      "btn btn-sm pos-cat-btn" + (isActive ? " active-cat" : " btn-outline");
  });
  // Update only the items grid
  const q = (
    document.getElementById("pos-search-input")?.value || ""
  ).toLowerCase();
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const isRestaurant = biz?.businessType === "restaurant";
  let filtered = _posItems.filter((i) => i.name.toLowerCase().includes(q));
  if (isRestaurant && cat !== "all")
    filtered = filtered.filter((i) => i.category === cat);
  const grid = document.getElementById("pos-items-grid");
  if (grid) grid.innerHTML = renderPOSItemsHTML(filtered);
}

function setPayMethod(method) {
  posPayMethod = method;
  try {
    localStorage.setItem("ss_pos_pay_method", method);
  } catch (e) {}
  // Toggle only the pay button states — no full POS re-render
  const cashBtn = document.getElementById("pay-btn-cash");
  const cardBtn = document.getElementById("pay-btn-card");
  if (cashBtn)
    cashBtn.className = "pay-btn" + (method === "cash" ? " active" : "");
  if (cardBtn)
    cardBtn.className = "pay-btn" + (method === "card" ? " active" : "");
}

function addToCartById(btn) {
  const id = btn.dataset?.id || btn.getAttribute("data-id");
  if (id) addToCart(id, btn);
}

function addToCart(id, sourceBtn) {
  const store = getStore();
  const item = store.items.find((i) => i.id === id);
  if (!item || item.status !== "active") return;
  if (item.stock !== null && item.stock !== undefined && item.stock === 0) {
    toast("This item is out of stock", "error");
    return;
  }
  const existing = posCart.find((c) => c.id === id);
  if (existing) {
    if (
      item.stock !== null &&
      item.stock !== undefined &&
      existing.quantity >= item.stock
    ) {
      toast(`Only ${item.stock} in stock`, "error");
      return;
    }
    existing.quantity++;
  } else {
    posCart.push({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: 1,
    });
  }
  // Flash animation on the clicked button
  if (sourceBtn) {
    sourceBtn.classList.remove("flash");
    void sourceBtn.offsetWidth; // force reflow to restart animation
    sourceBtn.classList.add("flash");
    setTimeout(() => sourceBtn.classList.remove("flash"), 400);
    // Update just this button's qty badge without re-rendering the whole grid
    const cartLine = posCart.find((c) => c.id === id);
    const qty = cartLine ? cartLine.quantity : 0;
    let badge = sourceBtn.querySelector(".pos-qty-badge");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "pos-qty-badge";
      badge.style.cssText =
        "position:absolute;top:6px;right:6px;background:var(--black);color:white;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;font-family:var(--font-mono);line-height:16px";
      sourceBtn.appendChild(badge);
    }
    badge.textContent = qty;
  } else {
    refreshPOSItemsOnly();
  }
  updateCartUI();
}

function changeQty(id, delta) {
  const line = posCart.find((c) => c.id === id);
  if (!line) return;
  line.quantity += delta;
  if (line.quantity <= 0) posCart = posCart.filter((c) => c.id !== id);
  updateCartUI();
  refreshPOSItemsOnly();
}

function removeFromCart(id) {
  posCart = posCart.filter((c) => c.id !== id);
  updateCartUI();
  refreshPOSItemsOnly();
}

function updateCartUI() {
  const cartEl = document.getElementById("pos-cart-items");
  const subtotalEl = document.getElementById("pos-subtotal");
  const totalEl = document.getElementById("pos-total");
  const countEl = document.getElementById("pos-cart-count");
  if (!cartEl) return;
  const subtotal = posCart.reduce((a, c) => a + c.price * c.quantity, 0);
  const totalQty = posCart.reduce((a, c) => a + c.quantity, 0);
  if (countEl)
    countEl.textContent =
      totalQty > 0 ? `${totalQty} item${totalQty === 1 ? "" : "s"}` : "";
  if (posCart.length === 0) {
    cartEl.innerHTML = `<div class="cart-empty-state"><svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg><span>Cart is empty</span></div>`;
  } else {
    cartEl.innerHTML = posCart
      .map(
        (c) => `
      <div class="pos-cart-item">
        <div class="pos-cart-item-info">
          <div class="pos-cart-item-name">${sanitize(c.name)}</div>
          <div class="pos-cart-item-price">${formatCurrency(c.price)}</div>
        </div>
        <div class="qty-ctrl">
          <button class="qty-btn" onclick="changeQty('${
            c.id
          }',-1)" aria-label="Decrease">−</button>
          <span class="qty-num">${c.quantity}</span>
          <button class="qty-btn" onclick="changeQty('${
            c.id
          }',1)" aria-label="Increase">+</button>
        </div>
        <button class="cart-remove-btn" onclick="removeFromCart('${
          c.id
        }')" aria-label="Remove">${Icon.trash}</button>
      </div>`
      )
      .join("");
  }
  if (subtotalEl) subtotalEl.textContent = formatCurrency(subtotal);
  if (totalEl) totalEl.textContent = formatCurrency(subtotal);
}

function handlePOSCheckout() {
  if (!currentUser.businessId) return;
  if (currentUser.role !== "super-admin") {
    const active = enforceSubscription(currentUser.businessId);
    if (!active) {
      toast("Subscription expired. POS transactions are suspended.", "error");
      navigate(currentUser.role === "cashier" ? "contact" : "subscriptions");
      return;
    }
  }
  if (posCart.length === 0) {
    toast("Add items to the cart first", "error");
    return;
  }
  const store = getStore();
  const stockErrors = [];
  for (const cartLine of posCart) {
    const freshItem = store.items.find((i) => i.id === cartLine.id);
    if (
      freshItem &&
      freshItem.stock !== null &&
      freshItem.stock !== undefined &&
      freshItem.stock < cartLine.quantity
    ) {
      stockErrors.push(
        `${sanitize(freshItem.name)}: only ${freshItem.stock} unit${
          freshItem.stock === 1 ? "" : "s"
        } available, but ${cartLine.quantity} in cart.`
      );
    }
  }
  if (stockErrors.length > 0) {
    stockErrors.forEach((err) => toast(`Stock issue: ${err}`, "error"));
    refreshPOSItemsOnly();
    return;
  }
  const subtotal = posCart.reduce((a, c) => a + c.price * c.quantity, 0);
  const typeLabel = posPayMethod === "card" ? "Card" : "Cash";
  const isCash = posPayMethod === "cash";
  const sym = getCurrencySymbol();
  openModal(
    `Confirm ${typeLabel} Payment`,
    `
    <div style="padding:8px 0">
      <div style="background:var(--gray-50);border:1px solid var(--gray-100);border-radius:var(--radius);padding:12px;margin-bottom:14px;font-size:13px">
        ${posCart
          .map(
            (c) =>
              `<div style="display:flex;justify-content:space-between;padding:2px 0"><span>${sanitize(
                c.name
              )} ×${c.quantity}</span><span class="text-mono">${formatCurrency(
                c.price * c.quantity
              )}</span></div>`
          )
          .join("")}
        <div style="display:flex;justify-content:space-between;padding-top:8px;border-top:1px solid var(--gray-200);font-weight:700"><span>Subtotal</span><span class="text-mono" id="modal-subtotal">${formatCurrency(
          subtotal
        )}</span></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
        <label style="font-size:12px;color:var(--gray-500);white-space:nowrap;font-family:var(--font-mono);font-weight:600;text-transform:uppercase;letter-spacing:.06em">Discount</label>
        <input id="discount-val" type="number" min="0" class="form-input" style="height:34px;width:90px" placeholder="0" oninput="updateDiscountPreview(${subtotal})"/>
        <select id="discount-type" class="form-select" style="height:34px;width:70px" onchange="updateDiscountPreview(${subtotal})"><option value="flat">${sym}</option><option value="pct">%</option></select>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:20px;font-weight:900;font-family:var(--font-mono);margin-bottom:16px;padding:10px 0;border-top:2px solid var(--black)"><span>Total</span><span id="modal-total">${formatCurrency(
        subtotal
      )}</span></div>
      ${
        isCash
          ? `
      <div style="margin-bottom:8px">
        <label style="display:block;font-size:12px;color:var(--gray-500);font-family:var(--font-mono);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">Amount Received <span style="color:var(--red)">*</span></label>
        <input id="cash-received" type="number" min="0" step="0.01" class="form-input" style="height:40px" placeholder="Enter amount given by customer" oninput="updateChangePreview(${subtotal})" autocomplete="off"/>
        <div id="cash-received-error" style="display:none;font-size:11px;color:var(--red);margin-top:4px;font-family:var(--font-mono)">Amount received is required for cash transactions.</div>
      </div>
      <div id="change-preview" style="display:none;justify-content:space-between;font-size:15px;font-weight:700;font-family:var(--font-mono);margin-bottom:14px;padding:10px 12px;background:var(--green-bg);border:1px solid #b2d9c3;border-radius:var(--radius)">
        <span>Change</span><span id="change-amount" style="color:var(--green)">${formatCurrency(
          0
        )}</span>
      </div>`
          : `<div style="font-size:13px;color:var(--gray-500);text-align:center;margin-bottom:12px">Present card to terminal to complete payment</div>`
      }
      <div style="display:flex;gap:10px">
        <button class="btn btn-outline btn-lg" style="flex:1" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary btn-lg" style="flex:2" onclick="confirmPOSPayment('${posPayMethod}',${subtotal})">${
      Icon.checkCircle
    } Confirm ${typeLabel}</button>
      </div>
    </div>`
  );
}

function updateDiscountPreview(subtotal) {
  const val = parseFloat(document.getElementById("discount-val")?.value) || 0;
  const type = document.getElementById("discount-type")?.value || "flat";
  const discount =
    type === "pct"
      ? subtotal * (Math.min(val, 100) / 100)
      : Math.min(val, subtotal);
  const finalTotal = Math.max(0, subtotal - discount);
  const el = document.getElementById("modal-total");
  if (el) el.textContent = formatCurrency(finalTotal);
}

function updateChangePreview(subtotal) {
  const discountVal =
    parseFloat(document.getElementById("discount-val")?.value) || 0;
  const dtype = document.getElementById("discount-type")?.value || "flat";
  const discount =
    dtype === "pct"
      ? subtotal * (Math.min(discountVal, 100) / 100)
      : Math.min(discountVal, subtotal);
  const finalTotal = Math.max(0, subtotal - discount);
  const cashInput = document.getElementById("cash-received");
  const received = parseFloat(cashInput?.value) || 0;
  const change = received - finalTotal;
  const previewEl = document.getElementById("change-preview");
  const changeEl = document.getElementById("change-amount");
  const errorEl = document.getElementById("cash-received-error");
  if (received > 0 && cashInput) {
    cashInput.classList.remove("invalid");
    if (errorEl) errorEl.style.display = "none";
  }
  if (previewEl && changeEl) {
    if (received > 0) {
      previewEl.style.display = "flex";
      if (change >= 0) {
        changeEl.textContent = formatCurrency(change);
        changeEl.style.color = "var(--green)";
        previewEl.style.background = "var(--green-bg)";
        previewEl.style.borderColor = "#b2d9c3";
      } else {
        changeEl.textContent = `${formatCurrency(Math.abs(change))} short`;
        changeEl.style.color = "var(--red)";
        previewEl.style.background = "var(--red-bg)";
        previewEl.style.borderColor = "#f5c0c4";
      }
    } else {
      previewEl.style.display = "none";
    }
  }
}

function confirmPOSPayment(type, subtotal) {
  const val = parseFloat(document.getElementById("discount-val")?.value) || 0;
  const dtype = document.getElementById("discount-type")?.value || "flat";
  window._posLastDiscountType = dtype;
  window._posLastDiscountVal = val;
  const discount =
    dtype === "pct"
      ? subtotal * (Math.min(val, 100) / 100)
      : Math.min(val, subtotal);
  const finalTotal = Math.max(0, subtotal - discount);
  if (type === "cash") {
    const cashInput = document.getElementById("cash-received");
    const errorEl = document.getElementById("cash-received-error");
    const receivedRaw = cashInput?.value?.trim();
    const received = parseFloat(receivedRaw);
    if (!receivedRaw || isNaN(received) || received <= 0) {
      if (cashInput) {
        cashInput.classList.add("invalid");
        cashInput.focus();
      }
      if (errorEl) errorEl.style.display = "block";
      toast("Please enter the amount received from the customer.", "error");
      return;
    }
    if (received < finalTotal) {
      if (cashInput) {
        cashInput.classList.add("invalid");
        cashInput.focus();
      }
      if (errorEl) {
        errorEl.textContent = `Amount received (${formatCurrency(
          received
        )}) is less than the total (${formatCurrency(finalTotal)}).`;
        errorEl.style.display = "block";
      }
      toast("Amount received is less than the total due.", "error");
      return;
    }
    if (cashInput) cashInput.classList.remove("invalid");
    if (errorEl) errorEl.style.display = "none";
    window._posAmountReceived = received;
    window._posChange = Math.max(0, received - finalTotal);
  } else {
    window._posAmountReceived = null;
    window._posChange = null;
  }
  closeModal();
  recordTransaction(finalTotal, type, discount > 0 ? discount : null);
}

function generateReceiptId(businessId) {
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === businessId);
  const bizName = (biz?.name || "SALE")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase()
    .slice(0, 4)
    .padEnd(4, "X");
  const todayStr = localDateStr(new Date());
  // Include date in the ID format: BIZX-YYYYMMDD-0001 so receipts are unique across days
  const todayCompact = todayStr.replace(/-/g, "");
  const todayCount = (store.transactions || []).filter(
    (t) =>
      t.businessId === businessId &&
      t.createdAt &&
      localDateStr(new Date(t.createdAt)) === todayStr
  ).length;
  const seq = String(todayCount + 1).padStart(4, "0");
  return `${bizName}-${todayCompact}-${seq}`;
}

function recordTransaction(total, type, discount) {
  const itemsSummary = posCart
    .map((c) => `${sanitize(c.name)} ×${c.quantity}`)
    .join(", ");
  const receiptId = generateReceiptId(currentUser.businessId);
  const cartSnapshot = [...posCart];
  const txn = {
    id: `trx-${uid()}`,
    receiptId,
    businessId: currentUser.businessId,
    cashierId: currentUser.id,
    cashierName: currentUser.name,
    amount: total,
    discount: discount || 0,
    discountType: window._posLastDiscountType || "flat",
    discountPct:
      window._posLastDiscountType === "pct"
        ? window._posLastDiscountVal || 0
        : null,
    amountReceived: window._posAmountReceived || null,
    change: window._posChange || null,
    type,
    itemsSummary,
    createdAt: new Date().toISOString(),
  };
  updateStore((d) => {
    const updatedItems = d.items.map((item) => {
      const cartLine = cartSnapshot.find((c) => c.id === item.id);
      if (!cartLine) return item;
      if (item.stock === null || item.stock === undefined) return item;
      return { ...item, stock: Math.max(0, item.stock - cartLine.quantity) };
    });
    return {
      ...d,
      transactions: [...d.transactions, txn],
      items: updatedItems,
    };
  });
  addAuditLog(`Processed ${type} transaction`, formatCurrency(total));
  // Update dashboard chart live if it's currently visible (admin only)
  if (typeof updateDashboardChart === "function" && activeTab === "dashboard")
    updateDashboardChart();
  posCart = [];
  const searchInput = document.getElementById("pos-search-input");
  if (searchInput) searchInput.value = "";
  updateCartUI();
  refreshPOSItemCache();
  filterPOSItems();
  openModal(
    "Receipt",
    `
    <div style="text-align:center;padding:8px 0 16px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--gray-400);font-family:var(--font-mono);margin-bottom:4px">Receipt</div>
      <div style="font-size:13px;font-family:var(--font-mono);color:var(--gray-500);margin-bottom:16px">${receiptId}</div>
      <div style="background:var(--gray-50);border:1px solid var(--gray-100);border-radius:var(--radius);padding:14px;text-align:left;margin-bottom:16px;font-size:13px">
        ${cartSnapshot
          .map(
            (c) =>
              `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--gray-100)"><span>${sanitize(
                c.name
              )} ×${c.quantity}</span><span class="text-mono">${formatCurrency(
                c.price * c.quantity
              )}</span></div>`
          )
          .join("")}
        ${
          discount
            ? `<div style="display:flex;justify-content:space-between;padding:3px 0;color:var(--green)"><span>Discount (${
                window._posLastDiscountType === "pct"
                  ? window._posLastDiscountVal + "%"
                  : "flat"
              })</span><span class="text-mono">−${formatCurrency(
                discount
              )}</span></div>`
            : ""
        }
        <div style="display:flex;justify-content:space-between;padding-top:8px;font-weight:700"><span>Total</span><span class="text-mono">${formatCurrency(
          total
        )}</span></div>
      </div>
      <div style="font-size:12px;color:var(--gray-500);margin-bottom:4px">Payment: <strong>${
        type === "cash" ? "Cash" : "Card"
      }</strong></div>
      ${
        type === "cash" && window._posAmountReceived
          ? `<div style="font-size:12px;color:var(--gray-500);margin-bottom:2px">Amount Received: <strong class="text-mono">${formatCurrency(
              window._posAmountReceived
            )}</strong></div>`
          : ""
      }
      ${
        type === "cash" && window._posChange != null
          ? `<div style="font-size:13px;color:var(--green);font-weight:700;margin-bottom:4px">Change: ${formatCurrency(
              window._posChange
            )}</div>`
          : ""
      }
      <div style="font-size:12px;color:var(--gray-400);margin-bottom:20px">Served by: ${sanitize(
        currentUser.name
      )}</div>
      <button class="btn btn-primary btn-full btn-lg" onclick="closeModal()">${
        Icon.checkCircle
      } Done</button>
    </div>`
  );
}

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
function renderContact(area) {
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  area.innerHTML = `
  <div class="page-header"><h2 class="page-title">Contact Support</h2></div>
  <div class="card" style="max-width:500px">
    <div class="card-body">
      <div class="form-group"><label class="form-label">Business Name</label><input class="form-input" value="${sanitize(
        biz?.name || "N/A"
      )}" disabled/></div>
      <div class="form-group"><label class="form-label">Your Name</label><input class="form-input" value="${sanitize(
        currentUser.name
      )}" disabled/></div>
      <div class="form-group"><label class="form-label">Email Address</label><input class="form-input" value="${
        currentUser.email || ""
      }" disabled/></div>
      <div class="form-group"><label class="form-label">Message</label><textarea id="support-msg" class="form-textarea" placeholder="How can we help you?"></textarea></div>
      <button class="btn btn-primary btn-full btn-lg" onclick="sendSupportMessage()">${
        Icon.mail
      } Send Message</button>
    </div>
  </div>`;
}

function sendSupportMessage() {
  const msgEl = document.getElementById("support-msg");
  const msg = msgEl ? msgEl.value.trim() : "";
  if (!msg) {
    if (msgEl) msgEl.classList.add("invalid");
    toast("Please enter a message", "error");
    return;
  }
  if (msgEl) msgEl.classList.remove("invalid");
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  updateStore((d) => ({
    ...d,
    messages: [
      ...d.messages,
      {
        id: `msg-${uid()}`,
        businessId: currentUser.businessId || "direct",
        businessName: biz?.name || currentUser.name,
        senderName: currentUser.name,
        senderRole: currentUser.role,
        email: currentUser.email,
        message: sanitize(msg),
        createdAt: new Date().toISOString(),
        read: false,
      },
    ],
  }));
  document.getElementById("support-msg").value = "";
  toast("Message sent to support!", "success");
}

// ============================================================
// SHARED: SETTINGS (admin + cashier)
// super-admin has its own renderSettings in super-admin.js
// ============================================================
function renderSettings(area) {
  if (currentUser.role === "super-admin") {
    _renderSuperAdminSettings(area);
    return;
  }
  const store = getStore();
  const biz = currentUser.businessId
    ? store.businesses.find((b) => b.id === currentUser.businessId)
    : null;
  const st = biz ? getSubStatus(biz.id) : null;
  const limits = biz ? PLAN_LIMITS[biz.plan] || PLAN_LIMITS.starter : null;
  const isCashier = currentUser.role === "cashier";
  area.innerHTML = `
  <div class="page-header"><h2 class="page-title">Account Settings</h2></div>
  <div style="display:flex;flex-direction:column;gap:20px;max-width:1040px">
    <div class="settings-grid" style="display:grid;grid-template-columns:${
      biz && !isCashier ? "1fr 1fr" : "1fr"
    };gap:20px;align-items:start">
      ${
        biz && !isCashier
          ? `
      <div class="card">
        <div class="card-header"><span class="card-title">Business Details</span></div>
        <div class="card-body">
          <div class="form-group"><label class="form-label">Business Name</label><input id="s-biz-name" class="form-input" value="${sanitize(
            biz.name
          )}" placeholder="Business name"/></div>
          <div class="form-group"><label class="form-label">Business Email</label><input id="s-biz-email" class="form-input" type="email" value="${sanitize(
            biz.email || ""
          )}" placeholder="business@example.com"/></div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">
            <div><div class="form-label">Plan</div><span class="badge badge-gray" style="font-size:13px;padding:4px 10px">${
              limits?.label || biz.plan
            }</span></div>
            <div><div class="form-label">Subscription</div><span class="badge ${
              st?.badge || "badge-gray"
            }" style="font-size:13px;padding:4px 10px">${
              st?.label || "Unknown"
            }</span></div>
            ${
              st?.daysLeft
                ? `<div><div class="form-label">Days Left</div><span style="font-size:14px;font-weight:700;font-family:var(--font-mono)">${st.daysLeft}</span></div>`
                : ""
            }
          </div>
          <button class="btn btn-primary btn-full" onclick="saveBusinessDetails()">Update Business Details</button>
        </div>
      </div>`
          : ""
      }
      <div class="card" style="${isCashier ? "max-width:480px" : ""}">
        <div class="card-header"><span class="card-title">Personal Details</span></div>
        <div class="card-body">
          <div class="form-group"><label class="form-label">Full Name</label><input id="s-name" class="form-input" value="${sanitize(
            currentUser.name
          )}"/></div>
          <div class="form-group"><label class="form-label">Email Address</label><input id="s-email" class="form-input" type="email" value="${
            currentUser.email
          }"/></div>
          <div class="form-group"><label class="form-label">New Password</label>
            <div class="pw-wrap"><input id="s-pass" class="form-input" type="password" placeholder="Leave blank to keep current"/>
            <button class="pw-toggle" type="button" onclick="togglePw('s-pass')"><svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></div>
          </div>
          <button class="btn btn-primary btn-full btn-lg" onclick="saveSettings()">Update Details</button>
        </div>
      </div>
    </div>
    ${
      currentUser.role === "admin"
        ? `
    <div class="card" style="border-color:var(--red);background:var(--red-bg);margin-bottom:4px">
      <div class="card-body" style="display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap">
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--red);font-family:var(--font-mono);margin-bottom:4px">Danger Zone</div>
          <div style="font-size:13px;color:var(--gray-600)">Permanently delete your business, all cashier accounts, inventory, transactions and subscription data.</div>
        </div>
        <button class="btn btn-danger-outline" onclick="deleteAccount()" style="white-space:nowrap;flex-shrink:0">Delete Account</button>
      </div>
    </div>`
        : ""
    }
  </div>`;
}

function saveBusinessDetails() {
  const nameEl = document.getElementById("s-biz-name");
  const emailEl = document.getElementById("s-biz-email");
  if (!nameEl) return;
  const name = nameEl.value.trim();
  const email = emailEl ? emailEl.value.trim().toLowerCase() : "";
  if (!name) {
    toast("Business name cannot be empty", "error");
    return;
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    toast("Please enter a valid business email", "error");
    return;
  }
  updateStore((d) => ({
    ...d,
    businesses: d.businesses.map((b) =>
      b.id === currentUser.businessId
        ? { ...b, name: sanitize(name), ...(email ? { email } : {}) }
        : b
    ),
  }));
  addAuditLog("Updated business details", name);
  toast("Business details updated", "success");
}

function saveSettings() {
  const name = document.getElementById("s-name").value.trim();
  const email = document.getElementById("s-email").value.trim().toLowerCase();
  const pass = document.getElementById("s-pass").value;
  if (!name || !email) {
    toast("Name and email are required", "error");
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    toast("Please enter a valid email address", "error");
    return;
  }
  const store = getStore();
  const dup = store.users.find(
    (u) => u.email.toLowerCase() === email && u.id !== currentUser.id
  );
  if (dup) {
    toast("This email is already in use", "error");
    return;
  }
  const updatedPass = pass ? pass : currentUser.password;
  currentUser = {
    ...currentUser,
    name: sanitize(name),
    email,
    password: updatedPass,
  };
  updateStore((d) => ({
    ...d,
    users: d.users.map((u) =>
      u.id === currentUser.id
        ? { ...u, name: sanitize(name), email, password: updatedPass }
        : u
    ),
    currentUser,
  }));
  document.getElementById("topbar-user-name").textContent = currentUser.name;
  document.getElementById("s-pass").value = "";
  toast("Settings updated", "success");
}

function deleteAccount() {
  confirm2(
    "Delete Account",
    "This will permanently delete your business, all cashier accounts, inventory, transactions and subscription data. This cannot be undone."
  ).then((ok) => {
    if (!ok) return;
    const bizId = currentUser.businessId;
    updateStore((d) => ({
      ...d,
      users: d.users.filter(
        (u) => u.id !== currentUser.id && u.businessId !== bizId
      ),
      businesses: d.businesses.filter((b) => b.id !== bizId),
      items: d.items.filter((i) => i.businessId !== bizId),
      transactions: d.transactions.filter((t) => t.businessId !== bizId),
      subscriptions: d.subscriptions.filter((s) => s.businessId !== bizId),
      messages: d.messages.filter((m) => m.businessId !== bizId),
      locations: d.locations.filter((l) => l.businessId !== bizId),
      auditLogs: d.auditLogs.filter((l) => l.businessId !== bizId),
      currentUser: null,
    }));
    performLogout();
  });
}

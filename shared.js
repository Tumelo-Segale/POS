// ============================================================
// shared.js - SaleStation
// Core utilities, storage, auth state, app shell, icons.
// Loaded by: auth.html, super-admin.html, admin.html, cashier.html
// ============================================================

// ============================================================
// STORAGE - Scalability Architecture
// ============================================================
// This frontend simulates a multi-tenant POS platform in localStorage.
// In production this would be backed by a distributed backend (e.g.
// PostgreSQL + Redis + WebSockets) capable of supporting 50,000 admins
// and 100,000 cashiers simultaneously. The BroadcastChannel API used here
// provides real-time sync across tabs on the same browser. In production,
// a WebSocket server would replace this for cross-device real-time updates.
// Data is partitioned by businessId at the query level so each business
// only loads and processes its own records - ensuring O(n/businesses)
// complexity per tenant rather than O(n) over all data.
// ============================================================
// FIX 21: Inject a Content-Security-Policy meta tag at runtime so every page
// that loads shared.js gets baseline XSS protection.
// This allowlists the exact external origins the app uses:
//   - Google Fonts (preconnect + stylesheet + font files)
//   - Paystack inline JS
//   - cdnjs (SheetJS / XLSX)
// 'unsafe-inline' is required for the inline <script> route guards in each HTML
// file; remove it if those are ever converted to external scripts.
(function injectCSP() {
  if (document.querySelector('meta[http-equiv="Content-Security-Policy"]'))
    return;
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://js.paystack.co https://cdnjs.cloudflare.com",
    // Paystack loads button.min.css from paystack.com at runtime
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://paystack.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://api.paystack.co https://checkout.paystack.com https://paystack.com",
    "img-src 'self' data: https:",
    "frame-src https://checkout.paystack.com https://paystack.com",
  ].join("; ");
  document.head.prepend(meta);
})();

// ============================================================
// ROLE CONSTANTS (FIX 17)
// ============================================================
// Centralised role strings - use these instead of bare magic strings.
const ROLES = Object.freeze({
  SUPER_ADMIN: "super-admin",
  ADMIN: "admin",
  CASHIER: "cashier",
});

const STORAGE_KEY = "salestation_v6";

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
  locations: [], // {id, businessId, name, address}
  auditLogs: [], // {id, businessId, userId, userName, action, target, ts}
  currentUser: null,
};

// SS-023: In-memory store cache - avoids redundant JSON.parse on every getStore() call.
// The cache is invalidated (set to null) whenever updateStore() or saveStore() writes.
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
    // Migrate: ensure new top-level arrays exist
    if (!s.locations) s.locations = [];
    if (!s.auditLogs) s.auditLogs = [];
    // Migrate: items get stock: null if missing
    if (s.items) s.items = s.items.map((i) => ({ stock: null, ...i }));
    // Migrate: transactions get receiptId if missing
    if (s.transactions)
      s.transactions = s.transactions.map((t) =>
        t.receiptId ? t : { ...t, receiptId: null }
      );
    // Migrate: businesses get businessType if missing
    if (s.businesses)
      s.businesses = s.businesses.map((b) =>
        b.businessType ? b : { ...b, businessType: "other" }
      );
    // Migrate: subscriptions get startedAt if missing
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
  _storeCache = data; // update cache in-place
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function updateStore(fn) {
  const current = getStore();
  const next = fn(current);
  _storeCache = null; // invalidate before save so getStore re-reads cleanly if needed
  saveStore(next);
  broadcastChange(next);
  return next;
}

// ============================================================
// AUDIT LOG
// ============================================================
function addAuditLog(action, target) {
  if (!currentUser) return;
  // Fix 4: Super admin has no businessId - use a sentinel value so logs are always recorded
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
// SUBSCRIPTION STATUS HELPERS
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
    // Cancelled: still active until expiry date (no grace period)
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
    // Past expiry - fully expired, access denied
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
  // SS-018: A subscription can be cancelled but still technically "active" until its
  // expiry date. However once expired, status === 'cancelled-expired' and active === false.
  const store = getStore();
  const sub = store.subscriptions.find((s) => s.businessId === businessId);
  const isCancelledPastExpiry =
    sub && sub.status === "cancelled" && new Date() > new Date(sub.expiresAt);
  // FIX 9: A null getSubStatus means there is no subscription record at all -
  // treat as inactive rather than silently granting access.
  if (!st || !st.active || isCancelledPastExpiry) {
    // Auto-disable business
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
      const plan = sub.nextPlan;
      const dur = PLAN_LIMITS[plan]?.durationDays || 30;
      changed = true;
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
  const newBusinesses = freshStore.businesses.map((b) => {
    const sub = freshStore.subscriptions.find((s) => s.businessId === b.id);
    if (sub && sub.nextPlan && new Date(sub.expiresAt) <= now) {
      return { ...b, plan: sub.nextPlan };
    }
    return b;
  });
  // FIX 8: Use updateStore (not saveStore) so broadcastChange() fires and other
  // tabs are notified when a scheduled plan upgrade takes effect.
  if (changed) {
    updateStore((d) => ({
      ...d,
      subscriptions: newSubscriptions,
      businesses: newBusinesses,
    }));
  }
}

// ============================================================
// WEBSOCKET SIMULATION (BroadcastChannel)
// ============================================================
let channel = null;
let wsSimInterval = null;

function initWebSocketSimulation() {
  try {
    channel = new BroadcastChannel("salestation_realtime");
    channel.onmessage = (event) => {
      handleRemoteUpdate(event.data);
    };
  } catch (e) {
    startPolling();
  }
  // Always run expiry check even when BroadcastChannel is used
  wsSimInterval =
    wsSimInterval ||
    setInterval(() => {
      if (currentUser && currentUser.businessId) {
        checkCancelledSubscriptionExpiry(currentUser.businessId);
        // Periodic sub enforcement - catches expired subs even if user never leaves POS
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
  // Re-read currentUser from store to avoid stale closure value
  const freshCurrentUserId = currentUser?.id || getStore().currentUser?.id;

  // Sidebar collapse sync across tabs
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
      // tight 1.8s window for guaranteed <2s UX
      _storeCache = null; // SS-023: invalidate cache before writing new store
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data.store));
      if (activeTab && currentUser) {
        if (activeTab === "dashboard") {
          // FIX 3: updateDashboardChart only exists on admin.js; guard before calling.
          if (typeof updateDashboardChart === "function")
            updateDashboardChart();
        } else if (activeTab !== "pos") {
          renderContent(activeTab);
        } else {
          // FIX 4: refreshPOSItemsOnly only exists on admin.js/cashier.js; guard before calling.
          if (typeof refreshPOSItemsOnly === "function") refreshPOSItemsOnly();
        }
        // Check if current user was suspended/business deactivated
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

// ============================================================
// CANCELLED SUBSCRIPTION EXPIRY ENFORCEMENT
// ============================================================
function checkCancelledSubscriptionExpiry(businessId) {
  if (!currentUser || currentUser.role === "super-admin") return;
  const store = getStore();
  const sub = store.subscriptions.find((s) => s.businessId === businessId);
  if (!sub || sub.status !== "cancelled") return;
  const now = new Date();
  const expires = new Date(sub.expiresAt);
  if (now > expires) {
    // Deactivate the business and force logout everyone
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
  // SS-024: Pause polling on background tabs to save CPU/battery; resume on visibility restore.
  let _pollInterval = null;

  function runPoll() {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current !== lastSeen) {
      lastSeen = current;
      _storeCache = null; // invalidate cache so next getStore() re-reads
      if (activeTab && currentUser) {
        if (activeTab === "dashboard") {
          // FIX 3: guard - only defined on admin.js
          if (typeof updateDashboardChart === "function")
            updateDashboardChart();
        } else if (activeTab !== "pos") {
          renderContent(activeTab);
        } else {
          // FIX 4: guard - only defined on admin.js / cashier.js
          if (typeof refreshPOSItemsOnly === "function") refreshPOSItemsOnly();
        }
      }
    }
    if (currentUser && currentUser.businessId) {
      checkCancelledSubscriptionExpiry(currentUser.businessId);
    }
  }

  function startInterval() {
    if (_pollInterval) return;
    lastSeen = localStorage.getItem(STORAGE_KEY); // re-sync on resume
    _pollInterval = setInterval(runPoll, 1500); // 1.5s poll: balanced update propagation vs CPU
  }

  function stopInterval() {
    if (_pollInterval) {
      clearInterval(_pollInterval);
      _pollInterval = null;
    }
  }

  // Start immediately if tab is visible
  if (!document.hidden) startInterval();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopInterval();
    } else {
      startInterval();
    }
  });

  wsSimInterval = { clear: stopInterval }; // expose a clear handle for performLogout
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
  // FIX 1 & 20: #session-warning only exists on app pages, not auth.html.
  // Always guard the element reference with a null check, and bail out
  // immediately when no user is logged in (prevents crash on auth page).
  const sw = document.getElementById("session-warning");
  if (sw) sw.classList.remove("show");
  if (!currentUser) return;
  // Guard: only run session timer when logged in to an app page
  // SS-010: Skip timeout entirely for "remembered" sessions
  if (currentUser._rememberMe) return;
  // Warn at 28 min - show countdown for the final 2 minutes
  sessionWarnTimer = setTimeout(() => {
    document.getElementById("session-warning").classList.add("show");
    // Start countdown from 2:00
    let secsLeft = 120;
    function updateCountdown() {
      const m = Math.floor(secsLeft / 60);
      const s = secsLeft % 60;
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
  // Logout at 30 min
  sessionTimer = setTimeout(() => {
    clearInterval(sessionCountdownInterval);
    forceLogout("Session expired. Logging out.");
  }, 30 * 60 * 1000);
}

let _lastSessionReset = 0;
function debouncedResetSession() {
  // FIX 20: No-op when no user is logged in (auth page context).
  // The event listeners are registered unconditionally on every page that loads
  // shared.js, so we must guard here rather than at the listener level.
  if (!currentUser) return;
  const now = Date.now();
  if (now - _lastSessionReset > 10000) {
    _lastSessionReset = now;
    resetSessionTimer();
  }
}
// All activity events use the same debounced handler to avoid per-event jank
["mousemove", "keydown", "click", "touchstart"].forEach((e) => {
  document.addEventListener(e, debouncedResetSession, { passive: true });
});

// ============================================================
// UTILITIES
// ============================================================
// ============================================================
// LOADING STATE HELPERS
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
// Safely encode a value for use inside a data-* attribute (HTML-attribute safe).
// Prefer data-* attributes over inline onclick strings whenever possible.
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
    const store = getStore();
    const biz = store.businesses.find((b) => b.id === currentUser.businessId);
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
// FIX 11: Use crypto.randomUUID() for collision-free IDs.
// The old Date.now() + Math.random() approach could collide under rapid successive
// calls within the same millisecond. randomUUID() is RFC 4122 compliant and
// available in all modern browsers (Chrome 92+, Firefox 95+, Safari 15.4+).
function uid() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Fallback for very old environments: keep prior approach but extend randomness
  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 9)}-${Math.random().toString(36).slice(2, 9)}`;
}

function toast(msg, type = "default") {
  const c = document.getElementById("toast-container");
  // FIX 2: Guard against missing container (defensive - every app page includes it,
  // but guard prevents a crash if called before DOM is ready or on a partial page).
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
  // SS-013: Announce to screen readers via appropriate live region
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
  // Fix 19: Support custom ok button label and style (e.g. neutral logout vs danger delete)
  return new Promise((resolve) => {
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-message").textContent = msg;
    const overlay = document.getElementById("confirm-overlay");
    overlay.classList.add("open");
    const okBtn = document.getElementById("confirm-ok-btn");
    const cancelBtn = document.getElementById("confirm-cancel-btn");
    // Apply custom label/class if provided
    okBtn.textContent =
      options && options.okLabel ? options.okLabel : "Confirm";
    okBtn.className =
      "btn " + (options && options.okClass ? options.okClass : "btn-danger");
    okBtn.style.flex = "1";
    const cleanup = () => {
      overlay.classList.remove("open");
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      // FIX 6: Remove Escape key listener on cleanup
      document.removeEventListener("keydown", escHandler);
      // Reset to defaults
      okBtn.textContent = "Confirm";
      okBtn.className = "btn btn-danger";
    };
    // FIX 6: Allow dismissing the confirm dialog with the Escape key (accessibility)
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

function togglePw(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.type = inp.type === "password" ? "text" : "password";
}

function showPage(id) {
  document
    .querySelectorAll("#auth-container > div")
    .forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
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
  read: `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  receipt: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16l3-2 3 2 3-2 3 2V4a2 2 0 0 0-2-2z"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="12" y2="15"/></svg>`,
};

// ============================================================
// AUTH STATE
// ============================================================
let currentUser = null;
// FIX 18: selectedPlan was previously declared here, leaking into all pages.
// It is only used by auth.js and is declared there instead.
let activeTab = "";

// ============================================================
// APP LAUNCH
// ============================================================
function launchApp() {
  applyScheduledUpgrades();
  // FIX 12: Prevent flash of empty/unstyled content during the synchronous
  // route-guard + render phase. Body starts invisible (set in each role HTML)
  // and is revealed here once the first render is complete.
  document.body.style.visibility = "visible";
  // auth-container only exists on auth.html; on role pages the app is always visible
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
  // Restore sidebar collapse state (per user)
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
    // Premium only – added conditionally
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

  // Add premium items conditionally
  if (currentUser.role === "admin") {
    const store = getStore();
    const biz = store.businesses.find((b) => b.id === currentUser.businessId);
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

  // Fix 16: Determine if subscription expiry badge should show
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
      const badgeLabel = st.inGrace ? "Grace" : `${st.daysLeft}d`;
      subBadgeHTML = `<span style="margin-left:auto;background:${badgeColor};color:white;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;font-family:var(--font-mono)">${badgeLabel}</span>`;
    } else if (st && !st.active) {
      subBadgeHTML = `<span style="margin-left:auto;background:var(--red);color:white;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;font-family:var(--font-mono)">!</span>`;
    }
  }

  const mainItems = items.filter(
    (i) => i.id !== "contact" && i.id !== "settings" && i.id !== "subscriptions"
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
        </div>
      `
        )
        .join("")}
      <div class="nav-section-label" style="margin-top:8px">Account</div>
      ${bottomItems
        .map(
          (item) => `
        <div class="nav-item" data-tab="${safeAttr(
          item.id
        )}" onclick="navigate('${safeAttr(item.id)}')">
  ${Icon[item.icon] || Icon.settings}
  <span class="nav-item-label">${item.label}</span>
  ${item.id === "subscriptions" ? subBadgeHTML : ""}
        </div>
      `
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
    // Notify other tabs so their sidebar collapses in sync
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
  // Warn if leaving POS with items in the cart
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
  // Restore content-area overflow when leaving POS
  const _area = document.getElementById("content-area");
  if (_area) _area.style.overflow = "";
  // Gate: check subscription still active (skip for super-admin)
  if (
    currentUser.role !== "super-admin" &&
    currentUser.businessId &&
    tab !== "subscriptions" &&
    tab !== "settings" &&
    tab !== "contact"
  ) {
    const active = enforceSubscription(currentUser.businessId);
    if (!active) {
      toast("Subscription expired. Functionality suspended.", "error");
      // Cashiers have no subscriptions tab - redirect to contact support instead
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
  // Announce new page to screen readers
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
    // Restore default click-outside-to-close behaviour
    document.getElementById("modal-overlay").onclick = closeModal;
  }
}

// ============================================================
// LOGOUT - redirect-based (multi-file architecture)
// ============================================================
function performLogout() {
  if (wsSimInterval) {
    if (typeof wsSimInterval === "object" && wsSimInterval.clear) {
      wsSimInterval.clear();
    } else {
      clearInterval(wsSimInterval);
    }
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

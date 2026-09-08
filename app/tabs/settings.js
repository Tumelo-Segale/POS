// ============================================================
// tabs/settings.js - shared tab module extracted from shared.js
// Loaded by whichever site (admin/cashier) uses this tab.
// Depends on shared.js (must be loaded first).
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

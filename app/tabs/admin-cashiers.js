// ============================================================
// admin-cashiers.js - tab module extracted from admin.js
// Depends on shared.js (loaded first).
// ============================================================

function renderCashiers(area) {
  const store = getStore();
  const cashiers = store.users.filter(
    (u) => u.businessId === currentUser.businessId && u.role === "cashier"
  );
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const limits = PLAN_LIMITS[biz?.plan] || PLAN_LIMITS.starter;
  const locations = store.locations.filter(
    (l) => l.businessId === currentUser.businessId
  );
  area.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">Cashiers <span style="font-size:13px;color:var(--gray-400);font-weight:400">${
        cashiers.length
      }${
    limits.cashiers !== Infinity ? " / " + limits.cashiers : ""
  }</span></h2>
      ${
        limits.cashiers !== Infinity && cashiers.length >= limits.cashiers
          ? `<button class="btn btn-primary" disabled title="Cashier limit reached" style="opacity:.5;cursor:not-allowed">${Icon.plus} Add Cashier <span style="font-size:10px;margin-left:4px;opacity:.8">(limit reached)</span></button>`
          : `<button class="btn btn-primary" onclick="openCashierModal(null)">${Icon.plus} Add Cashier</button>`
      }
    </div>
    <div class="card"><div class="table-wrapper"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Contact</th><th>Location</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        ${
          cashiers.length === 0
            ? `<tr><td colspan="6"><div class="empty-state">No cashiers yet.</div></td></tr>`
            : cashiers
                .map((c) => {
                  const loc = locations.find((l) => l.id === c.locationId);
                  return `<tr>
                <td><strong>${sanitize(c.name)}</strong></td>
                <td class="text-muted">${sanitize(c.email)}</td>
                <td>${sanitize(c.contact || "-")}</td>
                <td>${
                  loc ? sanitize(loc.name) : '<span class="text-muted">-</span>'
                }</td>
                <td><span class="badge ${
                  c.status === "active" ? "badge-green" : "badge-red"
                }">${c.status}</span></td>
                <td><div class="td-actions">
                  <button class="btn btn-sm btn-outline" onclick="openCashierModal('${
                    c.id
                  }')">${Icon.edit}</button>
                  <button class="btn btn-sm btn-outline" onclick="toggleCashierStatus('${
                    c.id
                  }')">${
                    c.status === "active" ? "Suspend" : "Activate"
                  }</button>
                  <button class="btn btn-sm btn-danger-outline" onclick="deleteCashier('${
                    c.id
                  }')">${Icon.trash}</button>
                </div></td>
              </tr>`;
                })
                .join("")
        }
      </tbody>
    </table></div></div>`;
}

function openCashierModal(cashierId) {
  const store = getStore();
  const c = cashierId ? store.users.find((u) => u.id === cashierId) : null;
  const locations = store.locations.filter(
    (l) => l.businessId === currentUser.businessId
  );
  const locOptions =
    `<option value="">- No Location -</option>` +
    locations
      .map(
        (l) =>
          `<option value="${l.id}" ${
            c?.locationId === l.id ? "selected" : ""
          }>${sanitize(l.name)}</option>`
      )
      .join("");
  openModal(
    c ? "Edit Cashier" : "Add Cashier",
    `
    <div class="form-group"><label class="form-label">Full Name</label><input id="m-c-name" class="form-input" value="${
      c ? sanitize(c.name) : ""
    }" placeholder="John Doe"/></div>
    <div class="form-group"><label class="form-label">Email Address</label><input id="m-c-email" class="form-input" type="email" value="${
      c ? c.email : ""
    }" placeholder="john@shop.com"/></div>
    <div class="form-group"><label class="form-label">Contact Number</label><input id="m-c-contact" class="form-input" value="${
      c ? c.contact || "" : ""
    }" placeholder="012 345 6789"/></div>
    <div class="form-group"><label class="form-label">${
      c ? "New Password" : "Password"
    } ${c ? "" : '<span style="color:var(--red)">*</span>'}</label>
      <div class="pw-wrap"><input id="m-c-pass" class="form-input" type="password" placeholder="${
        c ? "Leave blank to keep current" : "••••••••"
      }"/>
      <button class="pw-toggle" type="button" onclick="togglePw('m-c-pass')"><svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></div>
    </div>
    ${
      locations.length > 0
        ? `<div class="form-group"><label class="form-label">Assign Location</label><select id="m-c-loc" class="form-select">${locOptions}</select></div>`
        : ""
    }
    <button class="btn btn-primary btn-full btn-lg" onclick="saveCashier('${
      cashierId || null
    }')">${c ? "Update Cashier" : "Add Cashier"}</button>
  `
  );
}

function saveCashier(cashierId) {
  if (cashierId === "null" || cashierId === "" || cashierId === undefined)
    cashierId = null;
  const name = document.getElementById("m-c-name").value.trim();
  const email = document.getElementById("m-c-email").value.trim().toLowerCase();
  const contact = document.getElementById("m-c-contact").value.trim();
  const password = document.getElementById("m-c-pass").value;
  const locEl = document.getElementById("m-c-loc");
  const locationId = locEl ? locEl.value : "";
  if (!name || !email) {
    toast("Name and email are required", "error");
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    toast("Please enter a valid email address", "error");
    return;
  }
  const store = getStore();
  if (cashierId) {
    const existingCashier = store.users.find((u) => u.id === cashierId);
    if (!existingCashier) {
      toast("Cashier not found", "error");
      return;
    }
    const dup = store.users.find(
      (u) => u.email.toLowerCase() === email && u.id !== cashierId
    );
    if (dup) {
      toast("A user with this email already exists", "error");
      return;
    }
    const updatedPass = password ? password : existingCashier.password;
    const prevLocation = existingCashier.locationId || "";
    const locationChanged = locationId !== prevLocation;
    updateStore((d) => ({
      ...d,
      users: d.users.map((u) =>
        u.id === cashierId
          ? {
              ...u,
              name: sanitize(name),
              email,
              contact,
              password: updatedPass,
              locationId,
              ...(locationChanged && locationId
                ? { locationAssignedAt: new Date().toISOString() }
                : locationChanged && !locationId
                ? { locationAssignedAt: null }
                : {}),
            }
          : u
      ),
    }));
    addAuditLog("Updated cashier", name);
    toast("Cashier updated", "success");
  } else {
    if (!password) {
      toast("Password is required for new cashiers", "error");
      return;
    }
    const biz = store.businesses.find((b) => b.id === currentUser.businessId);
    const limits = PLAN_LIMITS[biz?.plan] || PLAN_LIMITS.starter;
    const cashiers = store.users.filter(
      (u) => u.businessId === currentUser.businessId && u.role === "cashier"
    );
    if (limits.cashiers !== Infinity && cashiers.length >= limits.cashiers) {
      toast(
        `${biz?.plan} plan limit: ${limits.cashiers} cashier(s). Upgrade to add more.`,
        "error"
      );
      return;
    }
    if (store.users.find((u) => u.email.toLowerCase() === email)) {
      toast("A user with this email already exists", "error");
      return;
    }
    updateStore((d) => ({
      ...d,
      users: [
        ...d.users,
        {
          id: `cashier-${uid()}`,
          businessId: currentUser.businessId,
          name: sanitize(name),
          email,
          contact,
          password,
          role: "cashier",
          status: "active",
          locationId,
          ...(locationId
            ? { locationAssignedAt: new Date().toISOString() }
            : {}),
        },
      ],
    }));
    addAuditLog("Added cashier", name);
    toast("Cashier added", "success");
  }
  closeModal();
  renderCashiers(document.getElementById("content-area"));
}

function toggleCashierStatus(id) {
  const store = getStore();
  const cashier = store.users.find((u) => u.id === id);
  updateStore((d) => ({
    ...d,
    users: d.users.map((u) =>
      u.id === id
        ? { ...u, status: u.status === "active" ? "suspended" : "active" }
        : u
    ),
  }));
  addAuditLog("Changed cashier status", cashier?.name);
  renderCashiers(document.getElementById("content-area"));
  toast("Cashier status updated");
}

function deleteCashier(id) {
  const store = getStore();
  const cashier = store.users.find((u) => u.id === id);
  const txnCount = store.transactions.filter((t) => t.cashierId === id).length;
  const warningMsg =
    txnCount > 0
      ? `Delete cashier "${cashier?.name}"? They have ${txnCount} transaction(s) on record. These will be preserved but the cashier's profile will be removed. This cannot be undone.`
      : `Delete cashier "${cashier?.name}"? This cannot be undone.`;
  confirm2("Delete Cashier", warningMsg).then((ok) => {
    if (!ok) return;
    updateStore((d) => ({ ...d, users: d.users.filter((u) => u.id !== id) }));
    addAuditLog("Deleted cashier", cashier?.name);
    renderCashiers(document.getElementById("content-area"));
    toast("Cashier deleted");
  });
}

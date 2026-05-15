// ============================================================
// admin.js - SaleStation
// Admin-only views: dashboard, cashiers, locations, audit logs,
// transactions, receipts, subscriptions.
// All shared functions (POS, inventory, contact, settings) live
// in shared.js so cashier.html can use them without duplication.
// ============================================================

// ============================================================
// ADMIN DASHBOARD
// ============================================================
function fmtBar(n) {
  if (!n || n === 0) return "";
  const sym = getCurrencySymbol();
  if (n >= 1000000)
    return sym + (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return sym + (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return sym + Math.round(n);
}

function computeWeekData(txns) {
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const now = new Date();
  const todayDow = now.getDay();
  const bucket = {};
  txns.forEach((t) => {
    if (!t.createdAt || !t.amount) return;
    const txDs = localDateStr(new Date(t.createdAt));
    bucket[txDs] = (bucket[txDs] || 0) + t.amount;
  });
  return DAY_NAMES.map((dayName, i) => {
    const slotDate = new Date(now);
    slotDate.setHours(0, 0, 0, 0);
    slotDate.setDate(slotDate.getDate() - (todayDow - i));
    const ds = localDateStr(slotDate);
    const isFuture = i > todayDow;
    const isToday = i === todayDow;
    const dateLabel =
      String(slotDate.getDate()).padStart(2, "0") +
      "/" +
      String(slotDate.getMonth() + 1).padStart(2, "0");
    const amount = isFuture ? 0 : bucket[ds] || 0;
    return { dayName, dateLabel, ds, amount, isFuture, isToday };
  });
}

function updateDashboardChart() {
  if (!currentUser || currentUser.role !== "admin") return;
  if (activeTab !== "dashboard") return;
  const store = getStore();
  const bizId = currentUser.businessId;
  const txns = store.transactions.filter((t) => t.businessId === bizId);
  const now = new Date();
  const today = localDateStr(now);
  const { todaySales, monthlySales, yearlySales } = txns.reduce(
    (acc, t) => {
      const d = new Date(t.createdAt);
      const amt = t.amount || 0;
      if (localDateStr(d) === today) acc.todaySales += amt;
      if (
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
      )
        acc.monthlySales += amt;
      if (d.getFullYear() === now.getFullYear()) acc.yearlySales += amt;
      return acc;
    },
    { todaySales: 0, monthlySales: 0, yearlySales: 0 }
  );
  const $ = (id) => document.getElementById(id);
  if ($("dash-today")) $("dash-today").textContent = formatCurrency(todaySales);
  if ($("dash-monthly"))
    $("dash-monthly").textContent = formatCurrency(monthlySales);
  if ($("dash-yearly"))
    $("dash-yearly").textContent = formatCurrency(yearlySales);
  if ($("dash-count")) $("dash-count").textContent = txns.length;
  const weekData = computeWeekData(txns);
  const maxAmount = Math.max(...weekData.map((d) => d.amount), 1);
  // Highest bar among non-future, non-today slots (for distinct colour)
  const highestPastAmount = Math.max(
    ...weekData.filter((d) => !d.isFuture && !d.isToday).map((d) => d.amount),
    0
  );
  weekData.forEach((d, i) => {
    const barEl = $(`dash-bar-${i}`);
    const valEl = $(`dash-bar-val-${i}`);
    const groupEl = barEl?.closest(".bar-group");
    if (!barEl || !valEl) return;
    if (d.isFuture) {
      barEl.style.height = "2px";
      barEl.style.background = "var(--gray-100)";
      valEl.textContent = "";
      if (groupEl) groupEl.style.opacity = "0.3";
      return;
    }
    const h = d.amount > 0 ? Math.max((d.amount / maxAmount) * 120, 4) : 2;
    barEl.style.height = h + "px";
    barEl.style.background = d.isToday
      ? "var(--black)"
      : d.amount === highestPastAmount && d.amount > 0
      ? "var(--gray-600)"
      : "var(--gray-300)";
    valEl.textContent = fmtBar(d.amount);
    if (groupEl) groupEl.style.opacity = "1";
  });
}

function renderAdminDashboard(area) {
  const store = getStore();
  const bizId = currentUser.businessId;
  const txns = store.transactions.filter((t) => t.businessId === bizId);
  const now = new Date();
  const today = localDateStr(now);
  const { todaySales, monthlySales, yearlySales } = txns.reduce(
    (acc, t) => {
      const d = new Date(t.createdAt);
      const amt = t.amount || 0;
      if (localDateStr(d) === today) acc.todaySales += amt;
      if (
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
      )
        acc.monthlySales += amt;
      if (d.getFullYear() === now.getFullYear()) acc.yearlySales += amt;
      return acc;
    },
    { todaySales: 0, monthlySales: 0, yearlySales: 0 }
  );
  const weekData = computeWeekData(txns);
  const maxAmount = Math.max(...weekData.map((d) => d.amount), 1);
  const highestPastAmount = Math.max(
    ...weekData.filter((d) => !d.isFuture && !d.isToday).map((d) => d.amount),
    0
  );
  const st = getSubStatus(bizId);
  const expiringSoon =
    st &&
    st.active &&
    !st.inGrace &&
    typeof st.daysLeft === "number" &&
    st.daysLeft <= 7 &&
    st.daysLeft > 0;
  const subBanner = st?.inGrace
    ? `<div class="alert alert-orange mb-20">${Icon.alert} Grace period: <strong>${st.graceLeft} day(s)</strong> remaining.</div>`
    : st?.status === "cancelled" && st?.active && st.daysLeft <= 3
    ? `<div class="alert alert-red mb-20">${Icon.alert} Your cancelled subscription ends in <strong>${st.daysLeft} day(s)</strong>. Renew now to avoid losing access.</div>`
    : expiringSoon
    ? `<div class="alert alert-accent mb-20">${Icon.alert} Subscription expires in <strong>${st.daysLeft} day(s)</strong>. <a href="#" onclick="navigate('subscriptions');return false;" style="color:inherit;font-weight:700">Renew now</a> to avoid interruption.</div>`
    : "";
  const biz = store.businesses.find((b) => b.id === bizId);
  const isPremium = biz?.plan === "premium";
  let locationBreakdownHTML = "";
  if (isPremium) {
    const locations = store.locations.filter((l) => l.businessId === bizId);
    if (locations.length > 1) {
      const weekStart = new Date(weekData[0].ds + "T00:00:00");
      const weekTxns = txns.filter((t) => new Date(t.createdAt) >= weekStart);
      const cashiers = store.users.filter(
        (u) => u.businessId === bizId && u.role === "cashier"
      );
      const locTotals = locations.map((loc) => {
        const locCashiers = cashiers.filter((c) => c.locationId === loc.id);
        const locTotal = weekTxns
          .filter((t) => {
            const c = locCashiers.find((c) => c.id === t.cashierId);
            if (!c) return false;
            if (
              c.locationAssignedAt &&
              new Date(t.createdAt) < new Date(c.locationAssignedAt)
            )
              return false;
            return true;
          })
          .reduce((a, t) => a + (t.amount || 0), 0);
        return { name: loc.name, total: locTotal };
      });
      const unassignedTotal = weekTxns
        .filter((t) => {
          const c = cashiers.find((c) => c.id === t.cashierId);
          return !c || !c.locationId;
        })
        .reduce((a, t) => a + (t.amount || 0), 0);
      if (unassignedTotal > 0)
        locTotals.push({ name: "Unassigned", total: unassignedTotal });
      const locMax = Math.max(...locTotals.map((l) => l.total), 1);
      locationBreakdownHTML = `<div class="card" style="margin-top:20px"><div class="card-header"><span class="card-title">Weekly Revenue by Location</span><span style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono)">This week</span></div><div class="card-body">
        ${locTotals
          .map(
            (loc) =>
              `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span style="font-weight:500">${sanitize(
                loc.name
              )}</span><span class="text-mono">${formatCurrency(
                loc.total
              )}</span></div><div style="background:var(--gray-100);border-radius:4px;height:8px;overflow:hidden"><div style="background:var(--black);height:100%;width:${Math.round(
                (loc.total / locMax) * 100
              )}%;border-radius:4px;transition:width .4s"></div></div></div>`
          )
          .join("")}
      </div></div>`;
    }
  }
  area.innerHTML = `
    ${subBanner}
    <div class="stats-grid stats-grid-4 mb-20">
      <div class="stat-card"><div class="stat-icon">${
        Icon.cart
      }</div><div><div class="stat-label">Today's Sales</div><div class="stat-value" id="dash-today">${formatCurrency(
    todaySales
  )}</div></div></div>
      <div class="stat-card"><div class="stat-icon">${
        Icon.credit
      }</div><div><div class="stat-label">Monthly Sales</div><div class="stat-value" id="dash-monthly">${formatCurrency(
    monthlySales
  )}</div></div></div>
      <div class="stat-card"><div class="stat-icon">${
        Icon.dashboard
      }</div><div><div class="stat-label">Yearly Sales</div><div class="stat-value" id="dash-yearly">${formatCurrency(
    yearlySales
  )}</div></div></div>
      <div class="stat-card"><div class="stat-icon">${
        Icon.history
      }</div><div><div class="stat-label">Total Transactions</div><div class="stat-value" id="dash-count">${
    txns.length
  }</div></div></div>
    </div>
    <div class="card">
      <div class="card-header"><div><span class="card-title">Weekly Sales Overview</span></div><span id="dash-week-label" style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono)"></span></div>
      <div class="card-body">
        <div class="bar-chart" id="dash-bar-chart">
          ${weekData
            .map(
              (d, i) => `
            <div class="bar-group" style="opacity:${d.isFuture ? 0.3 : 1}">
              <div class="bar-val" id="dash-bar-val-${i}" style="font-size:9px;height:16px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:2px">${fmtBar(
                d.amount
              )}</div>
              <div class="bar" id="dash-bar-${i}" style="height:${
                d.isFuture
                  ? 2
                  : d.amount > 0
                  ? Math.max((d.amount / maxAmount) * 120, 4)
                  : 2
              }px;background:${
                d.isToday
                  ? "var(--black)"
                  : d.isFuture
                  ? "var(--gray-100)"
                  : d.amount === highestPastAmount && d.amount > 0
                  ? "var(--gray-600)"
                  : "var(--gray-300)"
              };transition:height .45s cubic-bezier(.4,0,.2,1)"></div>
              <div class="bar-label" style="line-height:1.4;padding-top:4px">
                <div style="font-weight:${d.isToday ? "700" : "400"};color:${
                d.isToday ? "var(--black)" : "inherit"
              }">${d.dayName}</div>
                <div style="font-size:8px;color:var(--gray-300)">${
                  d.dateLabel
                }</div>
              </div>
            </div>`
            )
            .join("")}
        </div>
      </div>
    </div>
    ${locationBreakdownHTML}`;

  // Fix #30: week label year uses SATURDAY's year so year-spanning weeks are correct
  const sunDate = weekData[0];
  const satDate = weekData[6];
  const fmt = (ds) => {
    const [, m, day] = ds.split("-");
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${parseInt(day)} ${months[parseInt(m) - 1]}`;
  };
  const weekLabel = document.getElementById("dash-week-label");
  if (weekLabel)
    weekLabel.textContent = `${fmt(sunDate.ds)} – ${fmt(
      satDate.ds
    )} ${satDate.ds.slice(0, 4)}`;
  scheduleWeekReset();
}

let _weekResetTimer = null;
function scheduleWeekReset() {
  if (_weekResetTimer) clearTimeout(_weekResetTimer);
  const now = new Date();
  const nextSunday = new Date(now);
  nextSunday.setDate(now.getDate() + ((7 - now.getDay()) % 7) || 7);
  nextSunday.setHours(0, 0, 0, 0);
  _weekResetTimer = setTimeout(() => {
    if (
      activeTab === "dashboard" &&
      currentUser &&
      currentUser.role === "admin"
    )
      renderAdminDashboard(document.getElementById("content-area"));
  }, nextSunday - now);
}

// ============================================================
// CASHIERS
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

// ============================================================
// MULTI-STORE LOCATIONS (Premium)
// ============================================================
function renderLocations(area) {
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  if (biz?.plan !== "premium") {
    area.innerHTML = `<div class="page-header"><h2 class="page-title">Multi-Store</h2></div><div class="alert alert-blue">${Icon.alert} Multi-Store is available on the Premium plan only.</div>`;
    return;
  }
  const locations = store.locations.filter(
    (l) => l.businessId === currentUser.businessId
  );
  area.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">Locations / Branches <span style="font-size:13px;color:var(--gray-400);font-weight:400">${
        locations.length
      } / 3</span></h2>
      ${
        locations.length < 3
          ? `<button class="btn btn-primary" onclick="openLocationModal(null)">${Icon.plus} Add Location</button>`
          : ""
      }
    </div>
    <div class="card"><div class="table-wrapper"><table>
      <thead><tr><th>Location Name</th><th>Address</th><th>Cashiers Assigned</th><th>Actions</th></tr></thead>
      <tbody>
        ${
          locations.length === 0
            ? `<tr><td colspan="4"><div class="empty-state">No locations yet.</div></td></tr>`
            : locations
                .map((l) => {
                  const cashiers = store.users.filter(
                    (u) =>
                      u.businessId === currentUser.businessId &&
                      u.role === "cashier" &&
                      u.locationId === l.id
                  );
                  return `<tr><td><strong>${sanitize(
                    l.name
                  )}</strong></td><td class="text-muted">${sanitize(
                    l.address || "-"
                  )}</td><td>${cashiers.length}</td>
                <td><div class="td-actions">
                  <button class="btn btn-sm btn-outline" onclick="openLocationModal('${
                    l.id
                  }')">${Icon.edit}</button>
                  <button class="btn btn-sm btn-danger-outline" onclick="deleteLocation('${
                    l.id
                  }')">${Icon.trash}</button>
                </div></td></tr>`;
                })
                .join("")
        }
      </tbody>
    </table></div></div>
    <div style="margin-top:20px"><div class="card"><div class="card-header"><span class="card-title">Inventory & Revenue by Location</span></div><div class="card-body">
      ${
        locations.length === 0
          ? '<div class="empty-state">Add locations to see centralized reporting</div>'
          : locations
              .map((l) => {
                const cashiers = store.users.filter(
                  (u) =>
                    u.businessId === currentUser.businessId &&
                    u.role === "cashier" &&
                    u.locationId === l.id
                );
                const txns = store.transactions.filter((t) => {
                  if (t.businessId !== currentUser.businessId) return false;
                  const c = cashiers.find((c) => c.id === t.cashierId);
                  if (!c) return false;
                  if (
                    c.locationAssignedAt &&
                    new Date(t.createdAt) < new Date(c.locationAssignedAt)
                  )
                    return false;
                  return true;
                });
                const total = txns.reduce((a, t) => a + t.amount, 0);
                const activeLocItems = store.items.filter(
                  (i) =>
                    i.businessId === currentUser.businessId &&
                    i.locationId === l.id &&
                    i.status === "active"
                ).length;
                return `<div style="padding:12px;border:1px solid var(--gray-100);border-radius:var(--radius);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
              <div><strong>${sanitize(
                l.name
              )}</strong><div class="text-muted text-sm">${
                  cashiers.length
                } cashier(s) · ${activeLocItems} item(s) · ${
                  txns.length
                } transactions</div></div>
              <div class="text-mono font-bold">${formatCurrency(total)}</div>
            </div>`;
              })
              .join("")
      }
    </div></div></div>`;
}

function openLocationModal(locId) {
  const store = getStore();
  const loc = locId ? store.locations.find((l) => l.id === locId) : null;
  openModal(
    loc ? "Edit Location" : "Add Location",
    `
    <div class="form-group"><label class="form-label">Location Name</label><input id="m-loc-name" class="form-input" value="${
      loc ? sanitize(loc.name) : ""
    }" placeholder="e.g. Main Branch"/></div>
    <div class="form-group"><label class="form-label">Address</label><input id="m-loc-addr" class="form-input" value="${
      loc ? sanitize(loc.address || "") : ""
    }" placeholder="123 Main St, Pretoria"/></div>
    <button class="btn btn-primary btn-full btn-lg" onclick="saveLocation('${
      locId || ""
    }')">${loc ? "Update Location" : "Add Location"}</button>
  `
  );
}

function saveLocation(locId) {
  const name = document.getElementById("m-loc-name").value.trim();
  const address = document.getElementById("m-loc-addr").value.trim();
  if (!name) {
    toast("Location name is required", "error");
    return;
  }
  const store = getStore();
  if (locId) {
    updateStore((d) => ({
      ...d,
      locations: d.locations.map((l) =>
        l.id === locId
          ? { ...l, name: sanitize(name), address: sanitize(address) }
          : l
      ),
    }));
    toast("Location updated", "success");
  } else {
    const existing = store.locations.filter(
      (l) => l.businessId === currentUser.businessId
    );
    if (existing.length >= 3) {
      toast("Maximum 3 locations allowed on Premium.", "error");
      return;
    }
    updateStore((d) => ({
      ...d,
      locations: [
        ...d.locations,
        {
          id: `loc-${uid()}`,
          businessId: currentUser.businessId,
          name: sanitize(name),
          address: sanitize(address),
        },
      ],
    }));
    toast("Location added", "success");
  }
  closeModal();
  renderLocations(document.getElementById("content-area"));
}

function deleteLocation(id) {
  const store = getStore();
  const loc = store.locations.find((l) => l.id === id);
  confirm2(
    "Delete Location",
    `Delete location "${loc?.name}"? Cashiers assigned here will be unassigned.`
  ).then((ok) => {
    if (!ok) return;
    updateStore((d) => ({
      ...d,
      locations: d.locations.filter((l) => l.id !== id),
      users: d.users.map((u) =>
        u.locationId === id ? { ...u, locationId: "" } : u
      ),
    }));
    renderLocations(document.getElementById("content-area"));
    toast("Location deleted");
  });
}

// ============================================================
// AUDIT LOGS
// ============================================================
function renderAuditLogs(area) {
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  if (biz?.plan !== "premium") {
    area.innerHTML = `<div class="page-header"><h2 class="page-title">Audit Logs</h2></div><div class="alert alert-blue">${Icon.alert} Audit Logs are available on the Premium plan only.</div>`;
    return;
  }
  const logs = store.auditLogs.filter(
    (l) => l.businessId === currentUser.businessId
  );
  area.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">Audit Logs</h2>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <div class="search-box"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--gray-400)"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input id="audit-search" type="text" placeholder="Search logs..." style="padding-left:30px;height:34px" oninput="filterAuditLogs()"/></div>
        <button class="btn btn-outline" onclick="exportAuditLogs()">${
          Icon.download
        } Export CSV</button>
      </div>
    </div>
    <div class="card"><div class="table-wrapper"><table>
      <thead><tr><th>Date & Time</th><th>User</th><th>Role</th><th>Action</th><th>Target</th></tr></thead>
      <tbody id="audit-tbody">${renderAuditRows(logs)}</tbody>
    </table></div></div>`;
}

function renderAuditRows(logs) {
  if (logs.length === 0)
    return `<tr><td colspan="5"><div class="empty-state">No audit logs found.</div></td></tr>`;
  return [...logs]
    .reverse()
    .map(
      (l) => `<tr>
    <td class="text-muted">${formatDate(l.ts)}</td>
    <td><strong>${sanitize(l.userName)}</strong></td>
    <td><span class="badge badge-gray">${l.role}</span></td>
    <td>${sanitize(l.action)}</td>
    <td class="text-muted">${sanitize(l.target || "-")}</td>
  </tr>`
    )
    .join("");
}

function filterAuditLogs() {
  const q = (
    document.getElementById("audit-search")?.value || ""
  ).toLowerCase();
  const store = getStore();
  const logs = store.auditLogs.filter(
    (l) => l.businessId === currentUser.businessId
  );
  const filtered = q
    ? logs.filter(
        (l) =>
          (l.userName || "").toLowerCase().includes(q) ||
          (l.action || "").toLowerCase().includes(q) ||
          (l.target || "").toLowerCase().includes(q) ||
          (l.role || "").toLowerCase().includes(q)
      )
    : logs;
  const tbody = document.getElementById("audit-tbody");
  if (tbody) tbody.innerHTML = renderAuditRows(filtered);
}

function exportAuditLogs() {
  const store = getStore();
  const logs = store.auditLogs.filter(
    (l) => l.businessId === currentUser.businessId
  );
  if (logs.length === 0) {
    toast("No audit logs to export.", "error");
    return;
  }
  const rows = [["Date & Time", "User", "Role", "Action", "Target"]];
  [...logs]
    .reverse()
    .forEach((l) =>
      rows.push([
        formatDate(l.ts),
        l.userName,
        l.role,
        l.action,
        l.target || "",
      ])
    );
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const minWidths = [20, 18, 12, 30, 30];
  ws["!cols"] = rows[0].map((_, ci) => ({
    wch: Math.min(
      Math.max(
        Math.max(...rows.map((r) => String(r[ci] || "").length)) + 4,
        minWidths[ci] || 14
      ),
      80
    ),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Audit Logs");
  XLSX.writeFile(
    wb,
    `audit-logs-${new Date().toISOString().slice(0, 10)}.xlsx`
  );
  toast("Audit logs exported.", "success");
}

// ============================================================
// ITEM MANAGEMENT (admin-only write operations)
// ============================================================
function openItemModal(itemId) {
  const store = getStore();
  const item = itemId ? store.items.find((i) => i.id === itemId) : null;
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const isRestaurant = biz?.businessType === "restaurant";
  const locations = store.locations.filter(
    (l) => l.businessId === currentUser.businessId
  );
  const locOptions =
    `<option value="">Shared (all locations)</option>` +
    locations
      .map(
        (l) =>
          `<option value="${l.id}" ${
            item?.locationId === l.id ? "selected" : ""
          }>${sanitize(l.name)}</option>`
      )
      .join("");
  const catOptions = ["meals", "drinks", "others"]
    .map(
      (c) =>
        `<option value="${c}" ${item?.category === c ? "selected" : ""}>${
          c.charAt(0).toUpperCase() + c.slice(1)
        }</option>`
    )
    .join("");
  openModal(
    item ? "Edit Item" : "Add Item",
    `
    <div class="form-group"><label class="form-label">Item Name <span class="required-star">*</span></label><input id="m-i-name" class="form-input" value="${
      item ? sanitize(item.name) : ""
    }" placeholder="e.g. Cappuccino"/></div>
    <div class="form-group"><label class="form-label">Price (${getCurrencySymbol()}) <span class="required-star">*</span></label><input id="m-i-price" class="form-input" type="number" min="0" step="0.01" value="${
      item ? item.price : ""
    }"/></div>
    ${
      isRestaurant
        ? `<div class="form-group"><label class="form-label">Category</label><select id="m-i-cat" class="form-select">${catOptions}</select></div>`
        : ""
    }
    <div class="form-group"><label class="form-label">Stock <span style="font-size:11px;color:var(--gray-400)">(leave blank = unlimited)</span></label><input id="m-i-stock" class="form-input" type="number" min="0" step="1" value="${
      item && item.stock !== null && item.stock !== undefined ? item.stock : ""
    }"/></div>
    ${
      locations.length > 0
        ? `<div class="form-group"><label class="form-label">Location</label><select id="m-i-loc" class="form-select">${locOptions}</select></div>`
        : ""
    }
    <button class="btn btn-primary btn-full btn-lg" onclick="saveItem('${
      itemId || null
    }')">${item ? "Update Item" : "Add Item"}</button>
  `
  );
}

function toggleStockField(val) {
  const stockInput = document.getElementById("m-i-stock");
  if (stockInput) stockInput.disabled = val === "unlimited";
}

function saveItem(itemId) {
  if (itemId === "null" || itemId === "" || itemId === undefined) itemId = null;
  const name = document.getElementById("m-i-name").value.trim();
  const price = parseFloat(document.getElementById("m-i-price").value);
  const catEl = document.getElementById("m-i-cat");
  const category = catEl ? catEl.value : "others";
  const stockRaw = document.getElementById("m-i-stock")?.value.trim();
  const stock = stockRaw === "" ? null : parseInt(stockRaw, 10);
  const locEl = document.getElementById("m-i-loc");
  const locationId = locEl ? locEl.value : "";
  if (!name) {
    toast("Item name is required", "error");
    return;
  }
  if (isNaN(price) || price < 0) {
    toast("Please enter a valid price", "error");
    return;
  }
  const store = getStore();
  if (!itemId) {
    const biz = store.businesses.find((b) => b.id === currentUser.businessId);
    const limits = PLAN_LIMITS[biz?.plan] || PLAN_LIMITS.starter;
    const activeItems = store.items.filter(
      (i) => i.businessId === currentUser.businessId && i.status === "active"
    ).length;
    if (limits.items !== Infinity && activeItems >= limits.items) {
      toast(
        `${biz?.plan} plan limit: ${limits.items} active items. Deactivate an item or upgrade to add more.`,
        "error"
      );
      return;
    }
    updateStore((d) => ({
      ...d,
      items: [
        ...d.items,
        {
          id: `item-${uid()}`,
          businessId: currentUser.businessId,
          name: sanitize(name),
          price,
          category,
          stock: isNaN(stock) ? null : stock,
          locationId,
          status: "active",
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    addAuditLog("Added item", name);
    toast("Item added", "success");
  } else {
    updateStore((d) => ({
      ...d,
      items: d.items.map((i) =>
        i.id === itemId
          ? {
              ...i,
              name: sanitize(name),
              price,
              category,
              stock: isNaN(stock) ? null : stock,
              locationId,
            }
          : i
      ),
    }));
    addAuditLog("Updated item", name);
    toast("Item updated", "success");
  }
  closeModal();
  renderItems(document.getElementById("content-area"));
}

function toggleItemStatus(id) {
  const store = getStore();
  const item = store.items.find((i) => i.id === id);
  if (!item) return;
  if (item.status === "inactive") {
    const biz = store.businesses.find((b) => b.id === currentUser.businessId);
    const limits = PLAN_LIMITS[biz?.plan] || PLAN_LIMITS.starter;
    const activeItems = store.items.filter(
      (i) => i.businessId === currentUser.businessId && i.status === "active"
    ).length;
    if (limits.items !== Infinity && activeItems >= limits.items) {
      toast(
        `Can't activate: ${biz?.plan} plan limit of ${limits.items} active items reached.`,
        "error"
      );
      return;
    }
  }
  updateStore((d) => ({
    ...d,
    items: d.items.map((i) =>
      i.id === id
        ? { ...i, status: i.status === "active" ? "inactive" : "active" }
        : i
    ),
  }));
  addAuditLog("Toggled item status", item.name);
  renderItems(document.getElementById("content-area"));
}

function deleteItem(id) {
  const store = getStore();
  const item = store.items.find((i) => i.id === id);
  confirm2(
    "Delete Item",
    `Delete "${item?.name}"? This cannot be undone.`
  ).then((ok) => {
    if (!ok) return;
    updateStore((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) }));
    addAuditLog("Deleted item", item?.name);
    renderItems(document.getElementById("content-area"));
    toast("Item deleted");
  });
}

// ============================================================
// TRANSACTIONS
// ============================================================
let txnFilterPeriod = "today";

function renderTransactions(area) {
  const store = getStore();
  const allTxns = store.transactions.filter(
    (t) => t.businessId === currentUser.businessId
  );
  const now = new Date();
  const today = localDateStr(now);
  const filtered = allTxns.filter((t) => {
    const d = new Date(t.createdAt);
    if (txnFilterPeriod === "today") return localDateStr(d) === today;
    if (txnFilterPeriod === "week") {
      // Fix #31: "week" filter in Transactions uses rolling 7 days, matching the
      // downloadStatement("weekly") definition for consistency.
      const w = new Date(now);
      w.setDate(now.getDate() - 6);
      w.setHours(0, 0, 0, 0);
      return d >= w;
    }
    if (txnFilterPeriod === "month")
      return (
        d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      );
    return true;
  });
  const periodLabels = {
    today: "Today",
    week: "Last 7 Days",
    month: "This Month",
    all: "All Time",
  };
  area.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">Transactions</h2>
      <button class="btn btn-outline" onclick="openStatementsModal()">${
        Icon.download
      } Download Statement</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
      ${["today", "week", "month", "all"]
        .map(
          (p) =>
            `<button class="btn btn-sm ${
              txnFilterPeriod === p ? "btn-primary" : "btn-outline"
            }" onclick="setTxnFilter('${p}')">${periodLabels[p]}</button>`
        )
        .join("")}
    </div>
    <div class="card"><div class="table-wrapper"><table>
      <thead><tr><th>Date & Time</th><th>Receipt</th><th>Cashier</th><th>Amount</th><th>Type</th></tr></thead>
      <tbody>
        ${
          filtered.length === 0
            ? `<tr><td colspan="5"><div class="empty-state">No transactions for ${periodLabels[
                txnFilterPeriod
              ].toLowerCase()}</div></td></tr>`
            : [...filtered]
                .reverse()
                .map(
                  (t) => `<tr>
              <td class="text-muted">${formatDate(t.createdAt)}</td>
              <td><span class="text-mono" style="font-size:11px;color:var(--gray-500)">${
                t.receiptId || "-"
              }</span></td>
              <td>${sanitize(t.cashierName || "-")}</td>
              <td><strong class="text-mono">${formatCurrency(
                t.amount
              )}</strong></td>
              <td><span class="badge ${
                t.type === "cash" ? "badge-green" : "badge-blue"
              }">${t.type}</span></td>
            </tr>`
                )
                .join("")
        }
      </tbody>
    </table></div></div>`;
}

function setTxnFilter(period) {
  txnFilterPeriod = period;
  renderTransactions(document.getElementById("content-area"));
}

// ============================================================
// RECEIPTS
// ============================================================
let receiptSearch = "";

function renderReceipts(area) {
  const store = getStore();
  const allTxns = store.transactions
    .filter((t) => t.businessId === currentUser.businessId && t.receiptId)
    .slice()
    .reverse();
  area.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">Receipts</h2>
      <div class="search-box"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--gray-400)"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input id="receipt-search" type="text" placeholder="Search receipt ID or cashier..." style="padding-left:30px;height:34px" oninput="filterReceipts()" value="${sanitize(
        receiptSearch
      )}"/></div>
    </div>
    <div class="card"><div class="table-wrapper"><table>
      <thead><tr><th>Receipt ID</th><th>Date & Time</th><th>Cashier</th><th>Items</th><th>Type</th><th>Discount</th><th>Total</th><th></th></tr></thead>
      <tbody id="receipts-tbody">${renderReceiptRows(allTxns)}</tbody>
    </table></div></div>`;
}

function renderReceiptRows(txns) {
  if (txns.length === 0)
    return `<tr><td colspan="8"><div class="empty-state">No receipts found.</div></td></tr>`;
  return txns
    .map(
      (t) => `<tr>
    <td><span class="text-mono" style="font-size:11px;font-weight:700;color:var(--black)">${
      t.receiptId
    }</span></td>
    <td class="text-muted">${formatDate(t.createdAt)}</td>
    <td><strong>${sanitize(t.cashierName || "-")}</strong></td>
    <td class="text-muted" style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${sanitize(
      t.itemsSummary || ""
    )}">${sanitize(t.itemsSummary || "-")}</td>
    <td><span class="badge ${
      t.type === "cash" ? "badge-green" : "badge-blue"
    }">${t.type}</span></td>
    <td class="text-mono" style="color:var(--green)">${
      t.discount > 0 ? "−" + formatCurrency(t.discount) : "-"
    }</td>
    <td><strong class="text-mono">${formatCurrency(t.amount)}</strong></td>
    <td><button class="btn btn-sm btn-outline" onclick="viewReceiptDetail('${
      t.id
    }')">${Icon.receipt} View</button></td>
  </tr>`
    )
    .join("");
}

function filterReceipts() {
  receiptSearch = (
    document.getElementById("receipt-search")?.value || ""
  ).toLowerCase();
  const store = getStore();
  const allTxns = store.transactions
    .filter((t) => t.businessId === currentUser.businessId && t.receiptId)
    .slice()
    .reverse();
  const filtered = receiptSearch
    ? allTxns.filter(
        (t) =>
          (t.receiptId || "").toLowerCase().includes(receiptSearch) ||
          (t.cashierName || "").toLowerCase().includes(receiptSearch) ||
          (t.itemsSummary || "").toLowerCase().includes(receiptSearch)
      )
    : allTxns;
  const tbody = document.getElementById("receipts-tbody");
  if (tbody) tbody.innerHTML = renderReceiptRows(filtered);
}

function viewReceiptDetail(txnId) {
  const store = getStore();
  const t = store.transactions.find((tx) => tx.id === txnId);
  if (!t) return;
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  openModal(
    `Receipt - ${t.receiptId}`,
    `
    <div style="font-family:var(--font-mono);padding:8px 0">
      <div style="text-align:center;margin-bottom:20px;padding-bottom:16px;border-bottom:2px dashed var(--gray-200)">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--gray-400);margin-bottom:4px">${sanitize(
          biz?.name || "SaleStation"
        )}</div>
        <div style="font-size:20px;font-weight:900;letter-spacing:.04em">${
          t.receiptId
        }</div>
        <div style="font-size:11px;color:var(--gray-500);margin-top:4px">${formatDate(
          t.createdAt
        )}</div>
      </div>
      <div style="margin-bottom:16px">
        ${(t.itemsSummary || "")
          .split(", ")
          .map((line) => {
            const match = line.match(/^(.+)\s×(\d+)$/);
            if (!match)
              return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--gray-50);font-size:13px"><span>${sanitize(
                line
              )}</span></div>`;
            return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--gray-50);font-size:13px"><span>${sanitize(
              match[1]
            )}</span><span style="color:var(--gray-500)">×${
              match[2]
            }</span></div>`;
          })
          .join("")}
      </div>
      ${
        t.discount > 0
          ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--green);padding:4px 0"><span>Discount${
              t.discountType
                ? " (" +
                  (t.discountType === "pct"
                    ? (t.discountPct || "") + "%"
                    : "flat") +
                  ")"
                : ""
            }</span><span>−${formatCurrency(t.discount)}</span></div>`
          : ""
      }
      <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:900;padding:12px 0;border-top:2px solid var(--black);margin-top:8px"><span>TOTAL</span><span>${formatCurrency(
        t.amount
      )}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--gray-500);margin-top:8px"><span>Payment</span><span style="font-weight:700;text-transform:uppercase">${
        t.type === "cash" ? "Cash" : "Card"
      }</span></div>
      ${
        t.type === "cash" && t.amountReceived
          ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--gray-500);margin-top:4px"><span>Amount Received</span><span class="text-mono">${formatCurrency(
              t.amountReceived
            )}</span></div>`
          : ""
      }
      ${
        t.type === "cash" && t.change != null
          ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--green);font-weight:700;margin-top:4px"><span>Change</span><span>${formatCurrency(
              t.change
            )}</span></div>`
          : ""
      }
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--gray-500);margin-top:4px"><span>Served by</span><span>${sanitize(
        t.cashierName || "-"
      )}</span></div>
      <div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px dashed var(--gray-200);font-size:11px;color:var(--gray-400)">Thank you for your purchase!</div>
    </div>
    <button class="btn btn-outline btn-full" style="margin-top:16px" onclick="closeModal()">Close</button>
  `
  );
}

function openStatementsModal() {
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const plan = biz?.plan || "trial";
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.trial;
  const allowed = limits.statements || [];
  openModal(
    "Download Statement",
    `
    <p style="font-size:13px;color:var(--gray-500);margin-bottom:16px">${
      allowed.length === 0
        ? "No statements available on the Trial plan."
        : plan === "starter"
        ? "Starter plan: Weekly statement only."
        : "Download your transaction statement."
    }</p>
    <button class="btn btn-outline btn-full" style="margin-bottom:8px;justify-content:flex-start;gap:10px" onclick="downloadStatement('weekly')" ${
      allowed.includes("weekly") ? "" : "disabled"
    }>${Icon.download} Weekly Statement</button>
    <button class="btn btn-outline btn-full" style="margin-bottom:8px;justify-content:flex-start;gap:10px" onclick="downloadStatement('monthly')" ${
      allowed.includes("monthly") ? "" : "disabled"
    }>${Icon.download} Monthly Statement</button>
    <button class="btn btn-outline btn-full" style="justify-content:flex-start;gap:10px" onclick="downloadStatement('yearly')" ${
      allowed.includes("yearly") ? "" : "disabled"
    }>${Icon.download} Yearly Statement</button>
    ${
      allowed.length === 0
        ? `<div style="margin-top:12px"><button class="btn btn-primary btn-full" onclick="closeModal();navigate('subscriptions')">Upgrade Plan</button></div>`
        : ""
    }
  `
  );
}

function downloadStatement(period) {
  const store = getStore();
  const txns = store.transactions.filter(
    (t) => t.businessId === currentUser.businessId
  );
  const now = new Date();
  // Fix #31: "weekly" statement uses same rolling-7-days window as the Transactions
  // "Last 7 Days" filter so the two are fully consistent.
  const filtered = txns.filter((t) => {
    const d = new Date(t.createdAt);
    if (period === "weekly") {
      const w = new Date();
      w.setDate(now.getDate() - 7);
      w.setHours(0, 0, 0, 0);
      return d >= w;
    }
    if (period === "monthly")
      return (
        d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      );
    return d.getFullYear() === now.getFullYear();
  });
  if (filtered.length === 0) {
    closeModal();
    toast("No transactions found for this period.", "error");
    return;
  }
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const currSym = biz?.currencySymbol || "R";
  const rows = [["Date", `Amount (${currSym})`, "Type", "Location", "Cashier"]];
  filtered.forEach((t) => {
    const cashier = store.users.find((u) => u.id === t.cashierId);
    const location = cashier?.locationId
      ? store.locations.find((l) => l.id === cashier.locationId)
      : null;
    rows.push([
      formatDate(t.createdAt),
      parseFloat(t.amount.toFixed(2)),
      t.type.toUpperCase(),
      location ? location.name : "-",
      cashier ? cashier.name : "-",
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 24 },
    { wch: 14 },
    { wch: 10 },
    { wch: 20 },
    { wch: 20 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Statement");
  XLSX.writeFile(
    wb,
    `SaleStation_${period}_${new Date().toISOString().split("T")[0]}.xlsx`
  );
  closeModal();
  addAuditLog(`Downloaded ${period} statement`, "");
  toast("Statement downloaded", "success");
}

// ============================================================
// SUBSCRIPTIONS
// ============================================================
function renderSubscriptions(area) {
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const sub = store.subscriptions.find(
    (s) => s.businessId === currentUser.businessId
  );
  if (!biz || !sub) {
    area.innerHTML = '<div class="empty-state">No subscription found.</div>';
    return;
  }
  const st = getSubStatus(biz.id);
  const nextPlan = sub.nextPlan;
  const limits = PLAN_LIMITS[biz.plan] || PLAN_LIMITS.starter;
  const cashierLimitStr =
    limits.cashiers === Infinity ? "Unlimited" : limits.cashiers;
  const itemLimitStr = limits.items === Infinity ? "Unlimited" : limits.items;
  const subPriceDisplay =
    limits.price === 0
      ? "Free Trial"
      : `R${Number(limits.price).toLocaleString("en-ZA", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}/month (billed in ZAR)`;
  const isIntl = biz.currency && biz.currency !== "ZAR";
  const intlPriceNote =
    isIntl && limits.price > 0
      ? `<div style="font-size:11px;color:var(--blue);margin-top:4px">Your bank converts this from ZAR to ${biz.currency} at the prevailing exchange rate.</div>`
      : "";
  const daysLeft = st?.daysLeft || 0;
  const proratedNote =
    daysLeft > 0 && biz.plan !== "premium"
      ? `(~${daysLeft} days remaining on current plan - prorated)`
      : "";
  let badgeClass = "badge-gray";
  if (st?.status === "active") badgeClass = "badge-green";
  else if (st?.status === "grace") badgeClass = "badge-orange";
  else if (st?.status === "cancelled") badgeClass = "badge-accent";
  else if (st?.status === "cancelled-expired" || st?.status === "expired")
    badgeClass = "badge-red";
  if (biz.plan === "trial") badgeClass = "badge-accent";

  // Fix #1/#12: use RENEWAL_WINDOW_DAYS (=2) as the single gate for all renewal UI
  const renewalOpen = daysLeft <= RENEWAL_WINDOW_DAYS;

  area.innerHTML = `
  <div class="page-header"><h2 class="page-title">Subscription</h2></div>
  ${
    st?.inGrace
      ? `<div class="alert alert-orange mb-20"><b>Grace period:</b> ${st.graceLeft} day(s) remaining. Renew before expiry to keep your account active.</div>`
      : ""
  }
  ${
    st?.status === "expired"
      ? `<div class="alert alert-red mb-20">${Icon.alert} Subscription expired. All functionality is suspended. Please renew.</div>`
      : ""
  }
  ${
    st?.active &&
    !st?.inGrace &&
    typeof st?.daysLeft === "number" &&
    st?.daysLeft <= 3 &&
    st?.daysLeft > 0
      ? `<div class="alert alert-accent mb-20">${Icon.alert} <strong>Heads up:</strong> Your subscription expires in <strong>${st.daysLeft} day(s)</strong>. Renew before it ends to avoid interruption.</div>`
      : ""
  }
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:760px" class="sub-grid">
    <div class="card" style="grid-column:1/-1">
      <div class="card-body">
        <div class="sub-plan-header">
          <div>
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--gray-400);font-family:var(--font-mono);margin-bottom:4px">Current Plan</div>
            <div class="sub-plan-name">${limits.label}</div>
          </div>
          <span class="badge ${badgeClass}" style="font-size:11px;padding:4px 10px">${
    st?.label || sub.status
  }</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr;gap:4px" class="sub-details-grid">
          <div class="sub-detail-row"><span class="sub-detail-label">Price</span><div style="text-align:right"><span class="sub-detail-val">${subPriceDisplay}</span>${intlPriceNote}</div></div>
          <div class="sub-detail-row"><span class="sub-detail-label">Expiry Date</span><span class="sub-detail-val">${formatDateShort(
            sub.expiresAt
          )}</span></div>
          <div class="sub-detail-row"><span class="sub-detail-label">Cashier Limit</span><span class="sub-detail-val">${cashierLimitStr}</span></div>
          <div class="sub-detail-row"><span class="sub-detail-label">Item Limit</span><span class="sub-detail-val">${itemLimitStr}</span></div>
          <div class="sub-detail-row"><span class="sub-detail-label">Statements</span><span class="sub-detail-val">${
            limits.statements.length === 0
              ? "None"
              : limits.statements
                  .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
                  .join(", ")
          }</span></div>
          <div class="sub-detail-row"><span class="sub-detail-label">Grace Period</span><span class="sub-detail-val">${
            limits.graceDays === 0 ? "None" : limits.graceDays + " days"
          }</span></div>
        </div>
        <div style="margin-top:16px;padding-top:16px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--gray-400);font-family:var(--font-mono);margin-bottom:10px">Plan Features</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px 16px">
            ${(limits.features || [])
              .map(
                (f) =>
                  `<div style="display:flex;align-items:center;gap:7px;font-size:12px;padding:3px 0;color:var(--gray-700)"><svg width="12" height="12" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>${f}</div>`
              )
              .join("")}
          </div>
        </div>
        ${
          nextPlan
            ? `<div class="alert alert-blue" style="margin-top:14px">${
                Icon.alert
              } Upgrade to <strong>${
                PLAN_LIMITS[nextPlan]?.label
              }</strong> scheduled at next renewal (${formatDateShort(
                sub.expiresAt
              )})</div>`
            : ""
        }
        ${
          sub.status === "cancelled" && st?.active
            ? `<div class="alert alert-orange" style="margin-top:12px">${
                Icon.alert
              } Subscription cancelled — access remains until <strong>${formatDateShort(
                sub.expiresAt
              )}</strong>. Renew before that date to avoid losing access.</div>`
            : ""
        }
        <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          ${
            biz.plan === "trial"
              ? `<button class="btn btn-primary" onclick="handleUpgrade('starter')">Upgrade to Starter</button>`
              : ""
          }
          ${
            biz.plan === "trial"
              ? `<button class="btn btn-outline" onclick="handleUpgrade('premium')">Upgrade to Premium</button>`
              : ""
          }
          ${
            biz.plan === "starter" && !nextPlan && sub.status !== "cancelled"
              ? `<button class="btn btn-primary" onclick="handleUpgrade('premium')">Upgrade to Premium</button>`
              : ""
          }
          ${
            st?.status === "cancelled-expired" || st?.status === "expired"
              ? `<button class="btn btn-primary" onclick="handleRenew()">Renew Subscription</button>`
              : ""
          }
          ${
            sub.status === "cancelled" && st?.active && renewalOpen
              ? `<button class="btn btn-primary" onclick="handleRenew()">Renew Subscription</button>`
              : ""
          }
          ${
            biz.plan !== "trial" &&
            st?.active &&
            sub.status !== "cancelled" &&
            renewalOpen
              ? `<button class="btn btn-primary" onclick="handleRenew()">Renew Subscription</button>`
              : ""
          }
          ${
            biz.plan !== "trial" &&
            st?.active &&
            sub.status !== "cancelled" &&
            !renewalOpen
              ? `<span style="font-size:11px;color:var(--gray-500);font-family:var(--font-mono)">Renewal opens in the last ${RENEWAL_WINDOW_DAYS} days of your billing period.</span>`
              : ""
          }
          ${
            biz.plan !== "trial" && st?.active && sub.status !== "cancelled"
              ? `<button class="btn btn-danger-outline" onclick="handleCancelSub()">Cancel Subscription</button>`
              : ""
          }
          ${
            proratedNote
              ? `<span style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono)">${proratedNote}</span>`
              : ""
          }
        </div>
      </div>
    </div>
  </div>`;
}

function handleUpgrade(targetPlan) {
  if (targetPlan === "trial") {
    toast("Trial plan is not available as an upgrade option.", "error");
    return;
  }
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const sub = store.subscriptions.find(
    (s) => s.businessId === currentUser.businessId
  );
  // Fix #1: use RENEWAL_WINDOW_DAYS consistently
  if (biz.plan !== "trial" && sub && sub.status !== "cancelled") {
    const st = getSubStatus(biz.id);
    const daysLeft = st?.daysLeft || 0;
    const planOrder = { trial: 0, starter: 1, premium: 2 };
    const isDowngrade =
      (planOrder[targetPlan] ?? 0) < (planOrder[biz.plan] ?? 0);
    if (
      !isDowngrade &&
      daysLeft > RENEWAL_WINDOW_DAYS &&
      st?.active &&
      !st?.inGrace
    ) {
      toast(
        `Plan changes are only available in the last ${RENEWAL_WINDOW_DAYS} days of your subscription.`,
        "error"
      );
      return;
    }
  }
  const planOrder = { trial: 0, starter: 1, premium: 2 };
  if ((planOrder[targetPlan] ?? 0) < (planOrder[biz.plan] ?? 0)) {
    const removedFeatures = [];
    if (biz.plan === "premium" && targetPlan === "starter") {
      removedFeatures.push(
        "Multi-Store (up to 3 locations) — all location data becomes inaccessible"
      );
      removedFeatures.push(
        "Audit Action Logs — log history becomes inaccessible"
      );
      removedFeatures.push(
        "Monthly & Yearly Statement Exports — only weekly export remains"
      );
      removedFeatures.push("Unlimited Cashiers → Max 2 Cashiers");
      removedFeatures.push("Unlimited Items → Max 50 Items");
    }
    const removalList = removedFeatures
      .map(
        (f) =>
          `<li style="padding:4px 0;font-size:13px;color:var(--gray-700)">• ${f}</li>`
      )
      .join("");
    openModal(
      "Confirm Downgrade",
      `
      <div style="margin-bottom:16px">
        <div style="font-size:14px;font-weight:700;margin-bottom:8px;color:var(--red)">⚠ Downgrading from ${
          PLAN_LIMITS[biz.plan]?.label
        } → ${PLAN_LIMITS[targetPlan]?.label}</div>
        <p style="font-size:13px;color:var(--gray-600);margin-bottom:12px">The following features and limits will be <strong>removed immediately</strong>:</p>
        <ul style="list-style:none;padding:12px;background:var(--red-bg);border:1px solid #f5c0c4;border-radius:var(--radius)">${removalList}</ul>
        <p style="font-size:12px;color:var(--gray-500);margin-top:10px">Your existing data is preserved but will be inaccessible until you upgrade again.</p>
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-outline btn-lg" style="flex:1" onclick="closeModal()">Cancel</button>
        <button class="btn btn-danger btn-lg" style="flex:2" onclick="closeModal();simulatePaystack('${safeAttr(
          biz.name
        )}','','${safeAttr(
        biz.email
      )}','','${targetPlan}',true,null)">Yes, Downgrade</button>
      </div>`
    );
    return;
  }
  simulatePaystack(biz.name, "", biz.email, "", targetPlan, true, null);
}

function completeUpgrade(targetPlan) {
  const store = getStore();
  const existingSub = store.subscriptions.find(
    (s) => s.businessId === currentUser.businessId
  );
  const dur = PLAN_LIMITS[targetPlan]?.durationDays || 30;
  const processDay = new Date();
  processDay.setHours(0, 0, 0, 0);
  let newExpiry;
  if (existingSub && existingSub.status === "active" && existingSub.expiresAt) {
    const remaining = new Date(existingSub.expiresAt) - new Date();
    newExpiry = new Date(
      processDay.getTime() + dur * 86400000 + Math.max(0, remaining)
    ).toISOString();
  } else {
    newExpiry = new Date(processDay.getTime() + dur * 86400000).toISOString();
  }
  updateStore((d) => ({
    ...d,
    businesses: d.businesses.map((b) =>
      b.id === currentUser.businessId ? { ...b, plan: targetPlan } : b
    ),
    subscriptions: d.subscriptions.map((s) =>
      s.businessId === currentUser.businessId
        ? {
            ...s,
            plan: targetPlan,
            nextPlan: null,
            status: "active",
            expiresAt: newExpiry,
          }
        : s
    ),
  }));
  addAuditLog(`Upgraded plan to ${targetPlan}`, "");
  const newLimits = PLAN_LIMITS[targetPlan] || PLAN_LIMITS.starter;
  const freshStore = getStore();
  const activeItems = freshStore.items.filter(
    (i) => i.businessId === currentUser.businessId && i.status === "active"
  ).length;
  const activeCashiers = freshStore.users.filter(
    (u) => u.businessId === currentUser.businessId && u.role === "cashier"
  ).length;
  const overLimitWarnings = [];
  if (newLimits.items !== Infinity && activeItems > newLimits.items)
    overLimitWarnings.push(
      `Active items: ${activeItems} (limit: ${
        newLimits.items
      }). Please deactivate ${activeItems - newLimits.items} item(s).`
    );
  if (newLimits.cashiers !== Infinity && activeCashiers > newLimits.cashiers)
    overLimitWarnings.push(
      `Cashiers: ${activeCashiers} (limit: ${
        newLimits.cashiers
      }). Please suspend ${activeCashiers - newLimits.cashiers} cashier(s).`
    );
  if (overLimitWarnings.length > 0)
    overLimitWarnings.forEach((w) => toast(`Over limit: ${w}`, "error"));
  else
    toast(
      `Plan changed to ${PLAN_LIMITS[targetPlan]?.label}! Remaining days from current cycle credited.`,
      "success"
    );
  buildSidebar();
  setTimeout(
    () => renderSubscriptions(document.getElementById("content-area")),
    400
  );
}

function completeRenew(newPlan) {
  // Check for one-shot override (set by showLoginSubscriptionModal for login-time renewals)
  if (completeRenewOverride) {
    const fn = completeRenewOverride;
    completeRenewOverride = null;
    fn(newPlan);
    return;
  }
  const store = getStore();
  const existingSub = store.subscriptions.find(
    (s) => s.businessId === currentUser.businessId
  );
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const isTrial = biz?.plan === "trial";
  const dur = PLAN_LIMITS[newPlan]?.durationDays || 30;
  const processDay = new Date();
  processDay.setHours(0, 0, 0, 0);
  let newExpiry;
  // Fix #9: Only carry remaining time when actively subscribed (not trial, not expired/cancelled).
  // Cancelled-but-active subs carry time; expired subs start fresh.
  if (
    !isTrial &&
    existingSub &&
    existingSub.expiresAt &&
    existingSub.status === "active"
  ) {
    const remaining = new Date(existingSub.expiresAt) - new Date();
    newExpiry = new Date(
      processDay.getTime() + dur * 86400000 + Math.max(0, remaining)
    ).toISOString();
  } else {
    newExpiry = new Date(processDay.getTime() + dur * 86400000).toISOString();
  }
  updateStore((d) => ({
    ...d,
    businesses: d.businesses.map((b) =>
      b.id === currentUser.businessId
        ? { ...b, plan: newPlan, status: "active" }
        : b
    ),
    subscriptions: d.subscriptions.map((s) =>
      s.businessId === currentUser.businessId
        ? {
            ...s,
            plan: newPlan,
            status: "active",
            expiresAt: newExpiry,
            nextPlan: null,
          }
        : s
    ),
  }));
  addAuditLog(`Renewed subscription to ${newPlan}`, "");
  toast(
    "Subscription renewed! Duration added to your remaining time.",
    "success"
  );
  buildSidebar();
  setTimeout(
    () => renderSubscriptions(document.getElementById("content-area")),
    400
  );
}

function handleRenew() {
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const featureList = (plan) =>
    (PLAN_LIMITS[plan].features || []).map((f) => `<li>${f}</li>`).join("");
  openModal(
    "Renew Subscription",
    `
    <p style="font-size:13px;color:var(--gray-500);margin-bottom:16px">Choose a plan to renew. Trial plans are not available for renewal.</p>
    <div id="renew-plan-starter" class="plan-card selected" onclick="selectRenewPlan('starter')" style="cursor:pointer">
      <div class="plan-card-header"><span class="plan-name">Starter</span><span class="plan-price">R${
        PLAN_LIMITS.starter.price
      }<span>/mo</span></span></div>
      <div style="font-size:10px;color:var(--blue);margin-bottom:8px;font-family:var(--font-mono)">Billed in ZAR</div>
      <ul class="plan-features">${featureList("starter")}</ul>
    </div>
    <div id="renew-plan-premium" class="plan-card" onclick="selectRenewPlan('premium')" style="cursor:pointer">
      <div class="plan-card-header"><span class="plan-name">Premium <span class="plan-badge-tag popular-badge">Popular</span></span><span class="plan-price">R${
        PLAN_LIMITS.premium.price
      }<span>/mo</span></span></div>
      <div style="font-size:10px;color:var(--blue);margin-bottom:8px;font-family:var(--font-mono)">Billed in ZAR</div>
      <ul class="plan-features">${featureList("premium")}</ul>
    </div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn btn-outline btn-lg" style="flex:1" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-lg" style="flex:2" onclick="_handleRenewContinue()">Continue to Payment</button>
    </div>`
  );
  _renewSelectedPlan = "starter";
  selectRenewPlan("starter");
  _pendingRenew = function () {
    const plan = _renewSelectedPlan || "starter";
    _pendingRenew = null;
    closeModal();
    simulatePaystack(biz.name, "", biz.email, "", plan, false, null, true);
  };
}

function handleCancelSub() {
  const store = getStore();
  const sub = store.subscriptions.find(
    (s) => s.businessId === currentUser.businessId
  );
  const remainingDays = sub.expiresAt
    ? Math.max(0, Math.ceil((new Date(sub.expiresAt) - new Date()) / 86400000))
    : 0;
  const cancelWarning = `Your plan will remain active for the ${remainingDays} day(s) remaining until ${formatDateShort(
    sub.expiresAt
  )}, then access is immediately revoked. No grace period applies once cancelled. Cancel anyway?`;
  confirm2("Cancel Subscription", cancelWarning).then((ok) => {
    if (!ok) return;
    updateStore((d) => ({
      ...d,
      subscriptions: d.subscriptions.map((s) =>
        s.businessId === currentUser.businessId
          ? { ...s, status: "cancelled" }
          : s
      ),
    }));
    toast("Subscription cancelled.");
    renderSubscriptions(document.getElementById("content-area"));
  });
}

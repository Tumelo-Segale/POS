// Fallback state vars (also declared in auth.js for auth.html context)
// These are needed here for the subscription renewal/login flows that may
// run within admin.html (e.g. re-subscription from the subscriptions page)
let _loginSubSelectedPlan = "starter";
let _renewSelectedPlan = "starter";
let completeRenewOverride = null;

// ============================================================
// admin.js - SaleStation
// Admin views: dashboard, inventory, cashiers, multi-store,
//              audit logs, POS, transactions, receipts,
//              subscriptions, contact, settings
// Loaded by: admin.html only
// ============================================================

// ADMIN DASHBOARD - Weekly Sales Chart
// ============================================================
//
// HOW THE CHART WORKS:
//   • The chart always shows the CURRENT calendar week: Sun 00:00 → Sat 23:59.
//   • At Sunday 00:00:00 the week resets - all bars start at zero for the new week.
//   • Each bar slot is keyed to an EXACT calendar date string (YYYY-MM-DD).
//     A transaction is counted ONLY on the date it was recorded - never another day.
//   • Future day slots (after today) always show 0 and are rendered greyed-out.
//   • Today's bar grows live as each new transaction is processed.
//   • The scale (max height) is recalculated fresh every update so bars are
//     always proportional to the current week's data.

/**
 * Returns the YYYY-MM-DD string for midnight local time on a given Date.
 * Uses local date parts to avoid UTC-offset edge cases near midnight.
 */
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Build the 7-slot week array for the current calendar week (Sun→Sat).
 * Each slot contains:
 *   ds        - the exact YYYY-MM-DD local date string for that slot
 *   day       - short day name ('Sun', 'Mon', …)
 *   dateLabel - display label ('DD/MM')
 *   isToday   - true only for the current day slot
 *   isFuture  - true for slots after today (always amount = 0)
 *   amount    - sum of transaction amounts whose local date === ds
 *
 * Transactions are matched by slicing their ISO createdAt to 10 chars
 * AND comparing against the LOCAL date of the slot. Because createdAt is
 * stored as UTC ISO string, we re-parse each transaction date in LOCAL time
 * to guarantee correctness around midnight.
 */
function computeWeekData(txns) {
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const now = new Date();
  const todayDow = now.getDay(); // 0 = Sunday

  // Pre-bucket transactions by their LOCAL date string for O(1) lookup
  const bucket = {};
  txns.forEach((t) => {
    if (!t.createdAt || !t.amount) return;
    // Parse ISO → local date
    const txDate = new Date(t.createdAt);
    const txDs = localDateStr(txDate);
    bucket[txDs] = (bucket[txDs] || 0) + t.amount;
  });

  return DAY_NAMES.map((dayName, i) => {
    // Build the exact calendar date for slot i of this week
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

    // Amount is ZERO for future slots - bucket lookup otherwise
    const amount = isFuture ? 0 : bucket[ds] || 0;

    return { dayName, dateLabel, ds, amount, isFuture, isToday };
  });
}

function fmtBar(n) {
  if (!n || n === 0) return "";
  const sym = getCurrencySymbol();
  if (n >= 1000000)
    return sym + (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return sym + (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return sym + Math.round(n);
}

/**
 * Live-updates the bar heights and stat card values in-place.
 * Called immediately after every transaction AND by the BroadcastChannel /
 * polling interval. Performs NO DOM re-render - only style mutations.
 */
function updateDashboardChart() {
  if (!currentUser || currentUser.role !== "admin") return;
  if (activeTab !== "dashboard") return;

  const store = getStore();
  const bizId = currentUser.businessId;
  const txns = store.transactions.filter((t) => t.businessId === bizId);
  const now = new Date();
  const today = localDateStr(now);

  // ── Stat cards - SS-026: single pass instead of three separate filter+reduce calls ──
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

  // ── Bar chart ────────────────────────────────────────────────
  const weekData = computeWeekData(txns);
  const maxAmount = Math.max(...weekData.map((d) => d.amount), 1);
  const highestAmount = Math.max(
    ...weekData.filter((d) => !d.isFuture && !d.isToday).map((d) => d.amount),
    0
  );

  weekData.forEach((d, i) => {
    const barEl = $(`dash-bar-${i}`);
    const valEl = $(`dash-bar-val-${i}`);
    const groupEl = $(`dash-bar-${i}`)?.closest(".bar-group");
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
    if (d.isToday) {
      barEl.style.background = "var(--black)";
    } else if (d.amount === highestAmount && d.amount > 0) {
      barEl.style.background = "var(--gray-600)";
    } else {
      barEl.style.background = "var(--gray-300)";
    }
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

  // SS-026: Single pass to accumulate today, monthly, and yearly totals simultaneously
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

  const st = getSubStatus(bizId);
  const expiringSoon =
    st &&
    st.active &&
    !st.inGrace &&
    typeof st.daysLeft === "number" &&
    st.daysLeft <= 3 &&
    st.daysLeft > 0;
  const subBanner =
    st && st.inGrace
      ? `<div class="alert alert-orange mb-20"><b>Grace period:</b> ${st.graceLeft} day(s) remaining. Renew your subscription to avoid suspension.</div>`
      : st && st.status === "expired"
      ? `<div class="alert alert-red mb-20">${Icon.alert} Subscription expired. Functionality is suspended.</div>`
      : st && st.status === "cancelled" && st.active && st.daysLeft <= 3
      ? `<div class="alert alert-red mb-20">${Icon.alert} Your cancelled subscription ends in <strong>${st.daysLeft} day(s)</strong>. Renew now to avoid losing access.</div>`
      : expiringSoon
      ? `<div class="alert alert-accent mb-20">${Icon.alert} Subscription expires in <strong>${st.daysLeft} day(s)</strong>. <a href="#" onclick="navigate('subscriptions');return false;" style="color:inherit;font-weight:700">Renew now</a> to avoid interruption.</div>`
      : "";

  // SS-028: Per-location revenue breakdown for premium plan users
  const biz = store.businesses.find((b) => b.id === bizId);
  const isPremium = biz?.plan === "premium";
  let locationBreakdownHTML = "";
  if (isPremium) {
    const locations = store.locations.filter((l) => l.businessId === bizId);
    if (locations.length > 1) {
      // Group this week's transactions by locationId via cashier
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
            // Only count transactions that occurred AFTER the cashier was assigned to this branch
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
      locationBreakdownHTML = `
    <div class="card" style="margin-top:20px">
      <div class="card-header"><span class="card-title">Weekly Revenue by Location</span><span style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono)">This week</span></div>
      <div class="card-body">
${locTotals
  .map(
    (loc) => `
  <div style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
      <span style="font-weight:500">${sanitize(loc.name)}</span>
      <span class="text-mono">${formatCurrency(loc.total)}</span>
    </div>
    <div style="background:var(--gray-100);border-radius:4px;height:8px;overflow:hidden">
      <div style="background:var(--black);height:100%;width:${Math.round(
        (loc.total / locMax) * 100
      )}%;border-radius:4px;transition:width .4s"></div>
    </div>
  </div>`
  )
  .join("")}
      </div>
    </div>`;
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
      <div class="card-header">
<div>
  <span class="card-title">Weekly Sales Overview</span>
</div>
<span id="dash-week-label" style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono)"></span>
      </div>
      <div class="card-body">
<div class="bar-chart" id="dash-bar-chart">
  ${weekData
    .map(
      (d, i) => `
    <div class="bar-group" style="opacity:${d.isFuture ? 0.3 : 1}">
      <div class="bar-val" id="dash-bar-val-${i}" style="font-size:9px;height:16px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:2px">${fmtBar(
        d.amount
      )}</div>
      <div class="bar" id="dash-bar-${i}"
        style="height:${
          d.isFuture
            ? 2
            : d.amount > 0
            ? Math.max((d.amount / maxAmount) * 120, 4)
            : 2
        }px;
               background:${
                 d.isToday
                   ? "var(--black)"
                   : d.isFuture
                   ? "var(--gray-100)"
                   : d.amount ===
                       Math.max(
                         ...weekData
                           .filter((x) => !x.isFuture && !x.isToday)
                           .map((x) => x.amount),
                         0
                       ) && d.amount > 0
                   ? "var(--gray-600)"
                   : "var(--gray-300)"
               };
               transition:height .45s cubic-bezier(.4,0,.2,1)"></div>
      <div class="bar-label" style="line-height:1.4;padding-top:4px">
        <div style="font-weight:${d.isToday ? "700" : "400"};color:${
        d.isToday ? "var(--black)" : "inherit"
      }">${d.dayName}</div>
        <div style="font-size:8px;color:var(--gray-300)">${d.dateLabel}</div>
      </div>
    </div>`
    )
    .join("")}
</div>
      </div>
    </div>
    ${locationBreakdownHTML}`;

  // Set the week label (e.g. "18 Apr – 24 Apr 2025")
  const sunDate = weekData[0];
  const satDate = weekData[6];
  const fmt = (ds) => {
    const [y, m, day] = ds.split("-");
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
    )} ${sunDate.ds.slice(0, 4)}`;

  // Schedule an automatic re-render exactly at the next Sunday midnight
  // so the chart resets live if the dashboard is left open overnight
  scheduleWeekReset();
}

// ── Week reset scheduler ────────────────────────────────────────
let _weekResetTimer = null;
function scheduleWeekReset() {
  if (_weekResetTimer) clearTimeout(_weekResetTimer);
  const now = new Date();
  // Next Sunday 00:00:00 local time
  const nextSunday = new Date(now);
  nextSunday.setDate(now.getDate() + ((7 - now.getDay()) % 7) || 7);
  nextSunday.setHours(0, 0, 0, 0);
  const msUntilReset = nextSunday - now;
  _weekResetTimer = setTimeout(() => {
    // Re-render dashboard to show fresh week
    if (
      activeTab === "dashboard" &&
      currentUser &&
      currentUser.role === "admin"
    ) {
      renderAdminDashboard(document.getElementById("content-area"));
    }
  }, msUntilReset);
}

// ============================================================
// ITEMS
// ============================================================
// Module-level selected location filter for admin inventory view
let _invSelectedLocationId = "all";

function renderItems(area) {
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const plan = biz?.plan || "starter";
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
  const isRestaurant = biz?.businessType === "restaurant";

  // Locations for this business (only relevant on premium with multiple locations)
  const locations = store.locations.filter(
    (l) => l.businessId === currentUser.businessId
  );
  const hasLocations = locations.length > 0;

  // Ensure selected location is still valid
  if (
    _invSelectedLocationId !== "all" &&
    !locations.find((l) => l.id === _invSelectedLocationId)
  ) {
    _invSelectedLocationId = "all";
  }

  // Filter items: by business, and by location if one is selected
  const allBizItems = store.items.filter(
    (i) => i.businessId === currentUser.businessId
  );
  const items =
    hasLocations && _invSelectedLocationId !== "all"
      ? allBizItems.filter((i) => i.locationId === _invSelectedLocationId)
      : allBizItems;

  const activeItemCount = items.filter((i) => i.status === "active").length;
  const itemLimitWarning =
    limits.items !== Infinity && limits.items - activeItemCount <= 3
      ? `<span style="color:${
          activeItemCount >= limits.items ? "var(--red)" : "var(--orange)"
        };font-size:12px;font-weight:700;margin-left:8px">${
          activeItemCount >= limits.items
            ? "Limit reached"
            : `${limits.items - activeItemCount} slot(s) left`
        }</span>`
      : "";

  const catFilterHTML =
    isRestaurant && currentUser.role !== "cashier"
      ? `
<select id="inv-cat-filter" class="form-select" style="height:34px;width:130px" onchange="filterInventoryItems()">
  <option value="all">All Categories</option>
  <option value="meals">Meals</option>
  <option value="drinks">Drinks</option>
  <option value="others">Others</option>
</select>`
      : "";

  // Location selector — only shown when there are multiple locations (premium)
  const locationFilterHTML = hasLocations
    ? `<select id="inv-location-filter" class="form-select" style="height:34px;width:160px" onchange="setInvLocation(this.value)">
  <option value="all"${
    _invSelectedLocationId === "all" ? " selected" : ""
  }>All Locations</option>
  ${locations
    .map(
      (l) =>
        `<option value="${safeAttr(l.id)}"${
          _invSelectedLocationId === l.id ? " selected" : ""
        }>${sanitize(l.name)}</option>`
    )
    .join("")}
</select>`
    : "";

  // Show location column in table only when viewing "all locations"
  const showLocCol = hasLocations && _invSelectedLocationId === "all";
  const colCount =
    (currentUser.role !== "cashier" ? 1 : 0) + // actions
    (isRestaurant ? 1 : 0) + // category
    (showLocCol ? 1 : 0) + // location
    4; // name, price, stock, status

  area.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">Inventory <span style="font-size:13px;color:var(--gray-400);font-weight:400;font-family:var(--font-main)">${activeItemCount}${
    limits.items !== Infinity ? " / " + limits.items : ""
  } active${itemLimitWarning}</span></h2>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
<div class="search-box"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--gray-400)"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input id="inv-search" type="text" placeholder="Search items..." style="padding-left:30px;height:34px" oninput="filterInventoryItems()" /></div>
${locationFilterHTML}
${catFilterHTML}
<select id="inv-status-filter" class="form-select" style="height:34px;width:140px" onchange="filterInventoryItems()">
  <option value="all">All</option>
  <option value="active">Active</option>
  <option value="inactive">Inactive</option>
  <option value="out-of-stock">Out of Stock</option>
</select>
${
  currentUser.role !== "cashier"
    ? `<button class="btn btn-primary" onclick="openItemModal(null)">${Icon.plus} Add Item</button>`
    : ""
}
      </div>
    </div>
    <div class="card">
      <div class="table-wrapper">
<table>
  <thead><tr><th>Item Name</th>${isRestaurant ? "<th>Category</th>" : ""}${
    showLocCol ? "<th>Location</th>" : ""
  }<th>Price</th><th>Stock</th><th>Status</th>${
    currentUser.role !== "cashier" ? "<th>Actions</th>" : ""
  }</tr></thead>
  <tbody id="inv-table-body">
    ${
      items.length === 0
        ? `<tr><td colspan="${colCount}"><div class="empty-state">${
            hasLocations && _invSelectedLocationId !== "all"
              ? "No items for this location yet. Add your first item."
              : "No items yet. Add your first item."
          }</div></td></tr>`
        : items
            .map((item) =>
              renderInvRow(item, isRestaurant, showLocCol, locations)
            )
            .join("")
    }
  </tbody>
</table>
      </div>
    </div>
  `;
}

function setInvLocation(locId) {
  _invSelectedLocationId = locId;
  renderItems(document.getElementById("content-area"));
}

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
  const locName = showLocCol
    ? (() => {
        if (!item.locationId) return "-";
        const loc = (locations || []).find((l) => l.id === item.locationId);
        return loc ? sanitize(loc.name) : "-";
      })()
    : null;
  const locCell = showLocCol ? `<td class="text-muted">${locName}</td>` : "";
  return `<tr>
        <td><strong>${sanitize(item.name)}</strong></td>
        ${catCell}
        ${locCell}
        <td class="text-mono">${formatCurrency(item.price)}</td>
        <td class="text-mono">${renderInvStockCell(item)}</td>
        <td><span class="badge ${
          item.status === "active" ? "badge-green" : "badge-red"
        }">${item.status}</span></td>
        ${
          currentUser.role !== "cashier"
            ? `<td><div class="td-actions">
          <button class="btn btn-sm btn-outline" onclick="openItemModal('${
            item.id
          }')">${Icon.edit}</button>
          <button class="btn btn-sm btn-outline" onclick="toggleItemStatus('${
            item.id
          }')">${item.status === "active" ? "Deactivate" : "Activate"}</button>
          <button class="btn btn-sm btn-danger-outline" onclick="deleteItem('${
            item.id
          }')">${Icon.trash}</button>
        </div></td>`
            : ""
        }
      </tr>`;
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
  const locations = store.locations.filter(
    (l) => l.businessId === currentUser.businessId
  );
  const hasLocations = locations.length > 0;
  const showLocCol = hasLocations && _invSelectedLocationId === "all";

  const allBizItems = store.items.filter(
    (i) => i.businessId === currentUser.businessId
  );
  const items =
    hasLocations && _invSelectedLocationId !== "all"
      ? allBizItems.filter((i) => i.locationId === _invSelectedLocationId)
      : allBizItems;

  const filtered = items.filter((i) => {
    const matchName = i.name.toLowerCase().includes(q);
    let matchStatus;
    if (statusFilter === "out-of-stock") {
      matchStatus = i.stock !== null && i.stock !== undefined && i.stock === 0;
    } else {
      matchStatus = statusFilter === "all" || i.status === statusFilter;
    }
    const matchCat =
      !isRestaurant || catFilter === "all" || i.category === catFilter;
    return matchName && matchStatus && matchCat;
  });
  const tbody = document.getElementById("inv-table-body");
  if (!tbody) return;
  const colCount =
    (currentUser.role !== "cashier" ? 1 : 0) +
    (isRestaurant ? 1 : 0) +
    (showLocCol ? 1 : 0) +
    4;
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colCount}"><div class="empty-state">No items match your search.</div></td></tr>`;
  } else {
    tbody.innerHTML = filtered
      .map((item) => renderInvRow(item, isRestaurant, showLocCol, locations))
      .join("");
  }
}

function openItemModal(itemId) {
  if (currentUser && currentUser.role === "cashier") {
    toast("Permission denied: cashiers cannot modify inventory.", "error");
    return;
  }
  const store = getStore();
  const item = itemId ? store.items.find((i) => i.id === itemId) : null;
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const isRestaurant = biz?.businessType === "restaurant";
  const sym = getCurrencySymbol();
  const isTracked = item && item.stock !== null && item.stock !== undefined;

  // Location selector: shown whenever at least one branch/location exists
  const locations = store.locations.filter(
    (l) => l.businessId === currentUser.businessId
  );
  const hasLocations = locations.length > 0;
  // Pre-select: use the item's existing locationId, or the current filter, or ""
  const preselectedLoc = item?.locationId
    ? item.locationId
    : _invSelectedLocationId !== "all"
    ? _invSelectedLocationId
    : "";
  const locationField = hasLocations
    ? `
    <div class="form-group">
      <label class="form-label">Branch / Location</label>
      <select id="m-item-location" class="form-select">
        <option value="">— No specific branch (shared) —</option>
        ${locations
          .map(
            (l) =>
              `<option value="${safeAttr(l.id)}"${
                preselectedLoc === l.id ? " selected" : ""
              }>${sanitize(l.name)}</option>`
          )
          .join("")}
      </select>
      <div style="font-size:11px;color:var(--gray-400);margin-top:4px">Leave blank to make this item available to all branches.</div>
    </div>`
    : "";

  const categoryField = isRestaurant
    ? `
    <div class="form-group">
      <label class="form-label">Category <span style="color:var(--red)">*</span></label>
      <select id="m-item-category" class="form-select">
<option value="meals" ${
        item?.category === "meals" ? "selected" : ""
      }>Meals</option>
<option value="drinks" ${
        item?.category === "drinks" ? "selected" : ""
      }>Drinks</option>
<option value="others" ${
        item?.category === "others" ? "selected" : ""
      }>Others</option>
      </select>
    </div>`
    : "";

  openModal(
    item ? "Edit Item" : "Add New Item",
    `
    <div class="form-group"><label class="form-label">Item Name</label><input id="m-item-name" class="form-input" value="${
      item ? sanitize(item.name) : ""
    }" placeholder="e.g. Coca Cola 500ml"/></div>
    ${locationField}
    ${categoryField}
    <div class="form-group"><label class="form-label">Price (${sym})</label><input id="m-item-price" class="form-input" type="number" min="0" max="999999" step="0.01" value="${
      item ? item.price : ""
    }" placeholder="0.00"/></div>
    <div class="form-group">
      <label class="form-label">Stock Tracking</label>
      <select id="m-item-stock-mode" class="form-select" onchange="toggleStockField(this.value)">
<option value="untracked" ${!isTracked ? "selected" : ""}>Not tracked</option>
<option value="tracked" ${
      isTracked ? "selected" : ""
    }>Track stock quantity</option>
      </select>
    </div>
    <div id="stock-field-row" style="display:${isTracked ? "block" : "none"}">
      <div class="form-group"><label class="form-label">Current Stock Quantity</label><input id="m-item-stock" class="form-input" type="number" min="0" step="1" value="${
        isTracked ? item.stock : 0
      }" placeholder="0"/></div>
    </div>
    <button class="btn btn-primary btn-full btn-lg" id="save-item-btn" onclick="saveItem('${safeAttr(
      itemId || ""
    )}')">${item ? "Update Item" : "Add Item"}</button>
  `
  );
}

function toggleStockField(val) {
  // SS-027: Show/hide stock quantity field based on tracking selection
  const row = document.getElementById("stock-field-row");
  if (row) row.style.display = val === "tracked" ? "block" : "none";
}

function saveItem(itemId) {
  if (currentUser && currentUser.role === "cashier") {
    toast("Permission denied: cashiers cannot modify inventory.", "error");
    return false;
  }
  const name = document.getElementById("m-item-name").value.trim();
  const price = parseFloat(document.getElementById("m-item-price").value);
  if (!name || isNaN(price) || price < 0) {
    toast("Please fill in all fields correctly", "error");
    return false;
  }

  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const isRestaurant = biz?.businessType === "restaurant";
  const categoryEl = document.getElementById("m-item-category");
  const category = isRestaurant
    ? categoryEl
      ? categoryEl.value
      : "others"
    : null;

  if (isRestaurant && !category) {
    toast("Please select a category", "error");
    return false;
  }

  // Location assignment — optional even when branches exist
  const locations = store.locations.filter(
    (l) => l.businessId === currentUser.businessId
  );
  const hasLocations = locations.length > 0;
  const locationEl = document.getElementById("m-item-location");
  const locationId = locationEl ? locationEl.value : "";
  // No mandatory check — empty means "shared / no specific branch"

  const prevSearch = document.getElementById("inv-search")?.value || "";
  const prevStatus =
    document.getElementById("inv-status-filter")?.value || "all";

  const limits = PLAN_LIMITS[biz?.plan] || PLAN_LIMITS.starter;

  if (itemId) {
    const stockMode = document.getElementById("m-item-stock-mode")?.value;
    const stockQty =
      stockMode === "tracked"
        ? parseInt(document.getElementById("m-item-stock")?.value || "0", 10)
        : null;
    updateStore((d) => ({
      ...d,
      items: d.items.map((i) =>
        i.id === itemId
          ? {
              ...i,
              name: sanitize(name),
              price,
              stock: stockMode ? stockQty : i.stock,
              ...(isRestaurant ? { category } : {}),
              locationId: hasLocations ? locationId : i.locationId || "",
            }
          : i
      ),
    }));
    addAuditLog("Updated item", name);
    toast("Item updated", "success");
  } else {
    const currentItems = store.items.filter(
      (i) => i.businessId === currentUser.businessId && i.status === "active"
    );
    if (limits.items !== Infinity && currentItems.length >= limits.items) {
      toast(
        `${biz?.plan} plan limit: ${limits.items} items. Upgrade to add more.`,
        "error"
      );
      return false;
    }
    const stockMode = document.getElementById("m-item-stock-mode")?.value;
    const stockQty =
      stockMode === "tracked"
        ? parseInt(document.getElementById("m-item-stock")?.value || "0", 10)
        : null;
    updateStore((d) => ({
      ...d,
      items: [
        ...d.items,
        {
          id: `item-${uid()}`,
          businessId: currentUser.businessId,
          name: sanitize(name),
          price,
          stock: stockQty,
          status: "active",
          ...(isRestaurant ? { category } : {}),
          locationId: hasLocations ? locationId : "",
        },
      ],
    }));
    addAuditLog("Added item", name);
    toast("Item added", "success");
  }
  closeModal();
  renderItems(document.getElementById("content-area"));
  const searchEl = document.getElementById("inv-search");
  const statusEl = document.getElementById("inv-status-filter");
  if (searchEl) searchEl.value = prevSearch;
  if (statusEl) statusEl.value = prevStatus;
  if (prevSearch || prevStatus !== "all") filterInventoryItems();
  refreshPOSItemCache();
}

function toggleItemStatus(id) {
  // SS-012: Role guard - cashiers are read-only for inventory
  if (currentUser && currentUser.role === "cashier") {
    toast("Permission denied: cashiers cannot modify inventory.", "error");
    return;
  }
  const store = getStore();
  const item = store.items.find((i) => i.id === id);
  if (!item) return;
  // Enforce item limit on reactivation
  if (item.status !== "active") {
    const biz = store.businesses.find((b) => b.id === currentUser.businessId);
    const limits = PLAN_LIMITS[biz?.plan] || PLAN_LIMITS.starter;
    const activeItems = store.items.filter(
      (i) => i.businessId === currentUser.businessId && i.status === "active"
    );
    if (limits.items !== Infinity && activeItems.length >= limits.items) {
      toast(
        `Item limit reached (${limits.items}). Deactivate another item first.`,
        "error"
      );
      return;
    }
  }
  // SS-008: Preserve filter state across re-render
  const prevSearch = document.getElementById("inv-search")?.value || "";
  const prevStatus =
    document.getElementById("inv-status-filter")?.value || "all";
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
  const searchEl = document.getElementById("inv-search");
  const statusEl = document.getElementById("inv-status-filter");
  if (searchEl) searchEl.value = prevSearch;
  if (statusEl) statusEl.value = prevStatus;
  if (prevSearch || prevStatus !== "all") filterInventoryItems();
  refreshPOSItemCache();
  toast("Item status updated");
}

function deleteItem(id) {
  // SS-012: Role guard - cashiers are read-only for inventory
  if (currentUser && currentUser.role === "cashier") {
    toast("Permission denied: cashiers cannot modify inventory.", "error");
    return;
  }
  const store = getStore();
  const item = store.items.find((i) => i.id === id);
  // SS-008: Capture filter state before confirm dialog (DOM still live at this point)
  const prevSearch = document.getElementById("inv-search")?.value || "";
  const prevStatus =
    document.getElementById("inv-status-filter")?.value || "all";
  confirm2(
    "Delete Item",
    `Delete "${item?.name}"? This cannot be undone.`
  ).then((ok) => {
    if (!ok) return;
    updateStore((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) }));
    addAuditLog("Deleted item", item?.name);
    renderItems(document.getElementById("content-area"));
    const searchEl = document.getElementById("inv-search");
    const statusEl = document.getElementById("inv-status-filter");
    if (searchEl) searchEl.value = prevSearch;
    if (statusEl) statusEl.value = prevStatus;
    if (prevSearch || prevStatus !== "all") filterInventoryItems();
    refreshPOSItemCache();
    toast("Item deleted");
  });
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
          ? `<button class="btn btn-primary" disabled title="Cashier limit reached for your plan. Upgrade to add more." style="opacity:.5;cursor:not-allowed">${Icon.plus} Add Cashier <span style="font-size:10px;margin-left:4px;opacity:.8">(limit reached)</span></button>`
          : `<button class="btn btn-primary" onclick="openCashierModal(null)">${Icon.plus} Add Cashier</button>`
      }
    </div>
    <div class="card">
      <div class="table-wrapper">
<table>
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
            }')">${c.status === "active" ? "Suspend" : "Activate"}</button>
            <button class="btn btn-sm btn-danger-outline" onclick="deleteCashier('${
              c.id
            }')">${Icon.trash}</button>
          </div></td>
        </tr>`;
            })
            .join("")
    }
  </tbody>
</table>
      </div>
    </div>
  `;
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
    <div class="form-group">
      <label class="form-label">${c ? "New Password" : "Password"} ${
      c ? "" : '<span style="color:var(--red)">*</span>'
    }</label>
      <div class="pw-wrap"><input id="m-c-pass" class="form-input" type="password" placeholder="${
        c ? "Leave blank to keep current" : "••••••••"
      }"/>
      <button class="pw-toggle" type="button" onclick="togglePw('m-c-pass',this)"><svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></div>
    </div>
    ${
      locations.length > 0
        ? `<div class="form-group"><label class="form-label">Assign Location</label><select id="m-c-loc" class="form-select">${locOptions}</select></div>`
        : ""
    }
    <button class="btn btn-primary btn-full btn-lg" id="save-cashier-btn" onclick="saveCashier('${
      cashierId || null
    }')">${c ? "Update Cashier" : "Add Cashier"}</button>
  `
  );
}

function saveCashier(cashierId) {
  // Normalize: treat the string 'null' (from template literal) as falsy
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
    // Email uniqueness check (excluding self)
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
              // Record timestamp when cashier is assigned/re-assigned to a location
              // so that branch transaction history starts from this point
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
    // Email uniqueness
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
          // Record when cashier is first assigned to a branch
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
  // SS-022: Warn admin about orphaned transaction references
  const txnCount = store.transactions.filter((t) => t.cashierId === id).length;
  const warningMsg =
    txnCount > 0
      ? `Delete cashier "${cashier?.name}"? They have ${txnCount} transaction(s) on record. These transactions will be preserved but the cashier's profile will be removed. This cannot be undone.`
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
    <div class="card">
      <div class="table-wrapper">
<table>
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
              return `<tr>
          <td><strong>${sanitize(l.name)}</strong></td>
          <td class="text-muted">${sanitize(l.address || "-")}</td>
          <td>${cashiers.length}</td>
          <td><div class="td-actions">
            <button class="btn btn-sm btn-outline" onclick="openLocationModal('${
              l.id
            }')">${Icon.edit}</button>
            <button class="btn btn-sm btn-danger-outline" onclick="deleteLocation('${
              l.id
            }')">${Icon.trash}</button>
          </div></td>
        </tr>`;
            })
            .join("")
    }
  </tbody>
</table>
      </div>
    </div>
    <div style="margin-top:20px">
      <div class="card">
<div class="card-header"><span class="card-title">Inventory & Revenue by Location</span></div>
<div class="card-body">
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
              // Only count transactions after the cashier was assigned to this branch
              if (
                c.locationAssignedAt &&
                new Date(t.createdAt) < new Date(c.locationAssignedAt)
              )
                return false;
              return true;
            });
            const total = txns.reduce((a, t) => a + t.amount, 0);
            const locItems = store.items.filter(
              (i) =>
                i.businessId === currentUser.businessId && i.locationId === l.id
            );
            const activeLocItems = locItems.filter(
              (i) => i.status === "active"
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
</div>
      </div>
    </div>
  `;
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
<div class="search-box"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--gray-400)"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input id="audit-search" type="text" placeholder="Search logs..." style="padding-left:30px;height:34px" oninput="filterAuditLogs()" /></div>
<button class="btn btn-outline" onclick="exportAuditLogs()">${
    Icon.download
  } Export CSV</button>
      </div>
    </div>
    <div class="card">
      <div class="table-wrapper">
<table>
  <thead><tr><th>Date & Time</th><th>User</th><th>Role</th><th>Action</th><th>Target</th></tr></thead>
  <tbody id="audit-tbody">
    ${renderAuditRows(logs)}
  </tbody>
</table>
      </div>
    </div>
  `;
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

  // Auto-fit column widths with per-column minimums to ensure content fits
  const minWidths = [20, 18, 12, 30, 30]; // Date & Time, User, Role, Action, Target
  const colWidths = rows[0].map((_, colIdx) => {
    const dataMax = Math.max(
      ...rows.map((row) => String(row[colIdx] || "").length)
    );
    return Math.max(dataMax + 4, minWidths[colIdx] || 14);
  });
  ws["!cols"] = colWidths.map((w) => ({ wch: Math.min(w, 80) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Audit Logs");
  XLSX.writeFile(
    wb,
    `audit-logs-${new Date().toISOString().slice(0, 10)}.xlsx`
  );
  toast("Audit logs exported.", "success");
}

// ============================================================
// POS
// ============================================================
let posCart = [];
// FIX 5: Expose posCart on window so shared.js navigate() can reliably
// detect it with typeof, regardless of script loading order.
window.posCart = posCart;
// Fix 20: Persist payment method in localStorage between navigation
let posPayMethod = (() => {
  try {
    return localStorage.getItem("ss_pos_pay_method") || "cash";
  } catch (e) {
    return "cash";
  }
})();
let _posItems = [];
let _posActiveCat = "all"; // active POS category filter (module-level, not window global)

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

function refreshPOSItemCache() {
  const store = getStore();
  // Include all active items so we can show out-of-stock state; stock===0 items will be rendered as disabled
  _posItems = store.items.filter(
    (i) => i.businessId === currentUser.businessId && i.status === "active"
  );
}

function refreshPOSItemsOnly() {
  if (activeTab !== "pos") return;
  refreshPOSItemCache();
  const searchInput = document.getElementById("pos-search-input");
  const q = searchInput ? searchInput.value.toLowerCase() : "";
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const isRestaurant = biz?.businessType === "restaurant";
  let filtered = _posItems.filter((i) => i.name.toLowerCase().includes(q));
  if (isRestaurant && _posActiveCat !== "all") {
    filtered = filtered.filter((i) => i.category === _posActiveCat);
  }
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

  const catTabs = isRestaurant
    ? `
    <div style="display:flex;gap:4px;padding:8px 12px 4px;border-bottom:1px solid var(--gray-100);flex-wrap:wrap">
      ${["all", "meals", "drinks", "others"]
        .map(
          (cat) => `
<button class="pos-cat-btn btn btn-sm ${
            _posActiveCat === cat ? "btn-primary" : "btn-outline"
          }" data-cat="${cat}"
  onclick="setPOSCat('${cat}')">
  ${cat === "all" ? "All" : cat.charAt(0).toUpperCase() + cat.slice(1)}
</button>`
        )
        .join("")}
    </div>`
    : "";

  area.innerHTML = `
    <div class="pos-layout">
      <div class="pos-items-panel">
<div class="pos-search">${
    Icon.search
  }<input id="pos-search-input" type="text" placeholder="Search items..." oninput="filterPOSItems()"/></div>
${catTabs}
<div class="pos-items-grid" id="pos-items-grid">${renderPOSItemsHTML(
    _posItems
  )}</div>
      </div>
      <div class="pos-cart">
<div class="pos-cart-header">${Icon.cart} Current Order</div>
<div class="pos-cart-items" id="pos-cart-items"><div class="cart-empty-state">${
    Icon.package
  }<p>Cart is empty</p></div></div>
<div class="pos-cart-footer">
  <div class="total-row"><span class="total-label">Subtotal</span><span class="total-amount" id="pos-subtotal">R0.00</span></div>
  <div class="total-row" style="margin-bottom:0"><span class="grand-total-label">Total</span><span class="grand-total-amount" id="pos-total">R0.00</span></div>
  <div class="payment-toggle">
    <button class="pay-btn active" id="pay-cash" onclick="setPayMethod('cash')">CASH</button>
    <button class="pay-btn" id="pay-card" onclick="setPayMethod('card')">CARD</button>
  </div>
  <button class="btn btn-primary btn-full btn-xl" id="pos-checkout-btn" onclick="handlePOSCheckout()" disabled>Complete Transaction</button>
</div>
      </div>
    </div>
  `;
  updateCartUI();
  setPayMethod(posPayMethod);
}

function setPOSCat(cat) {
  _posActiveCat = cat;
  document.querySelectorAll(".pos-cat-btn").forEach((b) => {
    b.classList.toggle("btn-primary", b.dataset.cat === cat);
    b.classList.toggle("btn-outline", b.dataset.cat !== cat);
  });
  filterPOSItems();
}

let _posFilterTimer = null;
function filterPOSItems() {
  clearTimeout(_posFilterTimer);
  _posFilterTimer = setTimeout(_doFilterPOS, 120);
}
function _doFilterPOS() {
  const q = (
    document.getElementById("pos-search-input")?.value || ""
  ).toLowerCase();
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const isRestaurant = biz?.businessType === "restaurant";
  let filtered = _posItems.filter((i) => i.name.toLowerCase().includes(q));
  if (isRestaurant && _posActiveCat !== "all") {
    filtered = filtered.filter((i) => i.category === _posActiveCat);
  }
  const grid = document.getElementById("pos-items-grid");
  if (grid) grid.innerHTML = renderPOSItemsHTML(filtered);
}

function renderPOSItemsHTML(items) {
  if (items.length === 0) {
    // Fix 12: Differentiate between "no items at all" vs "no search results", and guide trial users
    const store = getStore();
    const allItems = store.items.filter(
      (i) => i.businessId === currentUser.businessId
    );
    const biz = store.businesses.find((b) => b.id === currentUser.businessId);
    if (allItems.length === 0) {
      const isTrial = biz?.plan === "trial";
      const guideLink =
        currentUser.role === "cashier"
          ? "Ask your administrator to add inventory items."
          : `<br><button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="navigate('items')">Go to Inventory →</button>`;
      return `<div class="empty-state" style="grid-column:1/-1;padding:48px 20px">
                <div style="font-weight:700;margin-bottom:6px">${
                  isTrial ? "Welcome to SaleStation!" : "No items in inventory"
                }</div>
                <div style="font-size:12px;color:var(--gray-400)">You need to add items before you can use the POS. ${guideLink}</div>
            </div>`;
    }
    const hasSearch =
      (document.getElementById("pos-search-input")?.value || "").trim().length >
      0;
    let hint = "";
    if (hasSearch)
      hint = `<br><button class="btn btn-sm btn-outline" style="margin-top:10px" onclick="document.getElementById('pos-search-input').value='';filterPOSItems()">Clear search</button>`;
    return `<div class="empty-state" style="grid-column:1/-1">No items match your search.${hint}</div>`;
  }
  return items
    .map((item) => {
      const isTracked = item.stock !== null && item.stock !== undefined;
      const isOutOfStock = isTracked && item.stock === 0;
      const isLowStock = isTracked && item.stock > 0 && item.stock <= 5;
      const stockBadge = isOutOfStock
        ? `<div style="margin-top:4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--red);font-family:var(--font-mono)">Out of Stock</div>`
        : "";
      let btnClass = "pos-item-btn";
      if (isOutOfStock) btnClass += " pos-item-out-of-stock";
      else if (isLowStock) btnClass += " pos-item-low-stock";
      return `
    <button class="${btnClass}" data-id="${safeAttr(item.id)}" data-price="${
        item.price
      }" onclick="addToCartById(this)"
      ${
        isOutOfStock
          ? 'disabled style="opacity:0.45;cursor:not-allowed;background:var(--gray-100);border-color:var(--gray-200);pointer-events:none;"'
          : ""
      }>
      <div class="pos-item-name">${sanitize(item.name)}</div>
      <div class="pos-item-price">${formatCurrency(item.price)}</div>
      ${stockBadge}
    </button>
  `;
    })
    .join("");
}

function addToCartById(btn) {
  const id = btn.dataset.id;
  // Block out-of-stock items immediately (no flash, no cart add)
  if (btn.classList.contains("pos-item-out-of-stock")) {
    toast(
      "This item is out of stock and cannot be added to the cart.",
      "error"
    );
    return;
  }
  // Visual feedback: flash the button
  btn.classList.remove("flash");
  void btn.offsetWidth; // force reflow to restart animation
  btn.classList.add("flash");
  btn.addEventListener("animationend", () => btn.classList.remove("flash"), {
    once: true,
  });
  addToCart(id);
}

function addToCart(id) {
  // Always use fresh price/name from store cache
  const freshItem = _posItems.find((i) => i.id === id);
  if (!freshItem) return;

  const isTracked = freshItem.stock !== null && freshItem.stock !== undefined;

  // Hard block: item is out of stock
  if (isTracked && freshItem.stock === 0) {
    toast(
      `"${freshItem.name}" is out of stock and cannot be purchased.`,
      "error"
    );
    return;
  }

  const existing = posCart.find((c) => c.id === id);
  const currentQty = existing ? existing.quantity : 0;

  // Enforce stock cap: don't let cart quantity exceed available stock
  if (isTracked && currentQty >= freshItem.stock) {
    toast(
      `Only ${freshItem.stock} unit${freshItem.stock === 1 ? "" : "s"} of "${
        freshItem.name
      }" available in stock.`,
      "error"
    );
    return;
  }

  if (existing) {
    existing.quantity++;
    existing.price = freshItem.price;
    existing.name = freshItem.name;
  } else {
    posCart.push({
      id,
      name: freshItem.name,
      price: freshItem.price,
      quantity: 1,
    });
  }

  // Low-stock warning: fire when remaining stock (after this add) is <= 5
  // Use (freshItem.stock - newQty) so it reflects actual units left on the shelf
  if (isTracked) {
    const newQty = currentQty + 1;
    const remaining = freshItem.stock - newQty;
    if (remaining <= 5 && remaining > 0) {
      toast(
        `Low stock: only ${remaining} unit${remaining === 1 ? "" : "s"} of "${
          freshItem.name
        }" left.`,
        "warning"
      );
    }
  }

  updateCartUI();
}

function updateCartUI() {
  const cartEl = document.getElementById("pos-cart-items");
  if (!cartEl) return;
  const total = posCart.reduce((a, c) => a + c.price * c.quantity, 0);
  if (posCart.length === 0) {
    cartEl.innerHTML = `<div class="cart-empty-state">${Icon.package}<p>Cart is empty</p></div>`;
  } else {
    cartEl.innerHTML = posCart
      .map((c) => {
        const freshItem = _posItems.find((i) => i.id === c.id);
        const isTracked =
          freshItem &&
          freshItem.stock !== null &&
          freshItem.stock !== undefined;
        const atCap = isTracked && c.quantity >= freshItem.stock;
        return `
      <div class="pos-cart-item">
<div class="pos-cart-item-info">
  <div class="pos-cart-item-name">${sanitize(c.name)}</div>
  <div class="pos-cart-item-price">${formatCurrency(c.price)} × ${
          c.quantity
        } = ${formatCurrency(c.price * c.quantity)}</div>
</div>
<div class="qty-ctrl">
  <button class="qty-btn" onclick="changeQty('${c.id}',-1)">−</button>
  <span class="qty-num">${c.quantity}</span>
  <button class="qty-btn" onclick="changeQty('${c.id}',1)" ${
          atCap ? 'disabled title="Maximum stock reached"' : ""
        }>+</button>
</div>
<button class="cart-remove-btn" onclick="removeFromCart('${c.id}')">${
          Icon.trash
        }</button>
      </div>
    `;
      })
      .join("");
  }
  const fmt = formatCurrency(total);
  const subtotalEl = document.getElementById("pos-subtotal");
  const totalEl = document.getElementById("pos-total");
  const checkoutBtn = document.getElementById("pos-checkout-btn");
  if (subtotalEl) subtotalEl.textContent = fmt;
  if (totalEl) totalEl.textContent = fmt;
  if (checkoutBtn) {
    checkoutBtn.disabled = posCart.length === 0;
    checkoutBtn.textContent = "Complete Transaction";
    checkoutBtn.style.opacity = "";
  }
}

function changeQty(id, delta) {
  const item = posCart.find((c) => c.id === id);
  if (!item) return;
  if (delta > 0) {
    const freshItem = _posItems.find((i) => i.id === id);
    const isTracked =
      freshItem && freshItem.stock !== null && freshItem.stock !== undefined;
    if (isTracked && item.quantity >= freshItem.stock) return; // silently block; + btn is already disabled
  }
  item.quantity = Math.max(1, item.quantity + delta);
  updateCartUI();
}

function removeFromCart(id) {
  posCart = posCart.filter((c) => c.id !== id);
  updateCartUI();
}

function setPayMethod(method) {
  posPayMethod = method;
  // Fix 20: Save to localStorage so the selection persists between navigation
  try {
    localStorage.setItem("ss_pos_pay_method", method);
  } catch (e) {}
  document
    .getElementById("pay-cash")
    .classList.toggle("active", method === "cash");
  document
    .getElementById("pay-card")
    .classList.toggle("active", method === "card");
}

function handlePOSCheckout() {
  if (posCart.length === 0) return;
  // Enforce subscription before every POS transaction
  if (currentUser.role !== "super-admin" && currentUser.businessId) {
    const active = enforceSubscription(currentUser.businessId);
    if (!active) {
      toast("Subscription expired. Transactions are suspended.", "error");
      navigate("subscriptions");
      return;
    }
  }

  // Final stock validation: re-check current stock levels before completing
  refreshPOSItemCache();
  const stockErrors = [];
  for (const cartLine of posCart) {
    const freshItem = _posItems.find((i) => i.id === cartLine.id);
    if (!freshItem) {
      stockErrors.push(`"${cartLine.name}" no longer exists in inventory.`);
      continue;
    }
    const isTracked = freshItem.stock !== null && freshItem.stock !== undefined;
    if (isTracked && freshItem.stock === 0) {
      stockErrors.push(
        `"${freshItem.name}" is out of stock (0 units remaining).`
      );
    } else if (isTracked && cartLine.quantity > freshItem.stock) {
      stockErrors.push(
        `"${freshItem.name}": only ${freshItem.stock} unit${
          freshItem.stock === 1 ? "" : "s"
        } available, but ${cartLine.quantity} in cart.`
      );
    }
  }
  if (stockErrors.length > 0) {
    // Surface every stock problem at once so the cashier can fix them all in one go
    stockErrors.forEach((err) => toast(`Stock issue: ${err}`, "error"));
    // Refresh the POS grid so out-of-stock items are visually updated
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
  <select id="discount-type" class="form-select" style="height:34px;width:70px" onchange="updateDiscountPreview(${subtotal})">
    <option value="flat">${sym}</option>
    <option value="pct">%</option>
  </select>
</div>
<div style="display:flex;justify-content:space-between;font-size:20px;font-weight:900;font-family:var(--font-mono);margin-bottom:16px;padding:10px 0;border-top:2px solid var(--black)">
  <span>Total</span><span id="modal-total">${formatCurrency(subtotal)}</span>
</div>
${
  isCash
    ? `
<div style="margin-bottom:8px">
  <label style="display:block;font-size:12px;color:var(--gray-500);font-family:var(--font-mono);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">
    Amount Received <span style="color:var(--red)">*</span>
  </label>
  <input id="cash-received" type="number" min="0" step="0.01" class="form-input" style="height:40px" placeholder="Enter amount given by customer" oninput="updateChangePreview(${subtotal})" autocomplete="off"/>
  <div id="cash-received-error" style="display:none;font-size:11px;color:var(--red);margin-top:4px;font-family:var(--font-mono)">Amount received is required for cash transactions.</div>
</div>
<div id="change-preview" style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;font-family:var(--font-mono);margin-bottom:14px;padding:10px 12px;background:var(--green-bg);border:1px solid #b2d9c3;border-radius:var(--radius);display:none">
  <span>Change</span><span id="change-amount" style="color:var(--green)">${formatCurrency(
    0
  )}</span>
</div>`
    : ""
}
${
  posPayMethod === "card"
    ? `<div style="font-size:13px;color:var(--gray-500);text-align:center;margin-bottom:12px">Present card to terminal to complete payment</div>`
    : ""
}
<div style="display:flex;gap:10px;">
  <button class="btn btn-outline btn-lg" style="flex:1" onclick="closeModal()">Cancel</button>
  <button class="btn btn-primary btn-lg" style="flex:2" id="confirm-payment-btn" onclick="confirmPOSPayment('${posPayMethod}',${subtotal})">
    ${Icon.checkCircle} Confirm ${typeLabel}
  </button>
</div>
      </div>
    `
  );
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
  // Clear error state as user types a valid positive value
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

function confirmPOSPayment(type, subtotal) {
  const val = parseFloat(document.getElementById("discount-val")?.value) || 0;
  const dtype = document.getElementById("discount-type")?.value || "flat";
  // Store for receipt display
  window._posLastDiscountType = dtype;
  window._posLastDiscountVal = val;
  const discount =
    dtype === "pct"
      ? subtotal * (Math.min(val, 100) / 100)
      : Math.min(val, subtotal);
  const finalTotal = Math.max(0, subtotal - discount);
  // Cash: amount received is mandatory
  if (type === "cash") {
    const cashInput = document.getElementById("cash-received");
    const errorEl = document.getElementById("cash-received-error");
    const receivedRaw = cashInput?.value?.trim();
    const received = parseFloat(receivedRaw);
    // Must be entered and be a positive number
    if (!receivedRaw || isNaN(received) || received <= 0) {
      if (cashInput) {
        cashInput.classList.add("invalid");
        cashInput.focus();
      }
      if (errorEl) errorEl.style.display = "block";
      toast("Please enter the amount received from the customer.", "error");
      return;
    }
    // Must cover the total
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
    // Valid - clear error state
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
  // Count how many transactions were already made today for this business
  const todayCount = (store.transactions || []).filter(
    (t) =>
      t.businessId === businessId &&
      t.createdAt &&
      localDateStr(new Date(t.createdAt)) === todayStr
  ).length;
  const seq = String(todayCount + 1).padStart(4, "0");
  return `${bizName}-${seq}`;
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
    // SS-027: Decrement stock for each sold item (only when stock tracking is enabled)
    const updatedItems = d.items.map((item) => {
      const cartLine = cartSnapshot.find((c) => c.id === item.id);
      if (!cartLine) return item;
      if (item.stock === null || item.stock === undefined) return item; // stock not tracked for this item
      return { ...item, stock: Math.max(0, item.stock - cartLine.quantity) };
    });
    return {
      ...d,
      transactions: [...d.transactions, txn],
      items: updatedItems,
    };
  });
  addAuditLog(`Processed ${type} transaction`, formatCurrency(total));
  // Immediately grow the dashboard bar for today - no wait for broadcast/poll
  updateDashboardChart();
  posCart = [];
  const searchInput = document.getElementById("pos-search-input");
  if (searchInput) searchInput.value = "";
  updateCartUI();
  // Refresh cache from store BEFORE re-rendering the grid so newly-zero items show as out of stock
  refreshPOSItemCache();
  filterPOSItems();
  // Show receipt modal
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
  </div>
`
  );
}

// ============================================================
// TRANSACTIONS
// ============================================================
let txnFilterPeriod = "today"; // 'today' | 'week' | 'month' | 'all'
// Note: page title says just "Transactions" - the filter buttons below show the active period

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
      const w = new Date(now);
      w.setDate(now.getDate() - 6);
      w.setHours(0, 0, 0, 0);
      return d >= w;
    }
    if (txnFilterPeriod === "month")
      return (
        d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      );
    return true; // 'all'
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
          (p) => `
<button class="btn btn-sm ${
            txnFilterPeriod === p ? "btn-primary" : "btn-outline"
          }" onclick="setTxnFilter('${p}')">${periodLabels[p]}</button>
      `
        )
        .join("")}
    </div>
    <div class="card">
      <div class="table-wrapper">
<table>
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
        <td><strong class="text-mono">${formatCurrency(t.amount)}</strong></td>
        <td><span class="badge ${
          t.type === "cash" ? "badge-green" : "badge-blue"
        }">${t.type}</span></td>
      </tr>`
            )
            .join("")
    }
  </tbody>
</table>
      </div>
    </div>
  `;
}

function setTxnFilter(period) {
  txnFilterPeriod = period;
  renderTransactions(document.getElementById("content-area"));
}

// ============================================================
// RECEIPTS (admin)
// ============================================================
let receiptSearch = "";

function renderReceipts(area) {
  const store = getStore();
  const allTxns = store.transactions
    .filter((t) => t.businessId === currentUser.businessId && t.receiptId)
    .slice()
    .reverse(); // newest first

  area.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">Receipts</h2>
      <div class="search-box">
<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--gray-400)"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
<input id="receipt-search" type="text" placeholder="Search receipt ID or cashier..." style="padding-left:30px;height:34px" oninput="filterReceipts()" value="${sanitize(
    receiptSearch
  )}"/>
      </div>
    </div>
    <div class="card">
      <div class="table-wrapper">
<table>
  <thead>
    <tr>
      <th>Receipt ID</th>
      <th>Date & Time</th>
      <th>Cashier</th>
      <th>Items</th>
      <th>Type</th>
      <th>Discount</th>
      <th>Total</th>
      <th></th>
    </tr>
  </thead>
  <tbody id="receipts-tbody">
    ${renderReceiptRows(allTxns)}
  </tbody>
</table>
      </div>
    </div>`;
}

function renderReceiptRows(txns) {
  if (txns.length === 0)
    return `<tr><td colspan="8"><div class="empty-state">No receipts found.</div></td></tr>`;
  return txns
    .map(
      (t) => `
<tr>
  <td><span class="text-mono" style="font-size:11px;font-weight:700;color:var(--black)">${
    t.receiptId
  }</span></td>
  <td class="text-muted">${formatDate(t.createdAt)}</td>
  <td><strong>${sanitize(t.cashierName || "-")}</strong></td>
  <td class="text-muted" style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${sanitize(
    t.itemsSummary || ""
  )}">${sanitize(t.itemsSummary || "-")}</td>
  <td><span class="badge ${t.type === "cash" ? "badge-green" : "badge-blue"}">${
        t.type
      }</span></td>
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
      )}</span><span style="color:var(--gray-500)">×${match[2]}</span></div>`;
    })
    .join("")}
</div>
${
  t.discount > 0
    ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--green);padding:4px 0">
  <span>Discount${
    t.discountType
      ? " (" +
        (t.discountType === "pct" ? (t.discountPct || "") + "%" : "flat") +
        ")"
      : ""
  }</span><span>−${formatCurrency(t.discount)}</span>
</div>`
    : ""
}
<div style="display:flex;justify-content:space-between;font-size:18px;font-weight:900;padding:12px 0;border-top:2px solid var(--black);margin-top:8px">
  <span>TOTAL</span><span>${formatCurrency(t.amount)}</span>
</div>
<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--gray-500);margin-top:8px">
  <span>Payment</span><span style="font-weight:700;text-transform:uppercase">${
    t.type === "cash" ? "Cash" : "Card"
  }</span>
</div>
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
<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--gray-500);margin-top:4px">
  <span>Served by</span><span>${sanitize(t.cashierName || "-")}</span>
</div>
<div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px dashed var(--gray-200);font-size:11px;color:var(--gray-400)">
  Thank you for your purchase!
</div>
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
    <p style="font-size:13px;color:var(--gray-500);margin-bottom:16px;">
      ${
        allowed.length === 0
          ? "No statements available on the Trial plan."
          : plan === "starter"
          ? "Starter plan: Weekly statement only."
          : "Download your transaction statement."
      }
    </p>
    <button class="btn btn-outline btn-full" style="margin-bottom:8px;justify-content:flex-start;gap:10px;" onclick="downloadStatement('weekly')" ${
      allowed.includes("weekly") ? "" : "disabled"
    }>
      ${Icon.download} Weekly Statement
    </button>
    <button class="btn btn-outline btn-full" style="margin-bottom:8px;justify-content:flex-start;gap:10px;" onclick="downloadStatement('monthly')" ${
      allowed.includes("monthly") ? "" : "disabled"
    }>
      ${Icon.download} Monthly Statement
    </button>
    <button class="btn btn-outline btn-full" style="justify-content:flex-start;gap:10px;" onclick="downloadStatement('yearly')" ${
      allowed.includes("yearly") ? "" : "disabled"
    }>
      ${Icon.download} Yearly Statement
    </button>
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

  const filtered = txns.filter((t) => {
    const d = new Date(t.createdAt);
    if (period === "weekly") {
      // SS-021: Anchor the cutoff to midnight local time to avoid including up to 8 days
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

  // Excel with SheetJS - columns: Date, Amount, Type, Location, Cashier
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const currSym = biz?.currencySymbol || "R";
  const rows = [["Date", `Amount (${currSym})`, "Type", "Location", "Cashier"]];
  filtered.forEach((t) => {
    const cashier = store.users.find((u) => u.id === t.cashierId);
    const location =
      cashier && cashier.locationId
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
                (f) => `
              <div style="display:flex;align-items:center;gap:7px;font-size:12px;padding:3px 0;color:var(--gray-700)">
                <svg width="12" height="12" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                ${f}
              </div>`
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
              } Subscription cancelled - access remains until <strong>${formatDateShort(
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
            sub.status === "cancelled" && st?.active && daysLeft <= 5
              ? `<button class="btn btn-primary" onclick="handleRenew()">Renew Subscription</button>`
              : ""
          }
          ${
            biz.plan !== "trial" &&
            st?.active &&
            sub.status !== "cancelled" &&
            daysLeft <= 5
              ? `<button class="btn btn-primary" onclick="handleRenew()">Renew Subscription</button>`
              : ""
          }
          ${
            biz.plan !== "trial" && st?.active && sub.status !== "cancelled"
              ? `<button class="btn btn-danger-outline" onclick="handleCancelSub()">Cancel Subscription</button>`
              : ""
          }
          ${
            biz.plan !== "trial" &&
            st?.active &&
            sub.status !== "cancelled" &&
            daysLeft > 5
              ? `<span style="font-size:11px;color:var(--gray-500);font-family:var(--font-mono)">Renewal opens in the last 5 days of your billing period.</span>`
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

  if (biz.plan !== "trial" && sub && sub.status !== "cancelled") {
    const st = getSubStatus(biz.id);
    const daysLeft = st?.daysLeft || 0;
    const planOrder = { trial: 0, starter: 1, premium: 2 };
    const currentRank = planOrder[biz.plan] ?? 0;
    const targetRank = planOrder[targetPlan] ?? 0;
    const isDowngrade = targetRank < currentRank;
    if (!isDowngrade && daysLeft > 5 && st?.active && !st?.inGrace) {
      toast(
        "Plan changes are only available in the last 5 days of your subscription.",
        "error"
      );
      return;
    }
  }

  const planOrder = { trial: 0, starter: 1, premium: 2 };
  const currentRank = planOrder[biz.plan] ?? 0;
  const targetRank = planOrder[targetPlan] ?? 0;
  if (targetRank < currentRank) {
    const removedFeatures = [];
    if (biz.plan === "premium" && targetPlan === "starter") {
      removedFeatures.push(
        "Multi-Store (up to 3 locations) - all location data becomes inaccessible"
      );
      removedFeatures.push(
        "Audit Action Logs - log history becomes inaccessible"
      );
      removedFeatures.push(
        "Monthly & Yearly Statement Exports - only weekly export remains"
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
    <ul style="list-style:none;padding:0;background:var(--red-bg);border:1px solid #f5c0c4;border-radius:var(--radius);padding:12px">${removalList}</ul>
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
  if (newLimits.items !== Infinity && activeItems > newLimits.items) {
    overLimitWarnings.push(
      `Active items: ${activeItems} (limit: ${
        newLimits.items
      }). Please deactivate ${
        activeItems - newLimits.items
      } item(s) to stay within the plan limit.`
    );
  }
  if (newLimits.cashiers !== Infinity && activeCashiers > newLimits.cashiers) {
    overLimitWarnings.push(
      `Cashiers: ${activeCashiers} (limit: ${
        newLimits.cashiers
      }). Please suspend ${
        activeCashiers - newLimits.cashiers
      } cashier(s) to stay within the plan limit.`
    );
  }
  if (overLimitWarnings.length > 0) {
    overLimitWarnings.forEach((w) => toast(`Over limit: ${w}`, "error"));
  } else {
    toast(
      `Plan changed to ${PLAN_LIMITS[targetPlan]?.label}! Remaining days from current cycle credited.`,
      "success"
    );
  }
  buildSidebar();
  setTimeout(
    () => renderSubscriptions(document.getElementById("content-area")),
    400
  );
}

function completeRenew(newPlan) {
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
  if (!isTrial && existingSub && existingSub.expiresAt) {
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
      b.id === currentUser.businessId ? { ...b, plan: newPlan } : b
    ),
    subscriptions: d.subscriptions.map((s) =>
      s.businessId === currentUser.businessId
        ? { ...s, plan: newPlan, status: "active", expiresAt: newExpiry }
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

let _pendingRenew = null;

function _handleRenewContinue() {
  if (typeof _pendingRenew === "function") _pendingRenew();
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
    <div class="plan-card-header">
      <span class="plan-name">Starter</span>
      <span class="plan-price">R${
        PLAN_LIMITS.starter.price
      }<span>/mo</span></span>
    </div>
    <div style="font-size:10px;color:var(--blue);margin-bottom:8px;font-family:var(--font-mono)">Billed in ZAR</div>
    <ul class="plan-features">${featureList("starter")}</ul>
  </div>
  <div id="renew-plan-premium" class="plan-card" onclick="selectRenewPlan('premium')" style="cursor:pointer">
    <div class="plan-card-header">
      <span class="plan-name">Premium <span class="plan-badge-tag popular-badge">Popular</span></span>
      <span class="plan-price">R${
        PLAN_LIMITS.premium.price
      }<span>/mo</span></span>
    </div>
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

// ============================================================
// CONTACT SUPPORT
// ============================================================
function renderContact(area) {
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const senderName = sanitize(currentUser.name);
  area.innerHTML = `
  <div class="page-header"><h2 class="page-title">Contact Support</h2></div>
  <div class="card" style="max-width:500px">
    <div class="card-body">
      <div class="form-group"><label class="form-label">Business Name</label><input class="form-input" value="${sanitize(
        biz?.name || "N/A"
      )}" disabled/></div>
      <div class="form-group"><label class="form-label">Your Name</label><input class="form-input" value="${senderName}" disabled/></div>
      <div class="form-group"><label class="form-label">Email Address</label><input class="form-input" value="${
        currentUser.email || ""
      }" disabled/></div>
      <div class="form-group"><label class="form-label">Message</label><textarea id="support-msg" class="form-textarea" placeholder="How can we help you?"></textarea></div>
      <button class="btn btn-primary btn-full btn-lg" onclick="sendSupportMessage()">
        ${Icon.mail} Send Message
      </button>
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
// SETTINGS (admin)
// ============================================================
function renderSettings(area) {
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
          <div class="form-group"><label class="form-label">Business Name</label>
            <input id="s-biz-name" class="form-input" value="${sanitize(
              biz.name
            )}" placeholder="Business name"/>
          </div>
          <div class="form-group"><label class="form-label">Business Email</label>
            <input id="s-biz-email" class="form-input" type="email" value="${sanitize(
              biz.email || ""
            )}" placeholder="business@example.com"/>
          </div>
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
          <div class="form-group">
            <label class="form-label">New Password</label>
            <div class="pw-wrap"><input id="s-pass" class="form-input" type="password" placeholder="Leave blank to keep current"/>
            <button class="pw-toggle" type="button" onclick="togglePw('s-pass',this)"><svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></div>
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

// POS cart unload warning (admin page)
window.addEventListener("beforeunload", function (e) {
  if (typeof posCart !== "undefined" && posCart && posCart.length > 0) {
    e.preventDefault();
    e.returnValue =
      "You have items in the POS cart. Closing this tab will lose the cart.";
  }
});

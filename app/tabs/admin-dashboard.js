// ============================================================
// admin-dashboard.js - tab module extracted from admin.js
// Depends on shared.js (loaded first).
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
  const bucket = {};
  txns.forEach((t) => {
    if (!t.createdAt || !t.amount) return;
    const txDs = localDateStr(new Date(t.createdAt));
    bucket[txDs] = (bucket[txDs] || 0) + t.amount;
  });
  // Always show the 7 days ending today (6 days ago → today).
  // The old approach used the calendar week (Sun-Sat) which meant that on
  // Sundays every slot after index 0 was marked isFuture, leaving the chart
  // almost entirely blank. Rolling window avoids that entirely.
  return Array.from({ length: 7 }, (_, i) => {
    const slotDate = new Date(now);
    slotDate.setHours(0, 0, 0, 0);
    slotDate.setDate(slotDate.getDate() - (6 - i)); // i=0 → 6 days ago, i=6 → today
    const ds = localDateStr(slotDate);
    const isToday = i === 6;
    const isFuture = false; // rolling window never includes future dates
    const dayName = DAY_NAMES[slotDate.getDay()];
    const dateLabel =
      String(slotDate.getDate()).padStart(2, "0") +
      "/" +
      String(slotDate.getMonth() + 1).padStart(2, "0");
    const amount = bucket[ds] || 0;
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
    <div class="page-header">
      <div>
        <h2 class="page-title">Dashboard</h2>
      </div>
      <span style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono)">${new Date().toLocaleDateString(
        "en-ZA",
        { weekday: "long", day: "2-digit", month: "long", year: "numeric" }
      )}</span>
    </div>
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

  // Week label: show rolling window range e.g. "11 May – 17 May 2026"
  const startDate = weekData[0]; // 6 days ago
  const endDate = weekData[6]; // today
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
    weekLabel.textContent = `${fmt(startDate.ds)} – ${fmt(
      endDate.ds
    )} ${endDate.ds.slice(0, 4)}`;
  scheduleWeekReset();
}

let _weekResetTimer = null;

function scheduleWeekReset() {
  if (_weekResetTimer) clearTimeout(_weekResetTimer);
  // Rolling window shifts by one day at midnight, so refresh the chart then.
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setDate(now.getDate() + 1);
  nextMidnight.setHours(0, 0, 0, 0);
  _weekResetTimer = setTimeout(() => {
    if (
      activeTab === "dashboard" &&
      currentUser &&
      currentUser.role === "admin"
    )
      renderAdminDashboard(document.getElementById("content-area"));
  }, nextMidnight - now);
}

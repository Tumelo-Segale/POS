// ============================================================
// superadmin-dashboard.js - tab module extracted from super-admin.js
// Depends on shared.js (loaded first).
// ============================================================

function buildDonutSVG(
  segments,
  { size = 140, stroke = 28, centerLabel = "", centerSub = "" } = {}
) {
  const r = (size - stroke) / 2;
  const cx = size / 2,
    cy = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (total === 0) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--gray-100)" stroke-width="${stroke}"/>
      <text x="${cx}" y="${
      cy - 6
    }" text-anchor="middle" font-family="var(--font-mono)" font-size="15" font-weight="700" fill="var(--gray-300)">-</text>
      <text x="${cx}" y="${
      cy + 14
    }" text-anchor="middle" font-family="var(--font-main)" font-size="10" fill="var(--gray-300)">No data</text>
    </svg>`;
  }
  let offset = 0;
  const paths = segments.map((s) => {
    const pct = s.value / total;
    const dash = pct * circ;
    const gap = circ - dash;
    const path = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${
      s.color
    }" stroke-width="${stroke}" stroke-dasharray="${dash.toFixed(
      3
    )} ${gap.toFixed(3)}" stroke-dashoffset="${(
      (-offset * circ) /
      total
    ).toFixed(
      3
    )}" transform="rotate(-90 ${cx} ${cy})" style="transition:stroke-dasharray .4s ease"><title>${
      s.label
    }: ${s.value} (${Math.round(pct * 100)}%)</title></circle>`;
    offset += s.value;
    return path;
  });
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--gray-100)" stroke-width="${stroke}"/>
    ${paths.join("")}
    <text x="${cx}" y="${
    cy - (centerSub ? 8 : 4)
  }" text-anchor="middle" font-family="var(--font-mono)" font-size="17" font-weight="800" fill="var(--black)">${centerLabel}</text>
    ${
      centerSub
        ? `<text x="${cx}" y="${
            cy + 14
          }" text-anchor="middle" font-family="var(--font-main)" font-size="10" fill="var(--gray-400)">${centerSub}</text>`
        : ""
    }
  </svg>`;
}

function buildLegend(segments) {
  return segments
    .map(
      (s) => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
      <span style="width:10px;height:10px;border-radius:2px;background:${s.color};flex-shrink:0;display:inline-block"></span>
      <span style="font-size:12px;color:var(--gray-600);flex:1">${s.label}</span>
      <span style="font-size:12px;font-weight:700;font-family:var(--font-mono)">${s.value}</span>
    </div>`
    )
    .join("");
}

function renderSuperDashboard(area) {
  const store = getStore();
  const revenue = store.subscriptions
    .filter((s) => s.status === "active")
    .reduce((a, s) => {
      const biz = store.businesses.find((b) => b.id === s.businessId);
      if (!biz || biz.status !== "active") return a;
      const subStatus = getSubStatus(s.businessId);
      if (!subStatus || !subStatus.active) return a;
      return a + (PLAN_LIMITS[biz.plan]?.price || 0);
    }, 0);
  const active = store.businesses.filter((b) => {
    const st = getSubStatus(b.id);
    return st && st.active;
  }).length;
  const msgs = store.messages.filter((m) => !m.read).length;
  const total = store.businesses.length;
  const totalTx = store.transactions.length;
  const planCounts = { trial: 0, starter: 0, premium: 0 };
  store.businesses.forEach((b) => {
    if (planCounts[b.plan] !== undefined) planCounts[b.plan]++;
  });
  const planColors = {
    trial: "#d4a017",
    starter: "#1444a4",
    premium: "#1a7a4a",
  };
  const planSegments = Object.entries(planCounts).map(([plan, count]) => ({
    value: count,
    color: planColors[plan] || "var(--gray-300)",
    label: plan.charAt(0).toUpperCase() + plan.slice(1),
  }));
  let subHealthCounts = { active: 0, grace: 0, expired: 0, cancelled: 0 };
  store.businesses.forEach((b) => {
    const st = getSubStatus(b.id);
    if (!st) return;
    if (st.inGrace) subHealthCounts.grace++;
    else if (st.status === "cancelled") subHealthCounts.cancelled++;
    else if (!st.active) subHealthCounts.expired++;
    else subHealthCounts.active++;
  });
  const subHealthSegments = [
    { value: subHealthCounts.active, color: "#1a7a4a", label: "Active" },
    { value: subHealthCounts.grace, color: "#d4a017", label: "Grace" },
    { value: subHealthCounts.cancelled, color: "#1444a4", label: "Cancelled" },
    { value: subHealthCounts.expired, color: "#c1121f", label: "Expired" },
  ];
  const chartCard = (title, svgStr, legendHTML) => `
    <div class="card" style="flex:1;min-width:220px">
      <div class="card-header"><span class="card-title">${title}</span></div>
      <div class="card-body" style="display:flex;flex-direction:column;align-items:center;gap:16px">
        ${svgStr}
        <div style="width:100%;max-width:180px">${legendHTML}</div>
      </div>
    </div>`;
  area.innerHTML = `
    <div class="stats-grid sa-stats-grid mb-20" style="grid-template-columns:repeat(3,1fr)">
      <div class="stat-card"><div class="stat-icon">${
        Icon.credit
      }</div><div><div class="stat-label">Monthly Revenue</div><div class="stat-value">R${Number(
    revenue
  ).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}</div></div></div>
      <div class="stat-card"><div class="stat-icon">${
        Icon.dashboard
      }</div><div><div class="stat-label">Active Businesses</div><div class="stat-value">${active}</div></div></div>
      <div class="stat-card" style="cursor:pointer" onclick="showTotalTxPopup()"><div class="stat-icon">${
        Icon.history
      }</div><div><div class="stat-label">Total Transactions</div><div class="stat-value">${totalTx}</div></div></div>
    </div>
    <div class="sa-chart-row" style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px">
      ${chartCard(
        "Plan Distribution",
        buildDonutSVG(planSegments, {
          centerLabel: String(total),
          centerSub: "businesses",
        }),
        buildLegend(planSegments)
      )}
      ${chartCard(
        "Subscription Health",
        buildDonutSVG(subHealthSegments, {
          centerLabel: String(total),
          centerSub: "tracked",
        }),
        buildLegend(subHealthSegments)
      )}
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Recent Businesses</span><span style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono)">Last 10</span></div>
      <div class="table-wrapper"><table>
        <thead><tr><th>Business</th><th>Country</th><th>Type</th><th>Plan</th><th>Sub Status</th></tr></thead>
        <tbody>
          ${
            store.businesses.length === 0
              ? `<tr><td colspan="5"><div class="empty-state">No businesses yet</div></td></tr>`
              : store.businesses
                  .slice(-10)
                  .reverse()
                  .map((b) => {
                    const st = getSubStatus(b.id);
                    return `<tr>
                  <td><strong>${sanitize(
                    b.name
                  )}</strong><div class="text-muted text-sm">${sanitize(
                      b.email
                    )}</div></td>
                  <td class="text-muted text-sm">${b.country || "-"}</td>
                  <td class="text-muted text-sm">${
                    b.businessType
                      ? b.businessType.charAt(0).toUpperCase() +
                        b.businessType.slice(1)
                      : "-"
                  }</td>
                  <td><span class="badge badge-gray">${b.plan}</span></td>
                  <td>${
                    st
                      ? `<span class="badge ${st.badge}">${st.label}</span>`
                      : "-"
                  }</td>
                </tr>`;
                  })
                  .join("")
          }
        </tbody>
      </table></div>
    </div>`;
}

function showTotalTxPopup() {
  const store = getStore();
  const rows = store.businesses
    .map((b) => ({
      name: b.name,
      count: store.transactions.filter((t) => t.businessId === b.id).length,
    }))
    .sort((a, b) => b.count - a.count);
  openModal(
    "Total Transactions by Business",
    `
    <div style="max-height:400px;overflow-y:auto">
      ${
        rows.length === 0
          ? '<div class="empty-state">No businesses yet</div>'
          : `
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:1px solid var(--gray-100);background:var(--gray-50)">
          <th style="padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--gray-400);font-family:var(--font-mono)">Business Name</th>
          <th style="padding:10px 12px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--gray-400);font-family:var(--font-mono)">Transactions</th>
        </tr></thead>
        <tbody>
          ${rows
            .map(
              (r) =>
                `<tr style="border-bottom:1px solid var(--gray-50)"><td style="padding:10px 12px;font-weight:600">${sanitize(
                  r.name
                )}</td><td style="padding:10px 12px;text-align:right;font-family:var(--font-mono);font-weight:700">${
                  r.count
                }</td></tr>`
            )
            .join("")}
        </tbody>
      </table>`
      }
    </div>
    <button class="btn btn-outline btn-full" style="margin-top:16px" onclick="closeModal()">Close</button>
  `
  );
}

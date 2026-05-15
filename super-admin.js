// ============================================================
// super-admin.js - SaleStation
// Super Admin views: dashboard, businesses, messages, settings.
// renderSettings and saveSettings for super-admin are defined here.
// The shared renderSettings in shared.js routes to _renderSuperAdminSettings
// (which is this file's renderSettings renamed).
// ============================================================

// ── Donut chart helper ──────────────────────────────────────
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

let bizSearchQuery = "";

function renderBusinesses(area) {
  const store = getStore();
  let businesses = store.businesses;
  const q = bizSearchQuery.toLowerCase();
  if (q)
    businesses = businesses.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.email.toLowerCase().includes(q) ||
        (b.country || "").toLowerCase().includes(q)
    );
  area.innerHTML = `
    <div class="page-header"><h2 class="page-title">Registered Businesses</h2></div>
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
      <div style="position:relative;flex:1;min-width:200px;max-width:340px">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--gray-400);pointer-events:none"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" placeholder="Search name, email or country..." value="${sanitize(
          bizSearchQuery
        )}" oninput="bizSearchQuery=this.value;renderBusinesses(document.getElementById('content-area'))" style="width:100%;height:36px;padding:0 12px 0 32px;border:1px solid var(--gray-200);border-radius:var(--radius);font-family:var(--font-main);font-size:13px;outline:none;background:var(--white);color:var(--black);transition:border-color .15s" onfocus="this.style.borderColor='var(--black)'" onblur="this.style.borderColor='var(--gray-200)'"/>
      </div>
      <span style="font-size:12px;color:var(--gray-400);font-family:var(--font-mono);margin-left:auto">${
        businesses.length
      } of ${store.businesses.length}</span>
    </div>
    <div class="card"><div class="table-wrapper"><table>
      <thead><tr><th>Business</th><th>Email</th><th>Type</th><th>Cashiers</th><th>Plan</th><th>Sub</th></tr></thead>
      <tbody>
        ${
          businesses.length === 0
            ? `<tr><td colspan="6"><div class="empty-state">${
                store.businesses.length === 0
                  ? "No businesses registered yet"
                  : "No businesses match your search"
              }</div></td></tr>`
            : businesses
                .map((b) => {
                  const cashiersCount = store.users.filter(
                    (u) => u.businessId === b.id && u.role === "cashier"
                  ).length;
                  const st = getSubStatus(b.id);
                  const bizTypeLbl = b.businessType
                    ? b.businessType.charAt(0).toUpperCase() +
                      b.businessType.slice(1)
                    : "-";
                  return `<tr>
                <td><strong>${sanitize(b.name)}</strong></td>
                <td class="text-muted">${sanitize(b.email)}</td>
                <td class="text-muted">${bizTypeLbl}</td>
                <td>${cashiersCount}</td>
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
    </table></div></div>`;
}

function toggleBizStatus(id) {
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === id);
  const newStatus = biz?.status === "active" ? "inactive" : "active";
  if (newStatus === "active") {
    const st = getSubStatus(id);
    if (st && !st.active) {
      toast(
        "Cannot activate: this business's subscription has expired. Ask the owner to renew first.",
        "error"
      );
      return;
    }
  }
  updateStore((d) => ({
    ...d,
    businesses: d.businesses.map((b) =>
      b.id === id ? { ...b, status: newStatus } : b
    ),
    users: d.users.map((u) =>
      u.businessId === id && u.role !== "super-admin"
        ? { ...u, status: newStatus === "inactive" ? "suspended" : "active" }
        : u
    ),
    currentUser:
      newStatus === "inactive" && d.currentUser?.businessId === id
        ? null
        : d.currentUser,
  }));
  addAuditLog(
    newStatus === "inactive" ? "Deactivated business" : "Reactivated business",
    biz?.name
  );
  const area = document.getElementById("content-area");
  if (activeTab === "businesses") renderBusinesses(area);
  else if (activeTab === "dashboard") renderSuperDashboard(area);
  toast("Business status updated");
}

function renderMessages(area) {
  const msgs = getStore().messages;
  const hasUnread = msgs.filter((m) => !m.read).length > 0;
  area.innerHTML = `
    <div class="page-header"><h2 class="page-title">Support Messages</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${
          hasUnread
            ? `<button class="btn btn-outline" onclick="markAllMessagesRead()">Mark All Read</button>`
            : ""
        }
        ${
          msgs.length > 0
            ? `<button class="btn btn-danger-outline" onclick="deleteAllMessages()">${Icon.trash} Delete All</button>`
            : ""
        }
      </div>
    </div>
    <div class="card"><div class="card-body">
      ${
        msgs.length === 0
          ? '<div class="empty-state">No messages yet</div>'
          : [...msgs]
              .reverse()
              .map(
                (m) => `
          <div style="padding:14px;border:1px solid var(--gray-100);border-radius:var(--radius);margin-bottom:10px;background:${
            m.read ? "var(--white)" : "var(--blue-bg)"
          }">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:8px">
              <div>
                <div class="font-bold">${sanitize(m.businessName)} ${
                  !m.read ? '<span class="badge badge-blue">New</span>' : ""
                }</div>
                <div class="text-muted text-sm">${
                  m.senderName
                    ? sanitize(m.senderName) +
                      (m.senderRole ? " · " + m.senderRole : "") +
                      " · "
                    : ""
                }${m.email}</div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span class="text-muted text-sm">${formatDateShort(
                  m.createdAt
                )}</span>
                ${
                  !m.read
                    ? `<button class="btn btn-sm btn-outline" onclick="markMessageRead('${m.id}')">Mark Read</button>`
                    : ""
                }
                <button class="btn btn-sm btn-danger-outline" onclick="deleteMessage('${
                  m.id
                }')" title="Delete message" style="display:inline-flex;align-items:center;gap:4px">${
                  Icon.trash
                } Delete</button>
              </div>
            </div>
            <p style="font-size:13px;color:var(--gray-700)">${sanitize(
              m.message
            )}</p>
          </div>`
              )
              .join("")
      }
    </div></div>`;
}

function _refreshMessagesUI() {
  buildSidebar();
  document
    .querySelectorAll(".nav-item[data-tab]")
    .forEach((el) =>
      el.classList.toggle("active", el.dataset.tab === activeTab)
    );
  renderMessages(document.getElementById("content-area"));
}

function markMessageRead(id) {
  updateStore((d) => ({
    ...d,
    messages: d.messages.map((m) => (m.id === id ? { ...m, read: true } : m)),
  }));
  _refreshMessagesUI();
}
function markAllMessagesRead() {
  updateStore((d) => ({
    ...d,
    messages: d.messages.map((m) => ({ ...m, read: true })),
  }));
  _refreshMessagesUI();
  toast("All messages marked as read");
}
function deleteMessage(id) {
  confirm2(
    "Delete Message",
    "Are you sure you want to permanently delete this message? This cannot be undone.",
    { okLabel: "Delete", okClass: "btn-danger" }
  ).then((ok) => {
    if (!ok) return;
    updateStore((d) => ({
      ...d,
      messages: d.messages.filter((m) => m.id !== id),
    }));
    _refreshMessagesUI();
    toast("Message deleted", "success");
  });
}
function deleteAllMessages() {
  const store = getStore();
  if (store.messages.length === 0) return;
  confirm2(
    "Delete All Messages",
    `This will permanently delete all ${store.messages.length} message${
      store.messages.length === 1 ? "" : "s"
    }. This cannot be undone.`,
    { okLabel: "Delete All", okClass: "btn-danger" }
  ).then((ok) => {
    if (!ok) return;
    updateStore((d) => ({ ...d, messages: [] }));
    _refreshMessagesUI();
    toast("All messages deleted", "success");
  });
}

// ============================================================
// SETTINGS (super-admin)
// Called via shared.js renderSettings which routes here when
// currentUser.role === "super-admin".
// ============================================================
function _renderSuperAdminSettings(area) {
  area.innerHTML = `
    <div class="page-header"><h2 class="page-title">Account Settings</h2></div>
    <div style="max-width:480px">
      <div class="card">
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
    </div>`;
}

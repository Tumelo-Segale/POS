// ============================================================
// admin-audit-logs.js - tab module extracted from admin.js
// Depends on shared.js (loaded first).
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

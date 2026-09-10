// ============================================================
// superadmin-businesses.js - tab module extracted from super-admin.js
// Depends on shared.js (loaded first).
// ============================================================

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
        )}" oninput="bizSearchQuery=this.value;debounceRender(()=>renderBusinesses(document.getElementById('content-area')))" style="width:100%;height:36px;padding:0 12px 0 32px;border:1px solid var(--gray-200);border-radius:var(--radius);font-family:var(--font-main);font-size:13px;outline:none;background:var(--white);color:var(--black);transition:border-color .15s" onfocus="this.style.borderColor='var(--black)'" onblur="this.style.borderColor='var(--gray-200)'"/>
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

function toggleBizStatus(id, btn) {
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
  // Optimistic UI: flip the row's badge/label immediately so the click
  // feels instant, before the store write + full-tab re-render below.
  const row = btn ? btn.closest("tr") : null;
  const badge = row ? row.querySelector(".badge") : null;
  if (badge) {
    badge.textContent = newStatus === "active" ? "Active" : "Inactive";
    badge.className = `badge ${
      newStatus === "active" ? "badge-green" : "badge-red"
    }`;
  }
  if (btn) btn.textContent = newStatus === "active" ? "Deactivate" : "Activate";
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

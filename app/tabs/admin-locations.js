// ============================================================
// admin-locations.js - tab module extracted from admin.js
// Depends on shared.js (loaded first).
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
                  <button class="btn btn-sm btn-outline" title="Edit location" onclick="openLocationModal('${
                    l.id
                  }')">${Icon.edit}</button>
                  <button class="btn btn-sm btn-danger-outline" title="Delete location" onclick="deleteLocation('${
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

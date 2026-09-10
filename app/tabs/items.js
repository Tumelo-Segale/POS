// ============================================================
// tabs/items.js - shared tab module extracted from shared.js
// Loaded by whichever site (admin/cashier) uses this tab.
// Depends on shared.js (must be loaded first).
// ============================================================

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
  const locCell = showLocCol
    ? `<td class="text-muted text-sm">${sanitize(
        locations?.find((l) => l.id === item.locationId)?.name ||
          (item.locationId ? "Unknown" : "Shared")
      )}</td>`
    : "";
  const isAdmin = currentUser.role === "admin";
  const actionCell = isAdmin
    ? `<td><div class="td-actions">
    <button class="btn btn-sm btn-outline" title="Edit item" onclick="openItemModal('${
      item.id
    }')">${Icon.edit}</button>
    <button class="btn btn-sm ${
      item.status === "active" ? "btn-outline" : "btn-outline"
    }" onclick="toggleItemStatus('${item.id}')" title="${
        item.status === "active" ? "Deactivate" : "Activate"
      }">${item.status === "active" ? "Deactivate" : "Activate"}</button>
    <button class="btn btn-sm btn-danger-outline" title="Delete item" onclick="deleteItem('${
      item.id
    }')">${Icon.trash}</button>
  </div></td>`
    : "";
  return `<tr>
    <td><strong>${sanitize(item.name)}</strong></td>
    ${catCell}
    <td class="text-mono">${formatCurrency(item.price)}</td>
    <td class="text-mono">${renderInvStockCell(item)}</td>
    <td><span class="badge ${
      item.status === "active" ? "badge-green" : "badge-red"
    }">${item.status}</span></td>
    ${locCell}
    ${actionCell}
  </tr>`;
}

function renderItems(area) {
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const plan = biz?.plan || "starter";
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
  const isRestaurant = biz?.businessType === "restaurant";
  const isAdmin = currentUser.role === "admin";
  const cashierLocationId = currentUser.locationId || "";
  const locations = store.locations.filter(
    (l) => l.businessId === currentUser.businessId
  );
  const hasLocations = locations.length > 0;
  const allBizItems = store.items.filter(
    (i) => i.businessId === currentUser.businessId
  );
  const items = !hasLocations
    ? allBizItems
    : allBizItems.filter((i) => {
        const shared = !i.locationId;
        if (cashierLocationId)
          return shared || i.locationId === cashierLocationId;
        return isAdmin || shared;
      });
  const activeItemCount = items.filter((i) => i.status === "active").length;
  const showLocCol = isAdmin && hasLocations;
  const catFilterHTML =
    isRestaurant && isAdmin
      ? `<select id="inv-cat-filter" class="form-select" style="height:34px;width:130px" onchange="filterInventoryItems()"><option value="all">All Categories</option><option value="meals">Meals</option><option value="drinks">Drinks</option><option value="others">Others</option></select>`
      : "";
  const locBadge =
    !isAdmin && hasLocations && cashierLocationId
      ? `<span style="font-size:12px;color:var(--gray-500);font-family:var(--font-mono);margin-left:8px">${sanitize(
          locations.find((l) => l.id === cashierLocationId)?.name || ""
        )}</span>`
      : "";
  const colCount =
    (isRestaurant ? 1 : 0) + (showLocCol ? 1 : 0) + (isAdmin ? 1 : 0) + 4;
  area.innerHTML = `
  <div class="page-header">
    <h2 class="page-title">Items <span style="font-size:13px;color:var(--gray-400);font-weight:400;font-family:var(--font-main)">${activeItemCount}${
    limits.items !== Infinity ? " / " + limits.items : ""
  } active${locBadge}</span></h2>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <div class="search-box"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--gray-400)"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input id="inv-search" type="text" placeholder="Search items..." style="padding-left:30px;height:34px" oninput="filterInventoryItems()"/></div>
      ${catFilterHTML}
      <select id="inv-status-filter" class="form-select" style="height:34px;width:140px" onchange="filterInventoryItems()"><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="out-of-stock">Out of Stock</option></select>
      ${
        isAdmin
          ? `<button class="btn btn-primary" onclick="openItemModal(null)">${Icon.plus} Add Item</button>`
          : ""
      }
    </div>
  </div>
  <div class="card"><div class="table-wrapper"><table>
    <thead><tr>
      <th>Item Name</th>${isRestaurant ? "<th>Category</th>" : ""}
      <th>Price</th><th>Stock</th><th>Status</th>
      ${showLocCol ? "<th>Location</th>" : ""}
      ${isAdmin ? "<th></th>" : ""}
    </tr></thead>
    <tbody id="inv-table-body">
      ${
        items.length === 0
          ? `<tr><td colspan="${colCount}"><div class="empty-state">${
              hasLocations && cashierLocationId
                ? "No items for your location yet."
                : "No items in inventory."
            }</div></td></tr>`
          : items
              .map((item) =>
                renderInvRow(item, isRestaurant, showLocCol, locations)
              )
              .join("")
      }
    </tbody>
  </table></div></div>`;
}

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
  const isAdmin = currentUser.role === "admin";
  const cashierLocationId = currentUser.locationId || "";
  const locations = store.locations.filter(
    (l) => l.businessId === currentUser.businessId
  );
  const hasLocations = locations.length > 0;
  const showLocCol = isAdmin && hasLocations;
  const allBizItems = store.items.filter(
    (i) => i.businessId === currentUser.businessId
  );
  const items = !hasLocations
    ? allBizItems
    : allBizItems.filter((i) => {
        const shared = !i.locationId;
        if (cashierLocationId)
          return shared || i.locationId === cashierLocationId;
        return isAdmin || shared;
      });
  const filtered = items.filter((i) => {
    const matchName = i.name.toLowerCase().includes(q);
    let matchStatus;
    if (statusFilter === "out-of-stock")
      matchStatus = i.stock !== null && i.stock !== undefined && i.stock === 0;
    else matchStatus = statusFilter === "all" || i.status === statusFilter;
    const matchCat =
      !isRestaurant || catFilter === "all" || i.category === catFilter;
    return matchName && matchStatus && matchCat;
  });
  const tbody = document.getElementById("inv-table-body");
  if (!tbody) return;
  const colCount =
    (isRestaurant ? 1 : 0) + (showLocCol ? 1 : 0) + (isAdmin ? 1 : 0) + 4;
  tbody.innerHTML =
    filtered.length === 0
      ? `<tr><td colspan="${colCount}"><div class="empty-state">No items match your search.</div></td></tr>`
      : filtered
          .map((item) =>
            renderInvRow(item, isRestaurant, showLocCol, locations)
          )
          .join("");
}

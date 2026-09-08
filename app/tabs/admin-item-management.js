// ============================================================
// admin-item-management.js - tab module extracted from admin.js
// Depends on shared.js (loaded first).
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

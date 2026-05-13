// Fallback state vars for subscription flows
let _loginSubSelectedPlan = "starter";
let _renewSelectedPlan = "starter";
let completeRenewOverride = null;

// ── Utilities needed by cashier but defined in admin.js (kept here for cashier context) ──

/**
 * Returns the YYYY-MM-DD string for midnight local time on a given Date.
 * Mirrors the same function in admin.js — avoids UTC-offset edge cases near midnight.
 */
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * No-op stub so that the shared POS checkout code that calls updateDashboardChart()
 * doesn't throw a ReferenceError on the cashier page (dashboard isn't rendered here).
 */
function updateDashboardChart() {
  // Dashboard only exists on the admin page — nothing to update on cashier page.
}

// ============================================================
// cashier.js - SaleStation
// Cashier views: POS, my orders, settings
// Loaded by: cashier.html only
// ============================================================

// POS
// ============================================================
let posCart = [];
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
      toast(
        "Subscription expired. Contact your administrator to renew.",
        "error"
      );
      navigate("contact");
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
  if (typeof updateDashboardChart === "function") updateDashboardChart();
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

// ============================================================
// ITEMS (read-only view for cashier — write actions are role-gated inside)
// ============================================================
function renderItems(area) {
  const store = getStore();
  const items = store.items.filter(
    (i) => i.businessId === currentUser.businessId
  );
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const plan = biz?.plan || "starter";
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
  const isRestaurant = biz?.businessType === "restaurant";
  const activeItemCount = items.filter((i) => i.status === "active").length;

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

  area.innerHTML = `
  <div class="page-header">
    <h2 class="page-title">Items <span style="font-size:13px;color:var(--gray-400);font-weight:400;font-family:var(--font-main)">${activeItemCount}${
    limits.items !== Infinity ? " / " + limits.items : ""
  } active</span></h2>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <div class="search-box"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--gray-400)"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input id="inv-search" type="text" placeholder="Search items..." style="padding-left:30px;height:34px" oninput="filterInventoryItems()" /></div>
      ${catFilterHTML}
      <select id="inv-status-filter" class="form-select" style="height:34px;width:140px" onchange="filterInventoryItems()">
        <option value="all">All</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="out-of-stock">Out of Stock</option>
      </select>
    </div>
  </div>
  <div class="card">
    <div class="table-wrapper">
      <table>
        <thead><tr><th>Item Name</th>${
          isRestaurant ? "<th>Category</th>" : ""
        }<th>Price</th><th>Stock</th><th>Status</th></tr></thead>
        <tbody id="inv-table-body">
          ${
            items.length === 0
              ? `<tr><td colspan="${
                  isRestaurant ? 5 : 4
                }"><div class="empty-state">No items in inventory.</div></td></tr>`
              : items.map((item) => renderInvRow(item, isRestaurant)).join("")
          }
        </tbody>
      </table>
    </div>
  </div>`;
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

function renderInvRow(item, isRestaurant) {
  const catLabels = { meals: "Meals", drinks: "Drinks", others: "Others" };
  const catCell = isRestaurant
    ? `<td><span class="badge badge-gray">${
        catLabels[item.category] || item.category || "-"
      }</span></td>`
    : "";
  return `<tr>
    <td><strong>${sanitize(item.name)}</strong></td>
    ${catCell}
    <td class="text-mono">${formatCurrency(item.price)}</td>
    <td class="text-mono">${renderInvStockCell(item)}</td>
    <td><span class="badge ${
      item.status === "active" ? "badge-green" : "badge-red"
    }">${item.status}</span></td>
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
  const items = store.items.filter(
    (i) => i.businessId === currentUser.businessId
  );
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
  const cols = isRestaurant ? 5 : 4;
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${cols}"><div class="empty-state">No items match your search.</div></td></tr>`;
  } else {
    tbody.innerHTML = filtered
      .map((item) => renderInvRow(item, isRestaurant))
      .join("");
  }
}

// Contact Support (cashier)
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

// ORDERS (cashier)
// ============================================================
function renderOrders(area) {
  const store = getStore();
  // SS-002: Use local date string (not UTC ISO slice) to avoid midnight-SAST drift
  const today = localDateStr(new Date());
  const txns = store.transactions.filter(
    (t) =>
      t.businessId === currentUser.businessId &&
      t.cashierId === currentUser.id &&
      localDateStr(new Date(t.createdAt)) === today
  );
  const dayTotal = txns.reduce((a, t) => a + t.amount, 0);

  area.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">My Orders</h2>
    </div>
    <div class="stats-grid stats-grid-2 mb-20">
      <div class="stat-card"><div class="stat-icon">${
        Icon.cart
      }</div><div><div class="stat-label">Orders Today</div><div class="stat-value">${
    txns.length
  }</div></div></div>
      <div class="stat-card"><div class="stat-icon">${
        Icon.credit
      }</div><div><div class="stat-label">Today's Total</div><div class="stat-value">${formatCurrency(
    dayTotal
  )}</div></div></div>
    </div>
    <div class="card">
      <div class="table-wrapper">
<table>
  <thead><tr><th>Time</th><th>Receipt</th><th>Amount</th><th>Items</th><th>Type</th></tr></thead>
  <tbody>
    ${
      txns.length === 0
        ? `<tr><td colspan="5"><div class="empty-state">No orders today.</div></td></tr>`
        : [...txns]
            .reverse()
            .map(
              (t) => `<tr>
        <td class="text-muted">${formatDate(t.createdAt)}</td>
        <td><span class="text-mono" style="font-size:11px;color:var(--gray-500)">${
          t.receiptId || "-"
        }</span></td>
        <td><strong class="text-mono">${formatCurrency(t.amount)}</strong></td>
        <td class="text-muted text-sm">${t.itemsSummary || "-"}</td>
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

// ============================================================

// SETTINGS
// ============================================================
function renderSettings(area) {
  const store = getStore();
  const biz = currentUser.businessId
    ? store.businesses.find((b) => b.id === currentUser.businessId)
    : null;
  const sub = biz
    ? store.subscriptions.find((s) => s.businessId === biz.id)
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
<!-- SS-016: Business details section - admin only -->
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
      <div class="card" style="border-color:var(--red);background:var(--red-bg); margin-bottom: 4px">
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
    </div>
  `;
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
  // Email uniqueness check (excluding self)
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

// ============================================================
// BOOT
// ============================================================

// SS-007: updatePlanPriceDisplay() is defined in auth.js — only call on auth.html
if (typeof updatePlanPriceDisplay === "function") updatePlanPriceDisplay();

// POS cart unload warning (cashier page)
window.addEventListener("beforeunload", function (e) {
  if (posCart && posCart.length > 0) {
    e.preventDefault();
    e.returnValue =
      "You have items in the POS cart. Closing this tab will lose the cart.";
  }
});

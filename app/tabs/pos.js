// ============================================================
// tabs/pos.js - shared tab module extracted from shared.js
// Loaded by whichever site (admin/cashier) uses this tab.
// Depends on shared.js (must be loaded first).
// ============================================================

function refreshPOSItemCache() {
  _posItems = getStore().items.filter(
    (i) => i.businessId === currentUser.businessId && i.status === "active"
  );
}

function refreshPOSItemsOnly() {
  if (activeTab !== "pos") return;
  refreshPOSItemCache();
  const q = (
    document.getElementById("pos-search-input")?.value || ""
  ).toLowerCase();
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const isRestaurant = biz?.businessType === "restaurant";
  let filtered = _posItems.filter((i) => i.name.toLowerCase().includes(q));
  if (isRestaurant && _posActiveCat !== "all")
    filtered = filtered.filter((i) => i.category === _posActiveCat);
  const grid = document.getElementById("pos-items-grid");
  if (grid) grid.innerHTML = renderPOSItemsHTML(filtered);
}

function renderPOS(area) {
  refreshPOSItemCache();
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const isRestaurant = biz?.businessType === "restaurant";
  area.style.padding = "0";
  area.style.overflow = "hidden";
  const sym = getCurrencySymbol();
  // Category label map for display
  const CAT_LABELS = {
    all: "All",
    meals: "Meals",
    drinks: "Drinks",
    others: "Others",
  };
  const catTabs = isRestaurant
    ? `
    <div class="pos-cat-tabs">
      ${["all", "meals", "drinks", "others"]
        .map(
          (c) =>
            `<button class="btn btn-sm pos-cat-btn${
              _posActiveCat === c ? " active-cat" : " btn-outline"
            }" data-cat="${c}" onclick="setPOSCat('${c}')">${
              CAT_LABELS[c]
            }</button>`
        )
        .join("")}
    </div>`
    : "";
  area.innerHTML = `
<div class="pos-layout">
  <div class="pos-items-panel">
    ${catTabs}
    <div class="pos-search">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input id="pos-search-input" type="text" placeholder="Search items…" oninput="filterPOSItems()" autocomplete="off"/>
    </div>
    <div class="pos-items-grid" id="pos-items-grid">
      ${renderPOSItemsHTML(_posItems)}
    </div>
  </div>
  <div class="pos-cart" id="pos-cart-panel">
    <div class="pos-cart-header">${Icon.cart} Cart
      <div class="pos-cart-header-right">
        <span id="pos-cart-count" style="font-size:11px;color:var(--gray-400)"></span>
        <button class="pos-cart-close-btn" onclick="toggleMobileCart(false)" aria-label="Close cart">${
          Icon.close || "&times;"
        }</button>
      </div>
    </div>
    <div class="pos-cart-items" id="pos-cart-items"></div>
    <div class="pos-cart-footer">
      <div class="total-row"><span class="total-label">Subtotal</span><span class="total-amount text-mono" id="pos-subtotal">${sym}0.00</span></div>
      <div class="total-row" style="border-top:2px solid var(--black);padding-top:10px;margin-top:4px">
        <span class="grand-total-label">Total</span>
        <span class="grand-total-amount" id="pos-total">${sym}0.00</span>
      </div>
      <div class="payment-toggle">
        <button class="pay-btn${
          posPayMethod === "cash" ? " active" : ""
        }" id="pay-btn-cash" onclick="setPayMethod('cash')">Cash</button>
        <button class="pay-btn${
          posPayMethod === "card" ? " active" : ""
        }" id="pay-btn-card" onclick="setPayMethod('card')">Card</button>
      </div>
      <button class="btn btn-primary btn-full btn-lg" onclick="handlePOSCheckout()">${
        Icon.cart
      } Checkout</button>
    </div>
  </div>
  <div class="pos-cart-backdrop" id="pos-cart-backdrop" onclick="toggleMobileCart(false)"></div>
  <button class="pos-cart-fab" id="pos-cart-fab" onclick="toggleMobileCart(true)" aria-label="View cart">
    ${Icon.cart}
    <span class="pos-cart-fab-badge" id="pos-cart-fab-badge"></span>
  </button>
</div>`;
  updateCartUI();
}

function toggleMobileCart(show) {
  const cart = document.getElementById("pos-cart-panel");
  const backdrop = document.getElementById("pos-cart-backdrop");
  if (!cart) return;
  const shouldShow =
    typeof show === "boolean" ? show : !cart.classList.contains("mobile-open");
  cart.classList.toggle("mobile-open", shouldShow);
  if (backdrop) backdrop.classList.toggle("mobile-open", shouldShow);
}

function renderPOSItemsHTML(items) {
  if (items.length === 0)
    return `<div style="grid-column:1/-1;text-align:center;padding:40px 20px;color:var(--gray-400);font-size:13px">No items found.</div>`;
  return items
    .map((item) => {
      const outOfStock =
        item.stock !== null && item.stock !== undefined && item.stock === 0;
      const lowStock =
        !outOfStock &&
        item.stock !== null &&
        item.stock !== undefined &&
        item.stock <= 5;
      const cartLine = posCart.find((c) => c.id === item.id);
      const qty = cartLine ? cartLine.quantity : 0;
      // Use proper CSS classes: pos-item-btn (has border), pos-item-btn.pos-item-out-of-stock (greyed), pos-item-btn.pos-item-low-stock (amber)
      let cls = "pos-item-btn";
      if (outOfStock) cls += " pos-item-out-of-stock";
      else if (lowStock) cls += " pos-item-low-stock";
      return `<button class="${cls}" data-id="${
        item.id
      }" onclick="addToCartById(this)" ${
        outOfStock ? 'disabled aria-disabled="true"' : ""
      } type="button">
      <span class="pos-item-name">${sanitize(item.name)}</span>
      <span class="pos-item-price">${formatCurrency(item.price)}</span>
    </button>`;
    })
    .join("");
}

function filterPOSItems() {
  clearTimeout(_posFilterTimer);
  _posFilterTimer = setTimeout(_doFilterPOS, 80);
}

function _doFilterPOS() {
  const q = (
    document.getElementById("pos-search-input")?.value || ""
  ).toLowerCase();
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const isRestaurant = biz?.businessType === "restaurant";
  let filtered = _posItems.filter((i) => i.name.toLowerCase().includes(q));
  if (isRestaurant && _posActiveCat !== "all")
    filtered = filtered.filter((i) => i.category === _posActiveCat);
  const grid = document.getElementById("pos-items-grid");
  if (grid) grid.innerHTML = renderPOSItemsHTML(filtered);
}

function setPOSCat(cat) {
  _posActiveCat = cat;
  // Update only the tab button states — no full POS re-render
  document.querySelectorAll(".pos-cat-btn").forEach((btn) => {
    const isActive = btn.dataset.cat === cat;
    btn.className =
      "btn btn-sm pos-cat-btn" + (isActive ? " active-cat" : " btn-outline");
  });
  // Update only the items grid
  const q = (
    document.getElementById("pos-search-input")?.value || ""
  ).toLowerCase();
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const isRestaurant = biz?.businessType === "restaurant";
  let filtered = _posItems.filter((i) => i.name.toLowerCase().includes(q));
  if (isRestaurant && cat !== "all")
    filtered = filtered.filter((i) => i.category === cat);
  const grid = document.getElementById("pos-items-grid");
  if (grid) grid.innerHTML = renderPOSItemsHTML(filtered);
}

function setPayMethod(method) {
  posPayMethod = method;
  try {
    localStorage.setItem("ss_pos_pay_method", method);
  } catch (e) {}
  // Toggle only the pay button states — no full POS re-render
  const cashBtn = document.getElementById("pay-btn-cash");
  const cardBtn = document.getElementById("pay-btn-card");
  if (cashBtn)
    cashBtn.className = "pay-btn" + (method === "cash" ? " active" : "");
  if (cardBtn)
    cardBtn.className = "pay-btn" + (method === "card" ? " active" : "");
}

function addToCartById(btn) {
  const id = btn.dataset?.id || btn.getAttribute("data-id");
  if (id) addToCart(id, btn);
}

function addToCart(id, sourceBtn) {
  const store = getStore();
  const item = store.items.find((i) => i.id === id);
  if (!item || item.status !== "active") return;
  if (item.stock !== null && item.stock !== undefined && item.stock === 0) {
    toast("This item is out of stock", "error");
    return;
  }
  const existing = posCart.find((c) => c.id === id);
  if (existing) {
    if (
      item.stock !== null &&
      item.stock !== undefined &&
      existing.quantity >= item.stock
    ) {
      toast(`Only ${item.stock} in stock`, "error");
      return;
    }
    existing.quantity++;
  } else {
    posCart.push({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: 1,
    });
  }
  // Flash animation on the clicked button
  if (sourceBtn) {
    sourceBtn.classList.remove("flash");
    void sourceBtn.offsetWidth; // force reflow to restart animation
    sourceBtn.classList.add("flash");
    setTimeout(() => sourceBtn.classList.remove("flash"), 400);
  } else {
    refreshPOSItemsOnly();
  }
  updateCartUI();
}

function changeQty(id, delta) {
  const line = posCart.find((c) => c.id === id);
  if (!line) return;
  line.quantity += delta;
  if (line.quantity <= 0) posCart = posCart.filter((c) => c.id !== id);
  updateCartUI();
  refreshPOSItemsOnly();
}

function removeFromCart(id) {
  posCart = posCart.filter((c) => c.id !== id);
  updateCartUI();
  refreshPOSItemsOnly();
}

function updateCartUI() {
  const cartEl = document.getElementById("pos-cart-items");
  const subtotalEl = document.getElementById("pos-subtotal");
  const totalEl = document.getElementById("pos-total");
  const countEl = document.getElementById("pos-cart-count");
  const fabBadge = document.getElementById("pos-cart-fab-badge");
  if (!cartEl) return;
  const subtotal = posCart.reduce((a, c) => a + c.price * c.quantity, 0);
  const totalQty = posCart.reduce((a, c) => a + c.quantity, 0);
  if (countEl)
    countEl.textContent =
      totalQty > 0 ? `${totalQty} item${totalQty === 1 ? "" : "s"}` : "";
  if (fabBadge) {
    if (totalQty > 0) {
      fabBadge.textContent = totalQty > 99 ? "99+" : String(totalQty);
      fabBadge.style.display = "flex";
    } else {
      fabBadge.textContent = "";
      fabBadge.style.display = "none";
    }
  }
  if (posCart.length === 0) {
    cartEl.innerHTML = `<div class="cart-empty-state"><svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg><span>Cart is empty</span></div>`;
  } else {
    cartEl.innerHTML = posCart
      .map(
        (c) => `
      <div class="pos-cart-item">
        <div class="pos-cart-item-info">
          <div class="pos-cart-item-name">${sanitize(c.name)}</div>
          <div class="pos-cart-item-price">${formatCurrency(c.price)}</div>
        </div>
        <div class="qty-ctrl">
          <button class="qty-btn" onclick="changeQty('${
            c.id
          }',-1)" aria-label="Decrease">−</button>
          <span class="qty-num">${c.quantity}</span>
          <button class="qty-btn" onclick="changeQty('${
            c.id
          }',1)" aria-label="Increase">+</button>
        </div>
        <button class="cart-remove-btn" onclick="removeFromCart('${
          c.id
        }')" aria-label="Remove">${Icon.trash}</button>
      </div>`
      )
      .join("");
  }
  if (subtotalEl) subtotalEl.textContent = formatCurrency(subtotal);
  if (totalEl) totalEl.textContent = formatCurrency(subtotal);
}

function handlePOSCheckout() {
  if (!currentUser.businessId) return;
  if (currentUser.role !== "super-admin") {
    const active = enforceSubscription(currentUser.businessId);
    if (!active) {
      toast("Subscription expired. POS transactions are suspended.", "error");
      navigate(currentUser.role === "cashier" ? "contact" : "subscriptions");
      return;
    }
  }
  if (posCart.length === 0) {
    toast("Add items to the cart first", "error");
    return;
  }
  const store = getStore();
  const stockErrors = [];
  for (const cartLine of posCart) {
    const freshItem = store.items.find((i) => i.id === cartLine.id);
    if (
      freshItem &&
      freshItem.stock !== null &&
      freshItem.stock !== undefined &&
      freshItem.stock < cartLine.quantity
    ) {
      stockErrors.push(
        `${sanitize(freshItem.name)}: only ${freshItem.stock} unit${
          freshItem.stock === 1 ? "" : "s"
        } available, but ${cartLine.quantity} in cart.`
      );
    }
  }
  if (stockErrors.length > 0) {
    stockErrors.forEach((err) => toast(`Stock issue: ${err}`, "error"));
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
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
        <label style="font-size:12px;color:var(--gray-500);white-space:nowrap;font-family:var(--font-mono);font-weight:600;text-transform:uppercase;letter-spacing:.06em">Discount</label>
        <input id="discount-val" type="number" min="0" class="form-input" style="height:34px;width:90px" placeholder="0" oninput="updateDiscountPreview(${subtotal})"/>
        <select id="discount-type" class="form-select" style="height:34px;width:70px" onchange="updateDiscountPreview(${subtotal})"><option value="flat">${sym}</option><option value="pct">%</option></select>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:20px;font-weight:900;font-family:var(--font-mono);margin-bottom:16px;padding:10px 0;border-top:2px solid var(--black)"><span>Total</span><span id="modal-total">${formatCurrency(
        subtotal
      )}</span></div>
      ${
        isCash
          ? `
      <div style="margin-bottom:8px">
        <label style="display:block;font-size:12px;color:var(--gray-500);font-family:var(--font-mono);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">Amount Received <span style="color:var(--red)">*</span></label>
        <input id="cash-received" type="number" min="0" step="0.01" class="form-input" style="height:40px" placeholder="Enter amount given by customer" oninput="updateChangePreview(${subtotal})" autocomplete="off"/>
        <div id="cash-received-error" style="display:none;font-size:11px;color:var(--red);margin-top:4px;font-family:var(--font-mono)">Amount received is required for cash transactions.</div>
      </div>
      <div id="change-preview" style="display:none;justify-content:space-between;font-size:15px;font-weight:700;font-family:var(--font-mono);margin-bottom:14px;padding:10px 12px;background:var(--green-bg);border:1px solid #b2d9c3;border-radius:var(--radius)">
        <span>Change</span><span id="change-amount" style="color:var(--green)">${formatCurrency(
          0
        )}</span>
      </div>`
          : `<div style="font-size:13px;color:var(--gray-500);text-align:center;margin-bottom:12px">Present card to terminal to complete payment</div>`
      }
      <div style="display:flex;gap:10px">
        <button class="btn btn-outline btn-lg" style="flex:1" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary btn-lg" style="flex:2" onclick="confirmPOSPayment('${posPayMethod}',${subtotal})">${
      Icon.checkCircle
    } Confirm ${typeLabel}</button>
      </div>
    </div>`
  );
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

function confirmPOSPayment(type, subtotal) {
  const val = parseFloat(document.getElementById("discount-val")?.value) || 0;
  const dtype = document.getElementById("discount-type")?.value || "flat";
  window._posLastDiscountType = dtype;
  window._posLastDiscountVal = val;
  const discount =
    dtype === "pct"
      ? subtotal * (Math.min(val, 100) / 100)
      : Math.min(val, subtotal);
  const finalTotal = Math.max(0, subtotal - discount);
  if (type === "cash") {
    const cashInput = document.getElementById("cash-received");
    const errorEl = document.getElementById("cash-received-error");
    const receivedRaw = cashInput?.value?.trim();
    const received = parseFloat(receivedRaw);
    if (!receivedRaw || isNaN(received) || received <= 0) {
      if (cashInput) {
        cashInput.classList.add("invalid");
        cashInput.focus();
      }
      if (errorEl) errorEl.style.display = "block";
      toast("Please enter the amount received from the customer.", "error");
      return;
    }
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
  // Include date in the ID format: BIZX-YYYYMMDD-0001 so receipts are unique across days
  const todayCompact = todayStr.replace(/-/g, "");
  const todayCount = (store.transactions || []).filter(
    (t) =>
      t.businessId === businessId &&
      t.createdAt &&
      localDateStr(new Date(t.createdAt)) === todayStr
  ).length;
  const seq = String(todayCount + 1).padStart(4, "0");
  return `${bizName}-${todayCompact}-${seq}`;
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
    const updatedItems = d.items.map((item) => {
      const cartLine = cartSnapshot.find((c) => c.id === item.id);
      if (!cartLine) return item;
      if (item.stock === null || item.stock === undefined) return item;
      return { ...item, stock: Math.max(0, item.stock - cartLine.quantity) };
    });
    return {
      ...d,
      transactions: [...d.transactions, txn],
      items: updatedItems,
    };
  });
  addAuditLog(`Processed ${type} transaction`, formatCurrency(total));
  // Update dashboard chart live if it's currently visible (admin only)
  if (typeof updateDashboardChart === "function" && activeTab === "dashboard")
    updateDashboardChart();
  posCart = [];
  const searchInput = document.getElementById("pos-search-input");
  if (searchInput) searchInput.value = "";
  updateCartUI();
  refreshPOSItemCache();
  filterPOSItems();
  toggleMobileCart(false);
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
    </div>`
  );
}

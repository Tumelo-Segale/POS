// ============================================================
// cashier.js - SaleStation
// Cashier-only views: My Orders.
// All other functions (POS, Inventory, Contact, Settings,
// Paystack/subscription state) are now in shared.js.
// ============================================================

// updateDashboardChart is called from shared.js recordTransaction.
// On the cashier page there is no dashboard, so this is a no-op stub.
function updateDashboardChart() {}

// ============================================================
// MY ORDERS (cashier-only view)
// ============================================================
function renderOrders(area) {
  const store = getStore();
  const today = localDateStr(new Date());
  const txns = store.transactions.filter(
    (t) =>
      t.businessId === currentUser.businessId &&
      t.cashierId === currentUser.id &&
      localDateStr(new Date(t.createdAt)) === today
  );
  const dayTotal = txns.reduce((a, t) => a + t.amount, 0);
  area.innerHTML = `
    <div class="page-header"><h2 class="page-title">My Orders</h2></div>
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
    <div class="card"><div class="table-wrapper"><table>
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
              <td><strong class="text-mono">${formatCurrency(
                t.amount
              )}</strong></td>
              <td class="text-muted text-sm">${sanitize(
                t.itemsSummary || "-"
              )}</td>
              <td><span class="badge ${
                t.type === "cash" ? "badge-green" : "badge-blue"
              }">${t.type}</span></td>
            </tr>`
                )
                .join("")
        }
      </tbody>
    </table></div></div>`;
}

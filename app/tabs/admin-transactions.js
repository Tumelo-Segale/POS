// ============================================================
// admin-transactions.js - tab module extracted from admin.js
// Depends on shared.js (loaded first).
// ============================================================

let txnFilterPeriod = "today";

function renderTransactions(area) {
  const store = getStore();
  const allTxns = store.transactions.filter(
    (t) => t.businessId === currentUser.businessId
  );
  const now = new Date();
  const today = localDateStr(now);
  const filtered = allTxns.filter((t) => {
    const d = new Date(t.createdAt);
    if (txnFilterPeriod === "today") return localDateStr(d) === today;
    if (txnFilterPeriod === "week") {
      // downloadStatement("weekly") definition for consistency.
      const w = new Date(now);
      w.setDate(now.getDate() - 6);
      w.setHours(0, 0, 0, 0);
      return d >= w;
    }
    if (txnFilterPeriod === "month")
      return (
        d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      );
    return true;
  });
  const periodLabels = {
    today: "Today",
    week: "Last 7 Days",
    month: "This Month",
    all: "All Time",
  };
  area.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">Transactions</h2>
      <button class="btn btn-outline" onclick="openStatementsModal()">${
        Icon.download
      } Download Statement</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
      ${["today", "week", "month", "all"]
        .map(
          (p) =>
            `<button class="btn btn-sm ${
              txnFilterPeriod === p ? "btn-primary" : "btn-outline"
            }" onclick="setTxnFilter('${p}')">${periodLabels[p]}</button>`
        )
        .join("")}
    </div>
    <div class="card"><div class="table-wrapper"><table>
      <thead><tr><th>Date & Time</th><th>Receipt</th><th>Cashier</th><th>Amount</th><th>Type</th></tr></thead>
      <tbody>
        ${
          filtered.length === 0
            ? `<tr><td colspan="5"><div class="empty-state">No transactions for ${periodLabels[
                txnFilterPeriod
              ].toLowerCase()}</div></td></tr>`
            : [...filtered]
                .reverse()
                .map(
                  (t) => `<tr>
              <td class="text-muted">${formatDate(t.createdAt)}</td>
              <td><span class="text-mono" style="font-size:11px;color:var(--gray-500)">${
                t.receiptId || "-"
              }</span></td>
              <td>${sanitize(t.cashierName || "-")}</td>
              <td><strong class="text-mono">${formatCurrency(
                t.amount
              )}</strong></td>
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

function setTxnFilter(period) {
  txnFilterPeriod = period;
  renderTransactions(document.getElementById("content-area"));
}

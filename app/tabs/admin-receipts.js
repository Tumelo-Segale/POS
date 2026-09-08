// ============================================================
// admin-receipts.js - tab module extracted from admin.js
// Depends on shared.js (loaded first).
// ============================================================

let receiptSearch = "";

function renderReceipts(area) {
  const store = getStore();
  const allTxns = store.transactions
    .filter((t) => t.businessId === currentUser.businessId && t.receiptId)
    .slice()
    .reverse();
  area.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">Receipts</h2>
      <div class="search-box"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--gray-400)"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input id="receipt-search" type="text" placeholder="Search receipt ID or cashier..." style="padding-left:30px;height:34px" oninput="filterReceipts()" value="${sanitize(
        receiptSearch
      )}"/></div>
    </div>
    <div class="card"><div class="table-wrapper"><table>
      <thead><tr><th>Receipt ID</th><th>Date & Time</th><th>Cashier</th><th>Items</th><th>Type</th><th>Discount</th><th>Total</th><th></th></tr></thead>
      <tbody id="receipts-tbody">${renderReceiptRows(allTxns)}</tbody>
    </table></div></div>`;
}

function renderReceiptRows(txns) {
  if (txns.length === 0)
    return `<tr><td colspan="8"><div class="empty-state">No receipts found.</div></td></tr>`;
  return txns
    .map(
      (t) => `<tr>
    <td><span class="text-mono" style="font-size:11px;font-weight:700;color:var(--black)">${
      t.receiptId
    }</span></td>
    <td class="text-muted">${formatDate(t.createdAt)}</td>
    <td><strong>${sanitize(t.cashierName || "-")}</strong></td>
    <td class="text-muted" style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${sanitize(
      t.itemsSummary || ""
    )}">${sanitize(t.itemsSummary || "-")}</td>
    <td><span class="badge ${
      t.type === "cash" ? "badge-green" : "badge-blue"
    }">${t.type}</span></td>
    <td class="text-mono" style="color:var(--green)">${
      t.discount > 0 ? "−" + formatCurrency(t.discount) : "-"
    }</td>
    <td><strong class="text-mono">${formatCurrency(t.amount)}</strong></td>
    <td><button class="btn btn-sm btn-outline" onclick="viewReceiptDetail('${
      t.id
    }')">${Icon.receipt} View</button></td>
  </tr>`
    )
    .join("");
}

function filterReceipts() {
  receiptSearch = (
    document.getElementById("receipt-search")?.value || ""
  ).toLowerCase();
  const store = getStore();
  const allTxns = store.transactions
    .filter((t) => t.businessId === currentUser.businessId && t.receiptId)
    .slice()
    .reverse();
  const filtered = receiptSearch
    ? allTxns.filter(
        (t) =>
          (t.receiptId || "").toLowerCase().includes(receiptSearch) ||
          (t.cashierName || "").toLowerCase().includes(receiptSearch) ||
          (t.itemsSummary || "").toLowerCase().includes(receiptSearch)
      )
    : allTxns;
  const tbody = document.getElementById("receipts-tbody");
  if (tbody) tbody.innerHTML = renderReceiptRows(filtered);
}

function viewReceiptDetail(txnId) {
  const store = getStore();
  const t = store.transactions.find((tx) => tx.id === txnId);
  if (!t) return;
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  openModal(
    `Receipt - ${t.receiptId}`,
    `
    <div style="font-family:var(--font-mono);padding:8px 0">
      <div style="text-align:center;margin-bottom:20px;padding-bottom:16px;border-bottom:2px dashed var(--gray-200)">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--gray-400);margin-bottom:4px">${sanitize(
          biz?.name || "SaleStation"
        )}</div>
        <div style="font-size:20px;font-weight:900;letter-spacing:.04em">${
          t.receiptId
        }</div>
        <div style="font-size:11px;color:var(--gray-500);margin-top:4px">${formatDate(
          t.createdAt
        )}</div>
      </div>
      <div style="margin-bottom:16px">
        ${(t.itemsSummary || "")
          .split(", ")
          .map((line) => {
            const match = line.match(/^(.+)\s×(\d+)$/);
            if (!match)
              return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--gray-50);font-size:13px"><span>${sanitize(
                line
              )}</span></div>`;
            return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--gray-50);font-size:13px"><span>${sanitize(
              match[1]
            )}</span><span style="color:var(--gray-500)">×${
              match[2]
            }</span></div>`;
          })
          .join("")}
      </div>
      ${
        t.discount > 0
          ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--green);padding:4px 0"><span>Discount${
              t.discountType
                ? " (" +
                  (t.discountType === "pct"
                    ? (t.discountPct || "") + "%"
                    : "flat") +
                  ")"
                : ""
            }</span><span>−${formatCurrency(t.discount)}</span></div>`
          : ""
      }
      <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:900;padding:12px 0;border-top:2px solid var(--black);margin-top:8px"><span>TOTAL</span><span>${formatCurrency(
        t.amount
      )}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--gray-500);margin-top:8px"><span>Payment</span><span style="font-weight:700;text-transform:uppercase">${
        t.type === "cash" ? "Cash" : "Card"
      }</span></div>
      ${
        t.type === "cash" && t.amountReceived
          ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--gray-500);margin-top:4px"><span>Amount Received</span><span class="text-mono">${formatCurrency(
              t.amountReceived
            )}</span></div>`
          : ""
      }
      ${
        t.type === "cash" && t.change != null
          ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--green);font-weight:700;margin-top:4px"><span>Change</span><span>${formatCurrency(
              t.change
            )}</span></div>`
          : ""
      }
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--gray-500);margin-top:4px"><span>Served by</span><span>${sanitize(
        t.cashierName || "-"
      )}</span></div>
      <div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px dashed var(--gray-200);font-size:11px;color:var(--gray-400)">Thank you for your purchase!</div>
    </div>
    <button class="btn btn-outline btn-full" style="margin-top:16px" onclick="closeModal()">Close</button>
  `
  );
}

function openStatementsModal() {
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const plan = biz?.plan || "trial";
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.trial;
  const allowed = limits.statements || [];
  openModal(
    "Download Statement",
    `
    <p style="font-size:13px;color:var(--gray-500);margin-bottom:16px">${
      allowed.length === 0
        ? "No statements available on the Trial plan."
        : plan === "starter"
        ? "Starter plan: Weekly statement only."
        : "Download your transaction statement."
    }</p>
    <button class="btn btn-outline btn-full" style="margin-bottom:8px;justify-content:flex-start;gap:10px" onclick="downloadStatement('weekly')" ${
      allowed.includes("weekly") ? "" : "disabled"
    }>${Icon.download} Weekly Statement</button>
    <button class="btn btn-outline btn-full" style="margin-bottom:8px;justify-content:flex-start;gap:10px" onclick="downloadStatement('monthly')" ${
      allowed.includes("monthly") ? "" : "disabled"
    }>${Icon.download} Monthly Statement</button>
    <button class="btn btn-outline btn-full" style="justify-content:flex-start;gap:10px" onclick="downloadStatement('yearly')" ${
      allowed.includes("yearly") ? "" : "disabled"
    }>${Icon.download} Yearly Statement</button>
    ${
      allowed.length === 0
        ? `<div style="margin-top:12px"><button class="btn btn-primary btn-full" onclick="closeModal();navigate('subscriptions')">Upgrade Plan</button></div>`
        : ""
    }
  `
  );
}

function downloadStatement(period) {
  const store = getStore();
  const txns = store.transactions.filter(
    (t) => t.businessId === currentUser.businessId
  );
  const now = new Date();
  // "Last 7 Days" filter so the two are fully consistent.
  const filtered = txns.filter((t) => {
    const d = new Date(t.createdAt);
    if (period === "weekly") {
      const w = new Date();
      w.setDate(now.getDate() - 7);
      w.setHours(0, 0, 0, 0);
      return d >= w;
    }
    if (period === "monthly")
      return (
        d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      );
    return d.getFullYear() === now.getFullYear();
  });
  if (filtered.length === 0) {
    closeModal();
    toast("No transactions found for this period.", "error");
    return;
  }
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const currSym = biz?.currencySymbol || "R";
  const rows = [["Date", `Amount (${currSym})`, "Type", "Location", "Cashier"]];
  filtered.forEach((t) => {
    const cashier = store.users.find((u) => u.id === t.cashierId);
    const location = cashier?.locationId
      ? store.locations.find((l) => l.id === cashier.locationId)
      : null;
    rows.push([
      formatDate(t.createdAt),
      parseFloat(t.amount.toFixed(2)),
      t.type.toUpperCase(),
      location ? location.name : "-",
      cashier ? cashier.name : "-",
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 24 },
    { wch: 14 },
    { wch: 10 },
    { wch: 20 },
    { wch: 20 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Statement");
  XLSX.writeFile(
    wb,
    `SaleStation_${period}_${new Date().toISOString().split("T")[0]}.xlsx`
  );
  closeModal();
  addAuditLog(`Downloaded ${period} statement`, "");
  toast("Statement downloaded", "success");
}

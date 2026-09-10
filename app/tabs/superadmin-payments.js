// ============================================================
// superadmin-payments.js - tab module extracted from super-admin.js
// Depends on shared.js (loaded first).
// ============================================================

let paySearchQuery = "";

function renderPayments(area) {
  const store = getStore();
  let payments = [...(store.payments || [])].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );
  const q = paySearchQuery.toLowerCase();
  if (q)
    payments = payments.filter(
      (p) =>
        (p.businessName || "").toLowerCase().includes(q) ||
        (p.email || "").toLowerCase().includes(q) ||
        (p.plan || "").toLowerCase().includes(q)
    );
  const currencyFmt = (n) =>
    "R" + Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 });
  area.innerHTML = `
    <div class="page-header"><h2 class="page-title">Subscription Payments</h2></div>
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
      <div style="position:relative;flex:1;min-width:200px;max-width:340px">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--gray-400);pointer-events:none"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" placeholder="Search business, email or plan..." value="${sanitize(
          paySearchQuery
        )}" oninput="paySearchQuery=this.value;debounceRender(()=>renderPayments(document.getElementById('content-area')))" style="width:100%;height:36px;padding:0 12px 0 32px;border:1px solid var(--gray-200);border-radius:var(--radius);font-family:var(--font-main);font-size:13px;outline:none;background:var(--white);color:var(--black);transition:border-color .15s" onfocus="this.style.borderColor='var(--black)'" onblur="this.style.borderColor='var(--gray-200)'"/>
      </div>
      <span style="font-size:12px;color:var(--gray-400);font-family:var(--font-mono)">${
        payments.length
      } of ${(store.payments || []).length}</span>
      <div style="display:flex;gap:8px;align-items:center;margin-left:auto">
        <select id="payments-export-format" class="form-select" style="height:36px;width:auto;min-width:110px">
          <option value="excel">Excel</option>
          <option value="pdf">PDF</option>
        </select>
        <button class="btn btn-outline" style="height:36px" onclick="downloadPaymentsExport()">${
          Icon.download || ""
        } Download</button>
      </div>
    </div>
    <div class="card"><div class="table-wrapper"><table>
      <thead><tr><th>Date</th><th>Business Name</th><th>Email</th><th>Plan</th><th>Amount</th><th>Type</th></tr></thead>
      <tbody>
        ${
          payments.length === 0
            ? `<tr><td colspan="6"><div class="empty-state">${
                (store.payments || []).length === 0
                  ? "No subscription payments recorded yet"
                  : "No payments match your search"
              }</div></td></tr>`
            : payments
                .map(
                  (p) => `<tr>
                <td class="text-muted">${formatDate(p.date)}</td>
                <td><strong>${sanitize(p.businessName || "")}</strong></td>
                <td class="text-muted">${sanitize(p.email || "")}</td>
                <td><span class="badge badge-gray">${sanitize(
                  p.plan || ""
                )}</span></td>
                <td>${currencyFmt(p.amount)}</td>
                <td class="text-muted" style="text-transform:capitalize">${sanitize(
                  p.type || "payment"
                )}</td>
              </tr>`
                )
                .join("")
        }
      </tbody>
    </table></div></div>`;
}

function _getPaymentExportRows() {
  const store = getStore();
  let payments = [...(store.payments || [])].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );
  const q = paySearchQuery.toLowerCase();
  if (q)
    payments = payments.filter(
      (p) =>
        (p.businessName || "").toLowerCase().includes(q) ||
        (p.email || "").toLowerCase().includes(q) ||
        (p.plan || "").toLowerCase().includes(q)
    );
  return payments;
}

function downloadPaymentsExport() {
  const format =
    document.getElementById("payments-export-format")?.value || "excel";
  if (format === "pdf") exportPaymentsPDF();
  else exportPaymentsExcel();
}

function exportPaymentsExcel() {
  const payments = _getPaymentExportRows();
  if (payments.length === 0) {
    toast("No subscription payments to export.", "error");
    return;
  }
  const rows = [
    ["Date", "Business Name", "Email", "Plan", "Amount (ZAR)", "Type"],
  ];
  payments.forEach((p) =>
    rows.push([
      formatDate(p.date),
      p.businessName || "",
      p.email || "",
      p.plan || "",
      Number(p.amount || 0),
      p.type || "payment",
    ])
  );
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const minWidths = [20, 24, 26, 12, 14, 14];
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
  XLSX.utils.book_append_sheet(wb, ws, "Subscription Payments");
  XLSX.writeFile(
    wb,
    `subscription-payments-${new Date().toISOString().slice(0, 10)}.xlsx`
  );
  toast("Payments exported as Excel.", "success");
}

function exportPaymentsPDF() {
  const payments = _getPaymentExportRows();
  if (payments.length === 0) {
    toast("No subscription payments to export.", "error");
    return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    toast("PDF export is unavailable right now. Please try again.", "error");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text("SaleStation - Subscription Payments", 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Generated: ${formatDate(new Date().toISOString())}`, 14, 22);
  const body = payments.map((p) => [
    formatDate(p.date),
    p.businessName || "",
    p.email || "",
    p.plan || "",
    "R" +
      Number(p.amount || 0).toLocaleString("en-ZA", {
        minimumFractionDigits: 2,
      }),
    p.type || "payment",
  ]);
  doc.autoTable({
    startY: 28,
    head: [["Date", "Business Name", "Email", "Plan", "Amount", "Type"]],
    body,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [10, 10, 10] },
  });
  doc.save(
    `subscription-payments-${new Date().toISOString().slice(0, 10)}.pdf`
  );
  toast("Payments exported as PDF.", "success");
}

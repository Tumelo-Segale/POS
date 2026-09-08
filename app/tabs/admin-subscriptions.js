// ============================================================
// admin-subscriptions.js - tab module extracted from admin.js
// Depends on shared.js (loaded first).
// ============================================================

function renderSubscriptions(area) {
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const sub = store.subscriptions.find(
    (s) => s.businessId === currentUser.businessId
  );
  if (!biz || !sub) {
    area.innerHTML = '<div class="empty-state">No subscription found.</div>';
    return;
  }
  const st = getSubStatus(biz.id);
  const nextPlan = sub.nextPlan;
  const limits = PLAN_LIMITS[biz.plan] || PLAN_LIMITS.starter;
  const cashierLimitStr =
    limits.cashiers === Infinity ? "Unlimited" : limits.cashiers;
  const itemLimitStr = limits.items === Infinity ? "Unlimited" : limits.items;
  const subPriceDisplay =
    limits.price === 0
      ? "Free Trial"
      : `R${Number(limits.price).toLocaleString("en-ZA", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}/month (billed in ZAR)`;
  const isIntl = biz.currency && biz.currency !== "ZAR";
  const intlPriceNote =
    isIntl && limits.price > 0
      ? `<div style="font-size:11px;color:var(--blue);margin-top:4px">Your bank converts this from ZAR to ${biz.currency} at the prevailing exchange rate.</div>`
      : "";
  const daysLeft = st?.daysLeft || 0;
  let badgeClass = "badge-gray";
  if (st?.status === "active") badgeClass = "badge-green";
  else if (st?.status === "grace") badgeClass = "badge-orange";
  else if (st?.status === "cancelled") badgeClass = "badge-accent";
  else if (st?.status === "cancelled-expired" || st?.status === "expired")
    badgeClass = "badge-red";
  if (biz.plan === "trial") badgeClass = "badge-accent";
  const renewalOpen = daysLeft <= RENEWAL_WINDOW_DAYS;

  area.innerHTML = `
  <div class="page-header"><h2 class="page-title">Subscription</h2></div>
  ${
    st?.inGrace
      ? `<div class="alert alert-orange mb-20"><b>Grace period:</b> ${st.graceLeft} day(s) remaining. Renew before expiry to keep your account active.</div>`
      : ""
  }
  ${
    st?.status === "expired"
      ? `<div class="alert alert-red mb-20">${Icon.alert} Subscription expired. All functionality is suspended. Please renew.</div>`
      : ""
  }
  ${
    st?.active &&
    !st?.inGrace &&
    typeof st?.daysLeft === "number" &&
    st?.daysLeft <= 3 &&
    st?.daysLeft > 0
      ? `<div class="alert alert-accent mb-20">${Icon.alert} <strong>Heads up:</strong> Your subscription expires in <strong>${st.daysLeft} day(s)</strong>. Renew before it ends to avoid interruption.</div>`
      : ""
  }
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:760px" class="sub-grid">
    <div class="card" style="grid-column:1/-1">
      <div class="card-body">
        <div class="sub-plan-header">
          <div>
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--gray-400);font-family:var(--font-mono);margin-bottom:4px">Current Plan</div>
            <div class="sub-plan-name">${limits.label}</div>
          </div>
          <span class="badge ${badgeClass}" style="font-size:11px;padding:4px 10px">${
    st?.label || sub.status
  }</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr;gap:4px" class="sub-details-grid">
          <div class="sub-detail-row"><span class="sub-detail-label">Price</span><div style="text-align:right"><span class="sub-detail-val">${subPriceDisplay}</span>${intlPriceNote}</div></div>
          <div class="sub-detail-row"><span class="sub-detail-label">Expiry Date</span><span class="sub-detail-val">${formatDateShort(
            sub.expiresAt
          )}</span></div>
          <div class="sub-detail-row"><span class="sub-detail-label">Cashier Limit</span><span class="sub-detail-val">${cashierLimitStr}</span></div>
          <div class="sub-detail-row"><span class="sub-detail-label">Item Limit</span><span class="sub-detail-val">${itemLimitStr}</span></div>
          <div class="sub-detail-row"><span class="sub-detail-label">Statements</span><span class="sub-detail-val">${
            limits.statements.length === 0
              ? "None"
              : limits.statements
                  .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
                  .join(", ")
          }</span></div>
          <div class="sub-detail-row"><span class="sub-detail-label">Grace Period</span><span class="sub-detail-val">${
            limits.graceDays === 0 ? "None" : limits.graceDays + " days"
          }</span></div>
        </div>
        <div style="margin-top:16px;padding-top:16px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--gray-400);font-family:var(--font-mono);margin-bottom:10px">Plan Features</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px 16px">
            ${(limits.features || [])
              .map(
                (f) =>
                  `<div style="display:flex;align-items:center;gap:7px;font-size:12px;padding:3px 0;color:var(--gray-700)"><svg width="12" height="12" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>${f}</div>`
              )
              .join("")}
          </div>
        </div>
        ${
          nextPlan
            ? `<div class="alert alert-blue" style="margin-top:14px">${
                Icon.alert
              } Upgrade to <strong>${
                PLAN_LIMITS[nextPlan]?.label
              }</strong> scheduled at next renewal (${formatDateShort(
                sub.expiresAt
              )})</div>`
            : ""
        }
        ${
          sub.status === "cancelled" && st?.active
            ? `<div class="alert alert-orange" style="margin-top:12px">${
                Icon.alert
              } Subscription cancelled — access remains until <strong>${formatDateShort(
                sub.expiresAt
              )}</strong>. Renew before that date to avoid losing access.</div>`
            : ""
        }
        <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          ${
            biz.plan === "trial"
              ? `<button class="btn btn-primary" onclick="handleUpgrade('starter')">Upgrade to Starter</button>`
              : ""
          }
          ${
            biz.plan === "trial"
              ? `<button class="btn btn-outline" onclick="handleUpgrade('premium')">Upgrade to Premium</button>`
              : ""
          }
          ${
            biz.plan === "starter" && !nextPlan && sub.status !== "cancelled"
              ? `<button class="btn btn-primary" onclick="handleUpgrade('premium')">Upgrade to Premium</button>`
              : ""
          }
          ${
            st?.status === "cancelled-expired" || st?.status === "expired"
              ? `<button class="btn btn-primary" onclick="handleRenew()">Renew Subscription</button>`
              : ""
          }
          ${
            sub.status === "cancelled" && st?.active && renewalOpen
              ? `<button class="btn btn-primary" onclick="handleRenew()">Renew Subscription</button>`
              : ""
          }
          ${
            biz.plan !== "trial" &&
            st?.active &&
            sub.status !== "cancelled" &&
            renewalOpen
              ? `<button class="btn btn-primary" onclick="handleRenew()">Renew Subscription</button>`
              : ""
          }
          ${
            biz.plan !== "trial" && st?.active && sub.status !== "cancelled"
              ? `<button class="btn btn-danger-outline" onclick="handleCancelSub()">Cancel Subscription</button>`
              : ""
          }
          ${
            biz.plan !== "trial" &&
            st?.active &&
            sub.status !== "cancelled" &&
            !renewalOpen &&
            typeof daysLeft === "number" &&
            daysLeft > 0
              ? `<span style="font-size:11px;color:var(--gray-500);font-family:var(--font-mono)">Renewal available in the last ${RENEWAL_WINDOW_DAYS} days — ${daysLeft} day(s) remaining.</span>`
              : ""
          }
        </div>
      </div>
    </div>
  </div>`;
}

function handleUpgrade(targetPlan) {
  if (targetPlan === "trial") {
    toast("Trial plan is not available as an upgrade option.", "error");
    return;
  }
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const sub = store.subscriptions.find(
    (s) => s.businessId === currentUser.businessId
  );
  // Upgrades (higher plan) are allowed anytime.
  // Renewals (same/lower plan) are gated to the last RENEWAL_WINDOW_DAYS.
  const planOrder = { trial: 0, starter: 1, premium: 2 };
  if ((planOrder[targetPlan] ?? 0) < (planOrder[biz.plan] ?? 0)) {
    const removedFeatures = [];
    if (biz.plan === "premium" && targetPlan === "starter") {
      removedFeatures.push(
        "Multi-Store (up to 3 locations) — all location data becomes inaccessible"
      );
      removedFeatures.push(
        "Audit Action Logs — log history becomes inaccessible"
      );
      removedFeatures.push(
        "Monthly & Yearly Statement Exports — only weekly export remains"
      );
      removedFeatures.push("Unlimited Cashiers → Max 2 Cashiers");
      removedFeatures.push("Unlimited Items → Max 50 Items");
    }
    const removalList = removedFeatures
      .map(
        (f) =>
          `<li style="padding:4px 0;font-size:13px;color:var(--gray-700)">• ${f}</li>`
      )
      .join("");
    openModal(
      "Confirm Downgrade",
      `
      <div style="margin-bottom:16px">
        <div style="font-size:14px;font-weight:700;margin-bottom:8px;color:var(--red)">⚠ Downgrading from ${
          PLAN_LIMITS[biz.plan]?.label
        } → ${PLAN_LIMITS[targetPlan]?.label}</div>
        <p style="font-size:13px;color:var(--gray-600);margin-bottom:12px">The following features and limits will be <strong>removed immediately</strong>:</p>
        <ul style="list-style:none;padding:12px;background:var(--red-bg);border:1px solid #f5c0c4;border-radius:var(--radius)">${removalList}</ul>
        <p style="font-size:12px;color:var(--gray-500);margin-top:10px">Your existing data is preserved but will be inaccessible until you upgrade again.</p>
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-outline btn-lg" style="flex:1" onclick="closeModal()">Cancel</button>
        <button class="btn btn-danger btn-lg" style="flex:2" onclick="closeModal();simulatePaystack('${safeAttr(
          biz.name
        )}','','${safeAttr(
        biz.email
      )}','','${targetPlan}',true,null)">Yes, Downgrade</button>
      </div>`
    );
    return;
  }
  simulatePaystack(biz.name, "", biz.email, "", targetPlan, true, null);
}

function completeUpgrade(targetPlan) {
  const store = getStore();
  const dur = PLAN_LIMITS[targetPlan]?.durationDays || 30;
  const processDay = new Date();
  processDay.setHours(0, 0, 0, 0);
  // No proration: new billing cycle always starts fresh from today.
  const newExpiry = new Date(
    processDay.getTime() + dur * 86400000
  ).toISOString();
  updateStore((d) => ({
    ...d,
    businesses: d.businesses.map((b) =>
      b.id === currentUser.businessId ? { ...b, plan: targetPlan } : b
    ),
    subscriptions: d.subscriptions.map((s) =>
      s.businessId === currentUser.businessId
        ? {
            ...s,
            plan: targetPlan,
            nextPlan: null,
            status: "active",
            expiresAt: newExpiry,
          }
        : s
    ),
  }));
  addAuditLog(`Upgraded plan to ${targetPlan}`, "");
  {
    const biz = store.businesses.find((b) => b.id === currentUser.businessId);
    addPaymentRecord(
      currentUser.businessId,
      biz ? biz.name : "",
      biz ? biz.email : "",
      targetPlan,
      Number(PLAN_LIMITS[targetPlan]?.price || 0),
      "upgrade"
    );
  }
  const newLimits = PLAN_LIMITS[targetPlan] || PLAN_LIMITS.starter;
  const freshStore = getStore();
  const activeItems = freshStore.items.filter(
    (i) => i.businessId === currentUser.businessId && i.status === "active"
  ).length;
  const activeCashiers = freshStore.users.filter(
    (u) => u.businessId === currentUser.businessId && u.role === "cashier"
  ).length;
  const overLimitWarnings = [];
  if (newLimits.items !== Infinity && activeItems > newLimits.items)
    overLimitWarnings.push(
      `Active items: ${activeItems} (limit: ${
        newLimits.items
      }). Please deactivate ${activeItems - newLimits.items} item(s).`
    );
  if (newLimits.cashiers !== Infinity && activeCashiers > newLimits.cashiers)
    overLimitWarnings.push(
      `Cashiers: ${activeCashiers} (limit: ${
        newLimits.cashiers
      }). Please suspend ${activeCashiers - newLimits.cashiers} cashier(s).`
    );
  if (overLimitWarnings.length > 0)
    overLimitWarnings.forEach((w) => toast(`Over limit: ${w}`, "error"));
  else
    toast(
      `Plan upgraded to ${PLAN_LIMITS[targetPlan]?.label}! Your new billing cycle starts now.`,
      "success"
    );
  buildSidebar();
  setTimeout(
    () => renderSubscriptions(document.getElementById("content-area")),
    400
  );
}

function completeRenew(newPlan) {
  // Check for one-shot override (set by showLoginSubscriptionModal for login-time renewals)
  if (completeRenewOverride) {
    const fn = completeRenewOverride;
    completeRenewOverride = null;
    fn(newPlan);
    return;
  }
  const store = getStore();
  const existingSub = store.subscriptions.find(
    (s) => s.businessId === currentUser.businessId
  );
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const isTrial = biz?.plan === "trial";
  const dur = PLAN_LIMITS[newPlan]?.durationDays || 30;
  const processDay = new Date();
  processDay.setHours(0, 0, 0, 0);
  let newExpiry;
  // Cancelled-but-active subs carry time; expired subs start fresh.
  if (
    !isTrial &&
    existingSub &&
    existingSub.expiresAt &&
    existingSub.status === "active"
  ) {
    const remaining = new Date(existingSub.expiresAt) - new Date();
    newExpiry = new Date(
      processDay.getTime() + dur * 86400000 + Math.max(0, remaining)
    ).toISOString();
  } else {
    newExpiry = new Date(processDay.getTime() + dur * 86400000).toISOString();
  }
  updateStore((d) => ({
    ...d,
    businesses: d.businesses.map((b) =>
      b.id === currentUser.businessId
        ? { ...b, plan: newPlan, status: "active" }
        : b
    ),
    subscriptions: d.subscriptions.map((s) =>
      s.businessId === currentUser.businessId
        ? {
            ...s,
            plan: newPlan,
            status: "active",
            expiresAt: newExpiry,
            nextPlan: null,
          }
        : s
    ),
  }));
  addAuditLog(`Renewed subscription to ${newPlan}`, "");
  addPaymentRecord(
    currentUser.businessId,
    biz ? biz.name : "",
    biz ? biz.email : "",
    newPlan,
    Number(PLAN_LIMITS[newPlan]?.price || 0),
    "renewal"
  );
  toast(
    "Subscription renewed! Duration added to your remaining time.",
    "success"
  );
  buildSidebar();
  setTimeout(
    () => renderSubscriptions(document.getElementById("content-area")),
    400
  );
}

function handleRenew() {
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  const featureList = (plan) =>
    (PLAN_LIMITS[plan].features || []).map((f) => `<li>${f}</li>`).join("");
  openModal(
    "Renew Subscription",
    `
    <p style="font-size:13px;color:var(--gray-500);margin-bottom:16px">Choose a plan to renew. Trial plans are not available for renewal.</p>
    <div id="renew-plan-starter" class="plan-card selected" onclick="selectRenewPlan('starter')" style="cursor:pointer">
      <div class="plan-card-header"><span class="plan-name">Starter</span><span class="plan-price">R${
        PLAN_LIMITS.starter.price
      }<span>/mo</span></span></div>
      <div style="font-size:10px;color:var(--blue);margin-bottom:8px;font-family:var(--font-mono)">Billed in ZAR</div>
      <ul class="plan-features">${featureList("starter")}</ul>
    </div>
    <div id="renew-plan-premium" class="plan-card" onclick="selectRenewPlan('premium')" style="cursor:pointer">
      <div class="plan-card-header"><span class="plan-name">Premium <span class="plan-badge-tag popular-badge">Popular</span></span><span class="plan-price">R${
        PLAN_LIMITS.premium.price
      }<span>/mo</span></span></div>
      <div style="font-size:10px;color:var(--blue);margin-bottom:8px;font-family:var(--font-mono)">Billed in ZAR</div>
      <ul class="plan-features">${featureList("premium")}</ul>
    </div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn btn-outline btn-lg" style="flex:1" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-lg" style="flex:2" onclick="_handleRenewContinue()">Continue to Payment</button>
    </div>`
  );
  _renewSelectedPlan = "starter";
  selectRenewPlan("starter");
  _pendingRenew = function () {
    const plan = _renewSelectedPlan || "starter";
    _pendingRenew = null;
    closeModal();
    simulatePaystack(biz.name, "", biz.email, "", plan, false, null, true);
  };
}

function handleCancelSub() {
  const store = getStore();
  const sub = store.subscriptions.find(
    (s) => s.businessId === currentUser.businessId
  );
  const remainingDays = sub.expiresAt
    ? Math.max(0, Math.ceil((new Date(sub.expiresAt) - new Date()) / 86400000))
    : 0;
  const cancelWarning = `Your plan will remain active for the ${remainingDays} day(s) remaining until ${formatDateShort(
    sub.expiresAt
  )}, then access is immediately revoked. No grace period applies once cancelled. Cancel anyway?`;
  confirm2("Cancel Subscription", cancelWarning).then((ok) => {
    if (!ok) return;
    updateStore((d) => ({
      ...d,
      subscriptions: d.subscriptions.map((s) =>
        s.businessId === currentUser.businessId
          ? { ...s, status: "cancelled" }
          : s
      ),
    }));
    toast("Subscription cancelled.");
    renderSubscriptions(document.getElementById("content-area"));
  });
}

// ============================================================
// tabs/contact.js - shared tab module extracted from shared.js
// Loaded by whichever site (admin/cashier) uses this tab.
// Depends on shared.js (must be loaded first).
// ============================================================

function renderContact(area) {
  const store = getStore();
  const biz = store.businesses.find((b) => b.id === currentUser.businessId);
  area.innerHTML = `
  <div class="page-header"><h2 class="page-title">Contact Support</h2></div>
  <div class="card" style="max-width:500px">
    <div class="card-body">
      <div class="form-group"><label class="form-label">Business Name</label><input class="form-input" value="${sanitize(
        biz?.name || "N/A"
      )}" disabled/></div>
      <div class="form-group"><label class="form-label">Your Name</label><input class="form-input" value="${sanitize(
        currentUser.name
      )}" disabled/></div>
      <div class="form-group"><label class="form-label">Email Address</label><input class="form-input" value="${
        currentUser.email || ""
      }" disabled/></div>
      <div class="form-group"><label class="form-label">Message</label><textarea id="support-msg" class="form-textarea" placeholder="How can we help you?"></textarea></div>
      <button class="btn btn-primary btn-full btn-lg" onclick="sendSupportMessage()">${
        Icon.mail
      } Send Message</button>
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

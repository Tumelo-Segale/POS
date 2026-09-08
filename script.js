// ── SIDEBAR TOGGLE ──
function openSidebar() {
  document.getElementById("mobile-sidebar").classList.add("open");
  document.getElementById("sidebar-overlay").classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeSidebar() {
  document.getElementById("mobile-sidebar").classList.remove("open");
  document.getElementById("sidebar-overlay").classList.remove("open");
  document.body.style.overflow = "";
}

// ── TOAST ──
function toast(msg, type) {
  const el = document.createElement("div");
  el.className =
    "toast" +
    (type === "success"
      ? " toast-success"
      : type === "error"
      ? " toast-error"
      : "");
  el.textContent = msg;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

// ── SHARED STORAGE KEY (same as shared.js) ──
const STORAGE_KEY = "salestation_v6";

function getStore() {
  try {
    const d = localStorage.getItem(STORAGE_KEY);
    if (!d) return null;
    return JSON.parse(d);
  } catch (e) {
    return null;
  }
}

function updateStore(fn) {
  const base = getStore() || {
    users: [
      {
        id: "super-admin-1",
        name: "Tumelo Segale",
        email: "admin@salestation.co.za",
        password: "password",
        role: "super-admin",
        status: "active",
      },
    ],
    businesses: [],
    items: [],
    transactions: [],
    messages: [],
    subscriptions: [],
    locations: [],
    auditLogs: [],
    currentUser: null,
  };
  // Ensure messages array always exists
  if (!base.messages) base.messages = [];
  const next = fn(base);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

// ── CONTACT FORM → sends to super admin messages store ──
// Rate-limit state (must be declared before sendContactMessage is called)
let _lastContactSend = 0;
const CONTACT_COOLDOWN_MS = 5000; // 5-second cooldown between submissions

function sendContactMessage() {
  const nameEl = document.getElementById("contact-name");
  const emailEl = document.getElementById("contact-email");
  const msgEl = document.getElementById("contact-message");
  const name = nameEl.value.trim();
  const email = emailEl.value.trim();
  const msg = msgEl.value.trim();

  // Rate-limit check
  const now = Date.now();
  const elapsed = now - _lastContactSend;
  if (_lastContactSend > 0 && elapsed < CONTACT_COOLDOWN_MS) {
    const secsLeft = Math.ceil((CONTACT_COOLDOWN_MS - elapsed) / 1000);
    toast(`Please wait ${secsLeft}s before sending another message.`, "error");
    return;
  }

  // Validation
  let valid = true;
  [nameEl, emailEl, msgEl].forEach((el) => el.classList.remove("invalid"));
  if (!name) {
    nameEl.classList.add("invalid");
    valid = false;
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    emailEl.classList.add("invalid");
    valid = false;
  }
  if (!msg) {
    msgEl.classList.add("invalid");
    valid = false;
  }
  if (!valid) {
    toast("Please fill in all fields correctly.", "error");
    return;
  }

  // Save message into shared localStorage so super-admin can see it in super-admin.html
  updateStore((d) => ({
    ...d,
    messages: [
      ...(d.messages || []),
      {
        id: "msg-" + uid(),
        businessId: "direct",
        businessName: name,
        senderName: name,
        senderRole: "visitor",
        email: email,
        message: msg,
        createdAt: new Date().toISOString(),
        read: false,
      },
    ],
  }));

  // Clear form
  nameEl.value = "";
  emailEl.value = "";
  msgEl.value = "";

  // Record timestamp for rate-limiting
  _lastContactSend = Date.now();

  toast("Message sent! We'll get back to you within 24 hours.", "success");
}

// ── ACTIVE SECTION SCROLL-SPY ──
function setupScrollSpy() {
  const sections = [
    { id: "platform", sidebarId: "nav-platform", deskId: "desk-nav-platform" },
    { id: "features", sidebarId: "nav-features", deskId: "desk-nav-features" },
    { id: "pricing", sidebarId: "nav-pricing", deskId: "desk-nav-pricing" },
    { id: "contact", sidebarId: "nav-contact", deskId: "desk-nav-contact" },
  ];
  function updateActiveNav() {
    const scrollY = window.scrollY + 100;
    let activeSection = null;
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el && el.offsetTop <= scrollY) activeSection = s.id;
    }
    sections.forEach((s) => {
      const sidebar = document.getElementById(s.sidebarId);
      const desk = document.getElementById(s.deskId);
      const isActive = s.id === activeSection;
      if (sidebar) sidebar.classList.toggle("active", isActive);
      if (desk) desk.classList.toggle("active", isActive);
    });
  }
  window.addEventListener("scroll", updateActiveNav, { passive: true });
  updateActiveNav();
}

// ── TERMS & CONDITIONS MODAL ──
function openTCModal() {
  document.getElementById("tc-modal-overlay").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeTCModal() {
  document.getElementById("tc-modal-overlay").classList.remove("open");
  document.body.style.overflow = "";
}

function handleTCOverlayClick(e) {
  if (e.target === document.getElementById("tc-modal-overlay")) {
    closeTCModal();
  }
}

// ── PRIVACY POLICY MODAL ──
function openPrivacyModal() {
  document.getElementById("privacy-modal-overlay").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closePrivacyModal() {
  document.getElementById("privacy-modal-overlay").classList.remove("open");
  document.body.style.overflow = "";
}

function handlePrivacyOverlayClick(e) {
  if (e.target === document.getElementById("privacy-modal-overlay")) {
    closePrivacyModal();
  }
}

// ── FAQ MODAL ──
function openFAQModal() {
  document.getElementById("faq-modal-overlay").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeFAQModal() {
  document.getElementById("faq-modal-overlay").classList.remove("open");
  document.body.style.overflow = "";
}

function handleFAQOverlayClick(e) {
  if (e.target === document.getElementById("faq-modal-overlay")) {
    closeFAQModal();
  }
}

function toggleFAQ(questionEl) {
  const item = questionEl.closest(".faq-item");
  const isOpen = item.classList.contains("open");
  // Close all open items first
  document
    .querySelectorAll(".faq-item.open")
    .forEach((el) => el.classList.remove("open"));
  // Toggle the clicked one (accordion behaviour)
  if (!isOpen) item.classList.add("open");
}

// Close modals / mobile sidebar with Escape key
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    closeTCModal();
    closePrivacyModal();
    closeFAQModal();
    if (document.getElementById("mobile-sidebar").classList.contains("open"))
      closeSidebar();
  }
});

// ── BOOTSTRAP ON DOM READY ──
document.addEventListener("DOMContentLoaded", () => {
  setupScrollSpy();
});

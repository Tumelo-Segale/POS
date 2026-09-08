// ============================================================
// superadmin-messages.js - tab module extracted from super-admin.js
// Depends on shared.js (loaded first).
// ============================================================

function renderMessages(area) {
  const msgs = getStore().messages;
  const hasUnread = msgs.filter((m) => !m.read).length > 0;
  area.innerHTML = `
    <div class="page-header"><h2 class="page-title">Support Messages</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${
          hasUnread
            ? `<button class="btn btn-outline" onclick="markAllMessagesRead()">Mark All Read</button>`
            : ""
        }
        ${
          msgs.length > 0
            ? `<button class="btn btn-danger-outline" onclick="deleteAllMessages()">${Icon.trash} Delete All</button>`
            : ""
        }
      </div>
    </div>
    <div class="card"><div class="card-body">
      ${
        msgs.length === 0
          ? '<div class="empty-state">No messages yet</div>'
          : [...msgs]
              .reverse()
              .map(
                (m) => `
          <div style="padding:14px;border:1px solid var(--gray-100);border-radius:var(--radius);margin-bottom:10px;background:${
            m.read ? "var(--white)" : "var(--blue-bg)"
          }">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:8px">
              <div>
                <div class="font-bold">${sanitize(m.businessName)} ${
                  !m.read ? '<span class="badge badge-blue">New</span>' : ""
                }</div>
                <div class="text-muted text-sm">${
                  m.senderName
                    ? sanitize(m.senderName) +
                      (m.senderRole ? " · " + m.senderRole : "") +
                      " · "
                    : ""
                }${m.email}</div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span class="text-muted text-sm">${formatDateShort(
                  m.createdAt
                )}</span>
                ${
                  !m.read
                    ? `<button class="btn btn-sm btn-outline" onclick="markMessageRead('${m.id}')">Mark Read</button>`
                    : ""
                }
                <button class="btn btn-sm btn-danger-outline" onclick="deleteMessage('${
                  m.id
                }')" title="Delete message" style="display:inline-flex;align-items:center;gap:4px">${
                  Icon.trash
                } Delete</button>
              </div>
            </div>
            <p style="font-size:13px;color:var(--gray-700)">${sanitize(
              m.message
            )}</p>
          </div>`
              )
              .join("")
      }
    </div></div>`;
}

function _refreshMessagesUI() {
  buildSidebar();
  document
    .querySelectorAll(".nav-item[data-tab]")
    .forEach((el) =>
      el.classList.toggle("active", el.dataset.tab === activeTab)
    );
  renderMessages(document.getElementById("content-area"));
}

function markMessageRead(id) {
  updateStore((d) => ({
    ...d,
    messages: d.messages.map((m) => (m.id === id ? { ...m, read: true } : m)),
  }));
  _refreshMessagesUI();
}

function markAllMessagesRead() {
  updateStore((d) => ({
    ...d,
    messages: d.messages.map((m) => ({ ...m, read: true })),
  }));
  _refreshMessagesUI();
  toast("All messages marked as read");
}

function deleteMessage(id) {
  confirm2(
    "Delete Message",
    "Are you sure you want to permanently delete this message? This cannot be undone.",
    { okLabel: "Delete", okClass: "btn-danger" }
  ).then((ok) => {
    if (!ok) return;
    updateStore((d) => ({
      ...d,
      messages: d.messages.filter((m) => m.id !== id),
    }));
    _refreshMessagesUI();
    toast("Message deleted", "success");
  });
}

function deleteAllMessages() {
  const store = getStore();
  if (store.messages.length === 0) return;
  confirm2(
    "Delete All Messages",
    `This will permanently delete all ${store.messages.length} message${
      store.messages.length === 1 ? "" : "s"
    }. This cannot be undone.`,
    { okLabel: "Delete All", okClass: "btn-danger" }
  ).then((ok) => {
    if (!ok) return;
    updateStore((d) => ({ ...d, messages: [] }));
    _refreshMessagesUI();
    toast("All messages deleted", "success");
  });
}

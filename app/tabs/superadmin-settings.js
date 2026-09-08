// ============================================================
// superadmin-settings.js - tab module extracted from super-admin.js
// Depends on shared.js (loaded first).
// ============================================================

function _renderSuperAdminSettings(area) {
  area.innerHTML = `
    <div class="page-header"><h2 class="page-title">Account Settings</h2></div>
    <div style="max-width:480px">
      <div class="card">
        <div class="card-header"><span class="card-title">Personal Details</span></div>
        <div class="card-body">
          <div class="form-group"><label class="form-label">Full Name</label><input id="s-name" class="form-input" value="${sanitize(
            currentUser.name
          )}"/></div>
          <div class="form-group"><label class="form-label">Email Address</label><input id="s-email" class="form-input" type="email" value="${
            currentUser.email
          }"/></div>
          <div class="form-group"><label class="form-label">New Password</label>
            <div class="pw-wrap"><input id="s-pass" class="form-input" type="password" placeholder="Leave blank to keep current"/>
            <button class="pw-toggle" type="button" onclick="togglePw('s-pass')"><svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></div>
          </div>
          <button class="btn btn-primary btn-full btn-lg" onclick="saveSettings()">Update Details</button>
        </div>
      </div>
    </div>`;
}

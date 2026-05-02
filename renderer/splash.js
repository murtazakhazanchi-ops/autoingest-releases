'use strict';

(function () {
  let _users      = [];
  let _selectedId = null;
  let _prevState  = null; // 'welcome' | 'select' | null

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function _showPanel(id) {
    ['splashWelcome', 'splashSelect', 'splashCreate'].forEach(panelId => {
      const el = document.getElementById(panelId);
      if (el) el.style.display = (panelId === id) ? '' : 'none';
    });
  }

  function _renderUserList() {
    const list = document.getElementById('splashUserList');
    if (!list) return;
    list.innerHTML = '';
    _users.forEach(u => {
      const item = document.createElement('div');
      item.className = 'splash-user-item' + (u.id === _selectedId ? ' selected' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', u.id === _selectedId ? 'true' : 'false');
      item.dataset.userId = u.id;
      item.innerHTML =
        `<div class="splash-user-initials">${escapeHtml(u.initials || '?')}</div>` +
        `<div class="splash-user-info">` +
        `<div class="splash-user-item-name">${escapeHtml(u.name)}</div>` +
        (u.role ? `<div class="splash-user-item-role">${escapeHtml(u.role)}</div>` : '') +
        `</div>`;
      item.addEventListener('click', () => {
        _selectedId = u.id;
        const startBtn = document.getElementById('splashSelectStartBtn');
        if (startBtn) startBtn.disabled = false;
        list.querySelectorAll('.splash-user-item').forEach(el => {
          const sel = el.dataset.userId === u.id;
          el.classList.toggle('selected', sel);
          el.setAttribute('aria-selected', sel ? 'true' : 'false');
        });
      });
      list.appendChild(item);
    });
  }

  const _EXIT_MS = 200; // must match CSS transition duration in splash.html

  async function _complete() {
    // Disable primary action buttons immediately — prevents double-trigger during fade
    ['splashContinueBtn', 'splashSelectStartBtn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn && !btn.disabled) {
        btn.disabled    = true;
        btn.textContent = 'Starting…';
      }
    });

    // Trigger CSS exit animation
    document.body.classList.add('splash-exiting');

    // Wait for transition to complete (+ 20ms buffer) before handing to main process
    await new Promise(r => setTimeout(r, _EXIT_MS + 20));

    try {
      await window.api.splashComplete();
    } catch (err) {
      console.error('[splash] splashComplete failed:', err);
      // Roll back — restore card so user can retry
      document.body.classList.remove('splash-exiting');
      [
        { id: 'splashContinueBtn',    label: 'START'         },
        { id: 'splashSelectStartBtn', label: 'Start session' },
        { id: 'splashCreateStartBtn', label: 'Create & start'},
      ].forEach(({ id, label }) => {
        const btn = document.getElementById(id);
        if (btn) { btn.disabled = false; btn.textContent = label; }
      });
    }
  }

  async function _createUser() {
    const nameInput = document.getElementById('splashInputName');
    const roleInput = document.getElementById('splashInputRole');
    const errEl     = document.getElementById('splashCreateError');
    const name = (nameInput?.value || '').trim();
    if (!name) {
      if (errEl) { errEl.textContent = 'Full name is required.'; errEl.style.display = ''; }
      nameInput?.focus();
      return;
    }
    if (errEl) errEl.style.display = 'none';
    const createBtn = document.getElementById('splashCreateStartBtn');
    if (createBtn) { createBtn.disabled = true; createBtn.textContent = 'Creating…'; }
    try {
      await window.api.createUser({
        name,
        role: (roleInput?.value || '').trim() || null,
      });
      await _complete();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message || 'Could not create profile.'; errEl.style.display = ''; }
      if (createBtn) { createBtn.disabled = false; createBtn.textContent = 'Create & start'; }
    }
  }

  async function init() {
    try {
      _users = (await window.api.listUsers()) || [];
    } catch {
      _users = [];
    }

    let lastUser = null;
    try { lastUser = await window.api.getActiveUser(); } catch { /* ignore */ }

    if (lastUser) {
      const nameEl = document.getElementById('splashWelcomeUserName');
      if (nameEl) nameEl.textContent = lastUser.name;
      _selectedId = lastUser.id;
      _showPanel('splashWelcome');

      document.getElementById('splashContinueBtn')?.addEventListener('click', async () => {
        try { await window.api.setActiveUser(lastUser.id); } catch { /* ignore */ }
        await _complete();
      });
      document.getElementById('splashNotYouBtn')?.addEventListener('click', () => {
        _prevState  = 'welcome';
        _selectedId = null;
        const startBtn = document.getElementById('splashSelectStartBtn');
        if (startBtn) startBtn.disabled = true;
        _renderUserList();
        _showPanel('splashSelect');
      });
    } else if (_users.length > 0) {
      _showPanel('splashSelect');
      _renderUserList();
    } else {
      _prevState = null;
      const title = document.getElementById('splashCreateTitle');
      if (title) title.textContent = 'Set up your operator profile';
      const backBtn = document.getElementById('splashCreateBackBtn');
      if (backBtn) backBtn.style.display = 'none';
      _showPanel('splashCreate');
    }

    document.getElementById('splashSelectStartBtn')?.addEventListener('click', async () => {
      if (!_selectedId) return;
      try {
        await window.api.setActiveUser(_selectedId);
        await _complete();
      } catch (err) {
        console.error('[splash] setActiveUser failed:', err);
      }
    });

    document.getElementById('splashNewProfileBtn')?.addEventListener('click', () => {
      _prevState = 'select';
      const nameInput = document.getElementById('splashInputName');
      const roleInput = document.getElementById('splashInputRole');
      const errEl     = document.getElementById('splashCreateError');
      if (nameInput) nameInput.value = '';
      if (roleInput) roleInput.value = '';
      if (errEl) errEl.style.display = 'none';
      const titleEl = document.getElementById('splashCreateTitle');
      if (titleEl) titleEl.textContent = 'Create operator profile';
      const btn = document.getElementById('splashCreateStartBtn');
      if (btn) { btn.disabled = false; btn.textContent = 'Create & start'; }
      const backBtn = document.getElementById('splashCreateBackBtn');
      if (backBtn) backBtn.style.display = '';
      _showPanel('splashCreate');
    });

    document.getElementById('splashCreateStartBtn')?.addEventListener('click', _createUser);
    document.getElementById('splashInputName')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') _createUser();
    });
    document.getElementById('splashCreateBackBtn')?.addEventListener('click', () => {
      const errEl = document.getElementById('splashCreateError');
      if (errEl) errEl.style.display = 'none';
      if (_prevState === 'select' || _users.length > 0) {
        _renderUserList();
        _showPanel('splashSelect');
      } else {
        _showPanel('splashWelcome');
      }
    });
  }

  init();
})();

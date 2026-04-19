/* renderer/treeAutocomplete.js
 * Reusable tree + autocomplete dropdown.
 * Depends on window.api: matchList, addToList, learnAlias, getLists
 */
'use strict';

class TreeAutocomplete {

  static ALLOW_ADD = new Set(['cities', 'locations', 'photographers']);

  /**
   * @param {object}      opts
   * @param {HTMLElement} opts.container   element to render into
   * @param {string}      opts.type        'cities'|'locations'|'event-types'|'photographers'
   * @param {string}     [opts.placeholder]
   * @param {Function}   [opts.onSelect]  called with {id,label} or null on clear
   */
  constructor({ container, type, placeholder = 'Search…', onSelect = () => {} }) {
    this.type     = type;
    this.ph       = placeholder;
    this.onSelect = onSelect;
    this.allowAdd = TreeAutocomplete.ALLOW_ADD.has(type);

    // ── state ──
    this._inputVal  = '';
    this._selected  = null;      // { id, label }
    this._results   = [];
    this._expanded  = new Set();
    this._isOpen    = false;
    this._activeIdx = -1;
    this._fullData  = null;
    this._pathMap   = new Map(); // id → breadcrumb string
    this._debTimer  = null;
    this._seq       = 0;         // stale-response guard

    this._build(container);
    this._bindEvents();
    this._loadFullData();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // DOM
  // ────────────────────────────────────────────────────────────────────────────

  _build(container) {
    container.innerHTML = '';

    this._wrap = document.createElement('div');
    this._wrap.className = 'tac';

    const row = document.createElement('div');
    row.className = 'tac-row';

    this._inp = document.createElement('input');
    this._inp.type = 'text';
    this._inp.className = 'tac-inp';
    this._inp.placeholder = this.ph;
    this._inp.autocomplete = 'off';
    this._inp.spellcheck = false;
    this._inp.setAttribute('role', 'combobox');
    this._inp.setAttribute('aria-autocomplete', 'list');
    this._inp.setAttribute('aria-expanded', 'false');

    this._clearBtn = document.createElement('button');
    this._clearBtn.type = 'button';
    this._clearBtn.className = 'tac-clear-btn';
    this._clearBtn.textContent = '×';
    this._clearBtn.hidden = true;
    this._clearBtn.setAttribute('tabindex', '-1');
    this._clearBtn.setAttribute('aria-label', 'Clear selection');

    this._chev = document.createElement('span');
    this._chev.className = 'tac-chev';
    this._chev.setAttribute('aria-hidden', 'true');

    row.append(this._inp, this._clearBtn, this._chev);

    this._dd = document.createElement('div');
    this._dd.className = 'tac-dd';
    this._dd.hidden = true;
    this._dd.setAttribute('role', 'listbox');

    this._wrap.append(row, this._dd);
    container.append(this._wrap);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Events
  // ────────────────────────────────────────────────────────────────────────────

  _bindEvents() {
    this._inp.addEventListener('focus', () => this._open());
    this._inp.addEventListener('input', () => {
      this._inputVal = this._inp.value;
      this._clearBtn.hidden = !this._inputVal;
      this._debounce();
    });
    this._inp.addEventListener('keydown', e => this._onKey(e));
    this._clearBtn.addEventListener('mousedown', e => { e.preventDefault(); this.clear(); });

    this._globalDown = e => { if (!this._wrap.contains(e.target)) this._close(); };
    document.addEventListener('mousedown', this._globalDown, true);
  }

  destroy() {
    document.removeEventListener('mousedown', this._globalDown, true);
    clearTimeout(this._debTimer);
    this._wrap.remove();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Data loading
  // ────────────────────────────────────────────────────────────────────────────

  async _loadFullData() {
    this._fullData = await window.api.getLists(this.type);
    this._buildPathMap(this._fullData);
    if (this._isOpen && !this._inputVal.trim()) this._render();
  }

  _buildPathMap(data) {
    this._pathMap.clear();
    if (!Array.isArray(data)) return;

    if (this.type === 'event-types') {
      for (const cat of data) {
        for (const ev of (cat.children || [])) {
          this._pathMap.set(this._slug(ev.label), cat.label);
          for (const sub of (ev.children || [])) {
            this._pathMap.set(this._slug(sub.label), `${cat.label} › ${ev.label}`);
          }
        }
      }
    } else if (this.type === 'locations') {
      for (const loc of data) {
        for (const sub of (loc.children || [])) {
          this._pathMap.set(this._slug(sub.label), loc.label);
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Search
  // ────────────────────────────────────────────────────────────────────────────

  _debounce() {
    clearTimeout(this._debTimer);
    if (!this._inputVal.trim()) {
      this._results   = [];
      this._activeIdx = -1;
      this._render();
      return;
    }
    this._debTimer = setTimeout(() => this._doSearch(), 150);
  }

  async _doSearch() {
    const seq   = ++this._seq;
    const query = this._inputVal;
    const res   = await window.api.matchList(this.type, query);
    if (seq !== this._seq) return; // stale response
    this._results   = res;
    this._activeIdx = res.length ? 0 : -1;
    this._render();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Open / Close
  // ────────────────────────────────────────────────────────────────────────────

  _open() {
    if (this._isOpen) return;
    this._isOpen = true;
    this._dd.hidden = false;
    this._wrap.dataset.open = '';
    this._inp.setAttribute('aria-expanded', 'true');
    this._render();
  }

  _close() {
    if (!this._isOpen) return;
    this._isOpen = false;
    this._dd.hidden = true;
    delete this._wrap.dataset.open;
    this._inp.setAttribute('aria-expanded', 'false');

    // Revert input to selected label (or clear if nothing selected)
    if (this._selected) {
      this._inp.value = this._selected.label;
      this._inputVal  = this._selected.label;
    } else {
      this._inp.value = '';
      this._inputVal  = '';
      this._clearBtn.hidden = true;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Render dispatcher
  // ────────────────────────────────────────────────────────────────────────────

  _render() {
    if (!this._isOpen) return;
    this._dd.innerHTML = '';

    if (this._inputVal.trim()) {
      this._renderSearch();
    } else {
      this._renderTree();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Search mode
  // ────────────────────────────────────────────────────────────────────────────

  _renderSearch() {
    const input = this._inputVal.trim();

    if (this._results.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'tac-empty';
      msg.textContent = 'No matches — browse to select and teach an alias:';
      this._dd.append(msg);
      // Fall through to also render the tree so the user can browse,
      // select an item, and have the typed text learned as an alias.
      this._renderTree();
    } else {
      this._results.forEach((item, i) => {
        const el = document.createElement('div');
        el.className = 'tac-item' + (i === this._activeIdx ? ' tac-active' : '');
        el.setAttribute('role', 'option');
        el.dataset.id    = item.id;
        el.dataset.label = item.label;

        const lbl = document.createElement('span');
        lbl.className = 'tac-item-lbl';
        lbl.innerHTML = this._highlight(item.label, input);

        el.append(lbl);

        if (item.matchType?.startsWith('alias')) {
          const badge = document.createElement('span');
          badge.className = 'tac-alias-badge';
          badge.textContent = 'alias';
          el.append(badge);
        }

        const path = this._pathMap.get(item.id);
        if (path) {
          const bc = document.createElement('span');
          bc.className = 'tac-bc';
          bc.textContent = path;
          el.append(bc);
        }

        el.addEventListener('mousedown', e => { e.preventDefault(); this._select(item.id, item.label); });
        this._dd.append(el);
      });
    }

    // "+ Add" — only when no exact match and list allows it
    const hasExact = this._results.some(r => r.matchType === 'exact');
    if (this.allowAdd && input && !hasExact) {
      const addEl = document.createElement('div');
      addEl.className = 'tac-add';
      addEl.innerHTML = `<span class="tac-add-plus">+</span> Add <em class="tac-add-val">${this._esc(input)}</em>`;
      addEl.addEventListener('mousedown', e => { e.preventDefault(); this._addNew(input); });
      this._dd.append(addEl);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Tree mode
  // ────────────────────────────────────────────────────────────────────────────

  _renderTree() {
    if (!this._fullData) { this._dd.textContent = 'Loading…'; return; }

    if (this.type === 'event-types')  this._renderEventsTree(this._fullData);
    else if (this.type === 'locations') this._renderLocationsTree(this._fullData);
    else                              this._renderFlatHint(this._fullData);
  }

  _renderEventsTree(categories) {
    for (const cat of categories) {
      const catWrap = document.createElement('div');
      catWrap.className = 'tac-cat';

      const hdr = document.createElement('div');
      hdr.className = 'tac-cat-hdr';
      const exp = this._expanded.has(cat.label);
      hdr.innerHTML =
        `<span class="tac-tc">${exp ? '▾' : '▸'}</span>` +
        `<span class="tac-cat-lbl">${this._esc(cat.label)}</span>`;
      hdr.addEventListener('mousedown', e => { e.preventDefault(); this._toggle(cat.label); });
      catWrap.append(hdr);

      if (exp && Array.isArray(cat.children)) {
        const body = document.createElement('div');
        body.className = 'tac-cat-body';

        for (const ev of cat.children) {
          if (Array.isArray(ev.children) && ev.children.length) {
            // Event that also has sub-events
            const evWrap = document.createElement('div');
            evWrap.className = 'tac-ev-parent';

            const evHdr = document.createElement('div');
            evHdr.className = 'tac-ev-hdr';
            const evExp = this._expanded.has(ev.label);
            evHdr.innerHTML =
              `<span class="tac-tc">${evExp ? '▾' : '▸'}</span>` +
              `<span>${this._esc(ev.label)}</span>`;
            evHdr.addEventListener('mousedown', e => { e.preventDefault(); this._toggle(ev.label); });
            evWrap.append(evHdr);

            if (evExp) {
              evWrap.append(this._makeLeaf(ev.label, false, true));
              for (const sub of ev.children) {
                evWrap.append(this._makeLeaf(sub.label, true, false));
              }
            }
            body.append(evWrap);
          } else {
            body.append(this._makeLeaf(ev.label));
          }
        }
        catWrap.append(body);
      }
      this._dd.append(catWrap);
    }
  }

  _renderLocationsTree(locations) {
    for (const loc of locations) {
      if (Array.isArray(loc.children) && loc.children.length) {
        const wrap = document.createElement('div');
        wrap.className = 'tac-ev-parent';

        const hdr = document.createElement('div');
        hdr.className = 'tac-ev-hdr';
        const exp = this._expanded.has(loc.label);
        hdr.innerHTML =
          `<span class="tac-tc">${exp ? '▾' : '▸'}</span>` +
          `<span>${this._esc(loc.label)}</span>`;
        hdr.addEventListener('mousedown', e => { e.preventDefault(); this._toggle(loc.label); });
        wrap.append(hdr);

        if (exp) {
          wrap.append(this._makeLeaf(loc.label, false, true));
          for (const sub of loc.children) {
            wrap.append(this._makeLeaf(sub.label, true, false));
          }
        }
        this._dd.append(wrap);
      } else {
        this._dd.append(this._makeLeaf(loc.label));
      }
    }
  }

  _renderFlatHint(data) {
    const n    = Array.isArray(data) ? data.length : 0;
    const hint = document.createElement('div');
    hint.className = 'tac-flat-hint';
    hint.textContent = `${n} entries — type to search`;
    this._dd.append(hint);
  }

  // ── Leaf factory ─────────────────────────────────────────────────────────────

  _makeLeaf(label, isSub = false, isGeneral = false) {
    const el  = document.createElement('div');
    el.className = 'tac-leaf' +
      (isSub     ? ' tac-leaf-sub'     : '') +
      (isGeneral ? ' tac-leaf-general' : '');
    el.setAttribute('role', 'option');
    el.textContent = isGeneral ? label + ' (general)' : label;
    const id = this._slug(label);
    el.addEventListener('mousedown', e => { e.preventDefault(); this._select(id, label); });
    return el;
  }

  // ── Node toggle ───────────────────────────────────────────────────────────────

  _toggle(key) {
    if (this._expanded.has(key)) this._expanded.delete(key);
    else this._expanded.add(key);
    this._render();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Selection & Add New
  // ────────────────────────────────────────────────────────────────────────────

  async _select(id, label) {
    const prevInput = this._inputVal.trim();

    this._selected  = { id, label };
    this._inp.value = label;
    this._inputVal  = label;
    this._clearBtn.hidden = false;
    this._close();

    // Alias learning: typed something different from the canonical label
    if (prevInput && prevInput.toLowerCase() !== label.toLowerCase()) {
      await window.api.learnAlias(this.type, id, label, prevInput);
    }

    this.onSelect({ id, label });
  }

  async _addNew(rawValue) {
    const result = await window.api.addToList(this.type, rawValue);
    if (!result.success) return;
    // Refresh cached data so new item appears in future tree views
    this._fullData = await window.api.getLists(this.type);
    this._buildPathMap(this._fullData);
    await this._select(this._slug(result.value), result.value);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Keyboard
  // ────────────────────────────────────────────────────────────────────────────

  _onKey(e) {
    if (!this._isOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowDown') { this._open(); e.preventDefault(); }
      return;
    }

    const nav = [...this._dd.querySelectorAll('.tac-item, .tac-leaf, .tac-add')];

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._activeIdx = Math.min(this._activeIdx + 1, nav.length - 1);
      this._syncActive(nav);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._activeIdx = Math.max(this._activeIdx - 1, 0);
      this._syncActive(nav);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const el = nav[this._activeIdx];
      if (el) el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this._close();
    }
  }

  _syncActive(nav) {
    nav.forEach((el, i) => el.classList.toggle('tac-active', i === this._activeIdx));
    nav[this._activeIdx]?.scrollIntoView({ block: 'nearest' });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────────

  _slug(label) {
    return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  _highlight(label, query) {
    // Normalize query the same way the alias engine does so the highlight
    // matches what the engine matched on.
    const normQ = query.toLowerCase().replace(/[.\-_,;:'"()/\\]/g, ' ').replace(/\s+/g, ' ').trim();
    const lo    = label.toLowerCase();
    const idx   = lo.indexOf(normQ);
    if (idx < 0) return this._esc(label);
    return (
      this._esc(label.slice(0, idx)) +
      `<mark class="tac-hl">${this._esc(label.slice(idx, idx + normQ.length))}</mark>` +
      this._esc(label.slice(idx + normQ.length))
    );
  }

  _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────────────────────

  getValue()          { return this._selected; }
  setValue(id, label) {
    this._selected    = { id, label };
    this._inp.value   = label;
    this._inputVal    = label;
    this._clearBtn.hidden = false;
  }
  clear() {
    this._selected    = null;
    this._inp.value   = '';
    this._inputVal    = '';
    this._clearBtn.hidden = true;
    this._results     = [];
    this._render();
    this.onSelect(null);
  }
  setDisabled(v) {
    this._inp.disabled = v;
    this._wrap.classList.toggle('tac-disabled', v);
  }
}

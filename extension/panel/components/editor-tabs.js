const STORE_KEY = 'tabdb_editor_tabs';

export class EditorTabs {
  constructor({ containerEl, editor }) {
    this._container = containerEl;
    this._editor = editor;

    const restored = this._restore();
    if (restored) {
      this._tabs = restored.tabs;
      this._activeId = restored.activeId;
      this._seq = restored.seq;
    } else {
      this._tabs = [{ id: 1, label: 'Query 1', sql: '' }];
      this._activeId = 1;
      this._seq = 1;
    }

    this._editor.value = this.activeTab?.sql ?? '';
    this._render();

    // Persistir el contenido tipeado (debounced) en la pestaña activa.
    this._editor.addEventListener('input', () => {
      const t = this.activeTab;
      if (t) t.sql = this._editor.value;
      this._persistDebounced();
    });
  }

  get activeTab() {
    return this._tabs.find(t => t.id === this._activeId);
  }

  syncFromEditor() {
    const tab = this.activeTab;
    if (tab) tab.sql = this._editor.value;
  }

  get activeSavedId() {
    return this.activeTab?.savedId ?? null;
  }

  closeActive() {
    this._close(this._activeId);
  }

  // Cierra todas las pestañas y deja una vacía.
  closeAll() {
    this._tabs = [{ id: 1, label: 'Query 1', sql: '' }];
    this._activeId = 1;
    this._seq = 1;
    this._editor.value = '';
    this._render();
    this._editor.focus();
  }

  updateActiveTab(label, savedId) {
    const tab = this.activeTab;
    if (!tab) return;
    tab.label = label;
    tab.savedId = savedId;
    this._render();
  }

  openQuery(sql, label, savedId = null) {
    if (savedId) {
      const existing = this._tabs.find(t => t.savedId === savedId);
      if (existing) { this._switchTo(existing.id); return; }
    }
    this._addTab(sql, label, savedId);
  }

  _addTab(sql = '', label = null, savedId = null) {
    this.syncFromEditor();
    this._seq++;
    const id = this._seq;
    this._tabs.push({ id, label: label ?? `Query ${this._seq}`, sql, savedId });
    this._switchTo(id);
  }

  _switchTo(id) {
    this.syncFromEditor();
    this._activeId = id;
    this._editor.value = this.activeTab?.sql ?? '';
    this._editor.focus();
    this._render();
  }

  _close(id) {
    if (this._tabs.length === 1) return;
    const idx = this._tabs.findIndex(t => t.id === id);
    if (idx < 0) return;
    this._tabs.splice(idx, 1);
    if (this._activeId === id) {
      const next = this._tabs[Math.max(0, idx - 1)];
      this._activeId = next.id;
      this._editor.value = next.sql;
    }
    this._render();
  }

  // ── Persistencia (localStorage, por perfil de navegador) ──
  _persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        tabs: this._tabs, activeId: this._activeId, seq: this._seq,
      }));
    } catch { /* storage no disponible */ }
  }

  _persistDebounced() {
    clearTimeout(this._persistT);
    this._persistT = setTimeout(() => this._persist(), 300);
  }

  _restore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!Array.isArray(data.tabs) || data.tabs.length === 0) return null;
      const tabs = data.tabs
        .filter(t => t && typeof t.id === 'number')
        .map(t => ({ id: t.id, label: t.label ?? `Query ${t.id}`, sql: t.sql ?? '', savedId: t.savedId ?? null }));
      if (tabs.length === 0) return null;
      const activeId = tabs.some(t => t.id === data.activeId) ? data.activeId : tabs[0].id;
      const seq = Math.max(data.seq ?? 1, ...tabs.map(t => t.id));
      return { tabs, activeId, seq };
    } catch { return null; }
  }

  _render() {
    this._container.innerHTML = '';
    for (const tab of this._tabs) {
      const el = document.createElement('div');
      el.className = 'editor-tab' + (tab.id === this._activeId ? ' active' : '');

      const label = document.createElement('span');
      label.className = 'editor-tab-label';
      label.textContent = tab.label;
      label.title = tab.sql || tab.label;
      label.addEventListener('click', () => this._switchTo(tab.id));
      el.appendChild(label);

      if (this._tabs.length > 1) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'tab-close';
        closeBtn.textContent = '×';
        closeBtn.title = 'Close tab (Alt+W)';
        closeBtn.addEventListener('click', (e) => { e.stopPropagation(); this._close(tab.id); });
        el.appendChild(closeBtn);
      }

      this._container.appendChild(el);
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'tab-add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'New query tab';
    addBtn.addEventListener('click', () => this._addTab());
    this._container.appendChild(addBtn);

    if (this._tabs.length > 1) {
      const closeAllBtn = document.createElement('button');
      closeAllBtn.className = 'tab-closeall-btn';
      closeAllBtn.textContent = 'Close all';
      closeAllBtn.title = 'Close all tabs';
      closeAllBtn.addEventListener('click', () => this.closeAll());
      this._container.appendChild(closeAllBtn);
    }

    this._persist();
  }
}

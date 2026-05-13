export class EditorTabs {
  constructor({ containerEl, editor }) {
    this._container = containerEl;
    this._editor = editor;
    this._tabs = [{ id: 1, label: 'Query 1', sql: '' }];
    this._activeId = 1;
    this._seq = 1;
    this._render();
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
  }
}

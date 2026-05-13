export class SavedQueries {
  constructor({ listEl, onLoad }) {
    this._listEl = listEl;
    this._onLoad = onLoad;
    this._key = null;
    this._render([]);
  }

  setContext(connection, database) {
    const key = connection && database ? `saved:${connection}:${database}` : null;
    if (key === this._key) return;
    this._key = key;
    this._render([]);
    if (key) this._load();
  }

  async save(name, sql) {
    if (!this._key || !name.trim() || !sql.trim()) return null;
    const entries = await this._read();
    const entry = { id: Date.now(), name: name.trim(), sql, createdAt: new Date().toISOString() };
    entries.unshift(entry);
    await chrome.storage.local.set({ [this._key]: entries });
    this._render(entries);
    return entry.id;
  }

  async update(id, sql) {
    if (!this._key) return;
    const entries = await this._read();
    const entry = entries.find(e => e.id === id);
    if (!entry) return;
    entry.sql = sql;
    await chrome.storage.local.set({ [this._key]: entries });
    this._render(entries);
  }

  async delete(id) {
    if (!this._key) return;
    const entries = (await this._read()).filter(e => e.id !== id);
    await chrome.storage.local.set({ [this._key]: entries });
    this._render(entries);
  }

  async _load() {
    this._render(await this._read());
  }

  async _read() {
    if (!this._key) return [];
    const result = await chrome.storage.local.get(this._key);
    return result[this._key] ?? [];
  }

  _render(entries) {
    this._listEl.innerHTML = '';
    if (!this._key || entries.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'sidebar-msg';
      msg.textContent = this._key ? 'No saved queries' : '—';
      this._listEl.appendChild(msg);
      return;
    }
    for (const entry of entries) {
      const item = document.createElement('div');
      item.className = 'saved-item';

      const name = document.createElement('span');
      name.className = 'saved-item-name';
      name.textContent = entry.name;
      name.title = entry.sql;
      name.addEventListener('click', () => this._onLoad(entry.sql, entry.name, entry.id));
      item.appendChild(name);

      const del = document.createElement('button');
      del.className = 'saved-item-delete icon-btn';
      del.textContent = '×';
      del.title = 'Delete';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${entry.name}"?`)) this.delete(entry.id);
      });
      item.appendChild(del);

      this._listEl.appendChild(item);
    }
  }
}

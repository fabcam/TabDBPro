const STORAGE_KEY = 'tabdb_history';
const MAX_ITEMS = 50;

export class QueryHistory {
  constructor(listEl, onSelect) {
    this.listEl = listEl;
    this.onSelect = onSelect;
    this.items = this._load();
    this._render();
  }

  add(sql) {
    // Deduplicate consecutive identical queries
    if (this.items[0] === sql) return;
    this.items.unshift(sql);
    if (this.items.length > MAX_ITEMS) this.items.pop();
    this._save();
    this._render();
  }

  clear() {
    this.items = [];
    this._save();
    this._render();
  }

  _load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch { return []; }
  }

  _save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
  }

  _render() {
    this.listEl.innerHTML = '';
    for (const sql of this.items) {
      const li = document.createElement('li');
      li.className = 'history-item';
      li.title = sql;
      li.textContent = sql.replace(/\s+/g, ' ').slice(0, 120);
      li.addEventListener('click', () => this.onSelect(sql));
      this.listEl.appendChild(li);
    }
  }
}

export class SchemaTree {
  constructor({ dbListEl, tableListEl, dbLabelEl, onTableClick, onDescribeTable, onDatabaseSwitch }) {
    this.dbListEl = dbListEl;
    this.tableListEl = tableListEl;
    this.dbLabelEl = dbLabelEl;
    this.onTableClick = onTableClick;
    this.onDescribeTable = onDescribeTable;
    this.onDatabaseSwitch = onDatabaseSwitch;
    this.activeTable = null;
    this.currentDb = null;
    this._tables = [];
  }

  get tableNames() { return this._tables.map(t => t.table_name); }

  async load(bridge) {
    this._setTablesLoading();
    try {
      const { databases, current } = await bridge.databases();
      this.currentDb = current;
      this._renderDatabases(databases, current, bridge);
      await this._loadTables(bridge);
    } catch (err) {
      this.dbListEl.innerHTML = `<div class="sidebar-msg error">${err.message}</div>`;
      this.tableListEl.innerHTML = '';
      if (this.dbLabelEl) this.dbLabelEl.textContent = '—';
    }
  }

  async _loadTables(bridge) {
    this._setTablesLoading();
    try {
      const { tables } = await bridge.tables();
      this._renderTables(tables);
    } catch {
      this.tableListEl.innerHTML = '<div class="sidebar-msg error">Failed to load tables</div>';
    }
  }

  _renderDatabases(databases, current, bridge) {
    this.dbListEl.innerHTML = '';
    if (this.dbLabelEl) this.dbLabelEl.textContent = current || '—';

    const makeItem = (db) => {
      const item = document.createElement('div');
      item.className = 'db-item' + (db === current ? ' active' : '');
      item.textContent = db;
      item.title = db;
      item.addEventListener('click', async () => {
        if (db === this.currentDb) return;
        this._clearSwitchError();
        item.classList.add('switching');
        try {
          await bridge.useDatabase(db);
          this.currentDb = db;
          if (this.dbLabelEl) this.dbLabelEl.textContent = db;
          this.dbListEl.querySelectorAll('.db-item').forEach((el) => el.classList.remove('active'));
          item.classList.add('active');
          this.activeTable = null;
          await this._loadTables(bridge);
          this.onDatabaseSwitch?.(db);
        } catch (err) {
          this._showSwitchError(err.message);
        } finally {
          item.classList.remove('switching');
        }
      });
      return item;
    };

    const others = databases.filter(db => db !== current);

    if (!current) {
      // No default DB — show all flat
      for (const db of databases) this.dbListEl.appendChild(makeItem(db));
      return;
    }

    // Current DB always shown first
    this.dbListEl.appendChild(makeItem(current));

    if (others.length === 0) return;

    const collapseEl = document.createElement('div');
    collapseEl.className = 'db-collapse hidden';
    for (const db of others) collapseEl.appendChild(makeItem(db));

    const toggle = document.createElement('div');
    toggle.className = 'db-show-more';
    toggle.textContent = `Show ${others.length} more…`;
    toggle.addEventListener('click', () => {
      const expanded = collapseEl.classList.toggle('hidden');
      toggle.textContent = expanded
        ? `Show ${others.length} more…`
        : `Show less`;
    });

    this.dbListEl.appendChild(toggle);
    this.dbListEl.appendChild(collapseEl);
  }

  _renderTables(tables) {
    this._tables = tables;
    this.tableListEl.innerHTML = '';
    if (!tables.length) {
      this.tableListEl.innerHTML = '<div class="sidebar-msg">No tables found</div>';
      return;
    }
    for (const t of tables) {
      const item = document.createElement('div');
      item.className = 'table-item' + (t.table_name === this.activeTable ? ' active' : '');
      item.textContent = t.table_name;
      item.title = t.table_type;

      item.addEventListener('click', () => {
        this.activeTable = t.table_name;
        this.tableListEl.querySelectorAll('.table-item').forEach((el) => el.classList.remove('active'));
        item.classList.add('active');
      });

      item.addEventListener('dblclick', () => {
        this.onTableClick(t.table_name);
      });

      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.tableListEl.querySelectorAll('.table-item').forEach((el) => el.classList.remove('active'));
        item.classList.add('active');
        this.activeTable = t.table_name;
        this.onDescribeTable?.({ tableName: t.table_name, x: e.clientX, y: e.clientY });
      });

      this.tableListEl.appendChild(item);
    }
  }

  _showSwitchError(msg) {
    this._clearSwitchError();
    const el = document.createElement('div');
    el.className = 'sidebar-msg error db-switch-error';
    el.textContent = msg;
    this.dbListEl.appendChild(el);
  }

  _clearSwitchError() {
    this.dbListEl.querySelector('.db-switch-error')?.remove();
  }

  _setTablesLoading() {
    this.tableListEl.innerHTML = '<div class="sidebar-msg">Loading...</div>';
  }
}

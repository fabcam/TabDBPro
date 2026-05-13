export class NetworkRequests {
  constructor({ panelEl, modalEl, getTableNames, getTableSchema, getDbType, onOpenQuery }) {
    this._panel         = panelEl;
    this._modal         = modalEl;
    this._getTables     = getTableNames;
    this._getSchema     = getTableSchema; // async (tableName) => { columns }
    this._getDbType     = getDbType;
    this._onOpenQuery   = onOpenQuery; // (sql, autoRun) => void
    this._requests      = [];
    this._prefix        = '';
    this._conditions    = [];
    this._table         = '';
    this._columns       = [];

    this._listEl = panelEl.querySelector('.net-list');

    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) this._closeModal(); });
    modalEl.querySelector('#nq-cancel').addEventListener('click', () => this._closeModal());
    modalEl.querySelector('#nq-open').addEventListener('click',   () => this._submit(false));
    modalEl.querySelector('#nq-run').addEventListener('click',    () => this._submit(true));
    panelEl.querySelector('#btn-clear-net').addEventListener('click', () => this.clear());
  }

  setPrefix(prefix) {
    this._prefix = prefix?.trim() ?? '';
    this._renderList();
  }

  add(entry) {
    const type = entry._resourceType;
    if (type !== 'xhr' && type !== 'fetch') return;
    const url = entry.request?.url ?? '';

    this._requests.unshift({
      method:     entry.request.method,
      url,
      status:     entry.response?.status ?? 0,
      durationMs: Math.round(entry.time ?? 0),
    });
    if (this._requests.length > 300) this._requests.pop();
    this._renderList();
  }

  clear() { this._requests = []; this._renderList(); }

  _visible(req) {
    if (!this._prefix) return true;
    return req.url.includes(this._prefix);
  }

  _renderList() {
    this._listEl.innerHTML = '';
    const visible = this._requests.filter(r => this._visible(r));
    if (visible.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'sidebar-msg';
      msg.textContent = this._requests.length === 0
        ? 'No requests captured yet.'
        : 'No requests match the current filter.';
      this._listEl.appendChild(msg);
      return;
    }
    for (const req of visible) {
      const row = document.createElement('div');
      row.className = 'net-row';
      row.title = req.url;

      const method = document.createElement('span');
      method.className = `net-method net-method-${req.method.toLowerCase()}`;
      method.textContent = req.method;

      const path = document.createElement('span');
      path.className = 'net-path';
      path.textContent = shortPath(req.url);

      const status = document.createElement('span');
      status.className = 'net-status' + (req.status >= 400 ? ' net-status-error' : '');
      status.textContent = req.status || '—';

      const dur = document.createElement('span');
      dur.className = 'net-dur';
      dur.textContent = req.durationMs ? `${req.durationMs}ms` : '';

      row.append(method, path, status, dur);
      row.addEventListener('click', () => this._openModal(req));
      this._listEl.appendChild(row);
    }
  }

  // ── Query generator modal ────────────────────────────────────────────────

  async _openModal(req) {
    const tables = this._getTables();
    const parsed = parseRequest(req.url, this._prefix, tables);
    this._conditions = parsed.conditions;
    this._table      = parsed.tableName ?? tables[0] ?? '';
    this._columns    = [];

    // Fetch columns for the selected table — used for condition field selectors
    // and to refine by-* field names against real column names
    if (this._table && this._getSchema) {
      try {
        const { columns } = await this._getSchema(this._table);
        this._columns = columns.map(c => c.column_name);
        for (const cond of this._conditions.filter(c => c._byBase)) {
          const best = findBestColumn(cond._byBase, this._columns);
          if (best) cond.field = best;
          delete cond._byBase;
        }
      } catch {
        this._conditions.forEach(c => delete c._byBase);
      }
    } else {
      this._conditions.forEach(c => delete c._byBase);
    }

    const titleEl = this._modal.querySelector('#nq-title');
    titleEl.textContent = `${req.method} ${shortPath(req.url)}`;
    titleEl.title = req.url;

    const sel = this._modal.querySelector('#nq-table');
    sel.innerHTML = '';
    if (!parsed.tableName) {
      const o = document.createElement('option');
      o.value = ''; o.textContent = '— select table —';
      sel.appendChild(o);
    }
    for (const t of tables) {
      const o = document.createElement('option');
      o.value = t; o.textContent = t; o.selected = t === this._table;
      sel.appendChild(o);
    }
    sel.onchange = async () => {
      this._table   = sel.value;
      this._columns = [];
      if (this._table && this._getSchema) {
        try {
          const { columns } = await this._getSchema(this._table);
          this._columns = columns.map(c => c.column_name);
        } catch {}
      }
      this._renderConditions();
      this._updatePreview();
    };

    this._renderConditions();
    this._updatePreview();
    this._modal.classList.remove('hidden');
  }

  _closeModal() { this._modal.classList.add('hidden'); }

  _renderConditions() {
    const wrap = this._modal.querySelector('#nq-conditions');
    wrap.innerHTML = '';

    this._conditions.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'nq-cond-row';

      const fieldEl = this._columns.length
        ? colSelect(c.field, this._columns, 'nq-cond-field')
        : inp(c.field, 'nq-cond-field', 'column');
      const fieldEvt = this._columns.length ? 'change' : 'input';
      fieldEl.addEventListener(fieldEvt, () => { this._conditions[i].field = fieldEl.value; this._updatePreview(); });

      const opEl = document.createElement('select');
      opEl.className = 'modal-input nq-cond-op';
      for (const op of ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IS NULL']) {
        const o = document.createElement('option');
        o.value = op; o.textContent = op; o.selected = op === c.op;
        opEl.appendChild(o);
      }
      opEl.addEventListener('change', () => {
        this._conditions[i].op = opEl.value;
        valEl.disabled = opEl.value === 'IS NULL';
        this._updatePreview();
      });

      const valEl = inp(c.value ?? '', 'nq-cond-val', 'value');
      valEl.disabled = c.op === 'IS NULL';
      valEl.addEventListener('input', () => { this._conditions[i].value = valEl.value; this._updatePreview(); });

      const del = document.createElement('button');
      del.className = 'icon-btn'; del.textContent = '×';
      del.addEventListener('click', () => { this._conditions.splice(i, 1); this._renderConditions(); this._updatePreview(); });

      row.append(fieldEl, opEl, valEl, del);
      wrap.appendChild(row);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'btn-sm';
    addBtn.textContent = '+ Add condition';
    addBtn.addEventListener('click', () => {
      this._conditions.push({ field: this._columns[0] ?? '', op: '=', value: '' });
      this._renderConditions();
      this._updatePreview();
    });
    wrap.appendChild(addBtn);
  }

  _buildSql() {
    if (!this._table) return '';
    const dbType = this._getDbType();
    const q = (n) => dbType === 'postgres' ? `"${n}"` : `\`${n}\``;

    const active = this._conditions.filter(c => c.field.trim());
    if (active.length === 0) return `SELECT * FROM ${q(this._table)};`;

    const where = active.map(c => {
      if (c.op === 'IS NULL') return `${q(c.field)} IS NULL`;
      return `${q(c.field)} ${c.op} ${sqlValue(c.value)}`;
    });
    return `SELECT * FROM ${q(this._table)}\nWHERE ${where.join('\n  AND ')};`;
  }

  _updatePreview() {
    this._modal.querySelector('#nq-preview').textContent = this._buildSql() || '—';
  }

  _submit(autoRun) {
    const sql = this._buildSql();
    if (!sql) return;
    this._closeModal();
    this._onOpenQuery(sql, autoRun);
  }
}

// ── URL parser ────────────────────────────────────────────────────────────

function parseRequest(rawUrl, prefix, tableNames) {
  let pathname = '', params = {};
  try {
    const u = new URL(rawUrl);
    pathname = u.pathname;
    params   = Object.fromEntries(u.searchParams);
  } catch { return { tableName: null, conditions: [] }; }

  if (prefix) {
    try {
      const pp = new URL(prefix).pathname.replace(/\/$/, '');
      if (pathname.startsWith(pp)) pathname = pathname.slice(pp.length);
    } catch {}
  }

  const isVer  = (s) => /^v\d+$/i.test(s);
  const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  const isId   = (s) => /^\d+$/.test(s) || isUuid(s);
  const toSnake = (s) => s.replace(/-/g, '_');

  const rawSegs = pathname.split('/').filter(s => s && !isVer(s));
  const conditions  = [];
  const resourceSegs = [];

  let i = 0;
  while (i < rawSegs.length) {
    const s      = rawSegs[i];
    const snaked = toSnake(s);

    if (snaked.startsWith('by_')) {
      // by-something/value → WHERE something_id = value  (UUID)
      //                    → WHERE something = value      (plain)
      const fieldBase = snaked.slice(3);
      const nextSeg   = rawSegs[i + 1];
      if (nextSeg) {
        const field = isUuid(nextSeg) ? fieldBase + '_id' : fieldBase;
        // _byBase is used later to refine the field against actual table columns
        conditions.push({ field, value: nextSeg, op: '=', _byBase: fieldBase });
        i += 2;
        continue;
      }
    } else if (isId(s)) {
      // Bare ID → WHERE id = value (field refined later if needed)
      conditions.push({ field: 'id', value: s, op: '=' });
    } else {
      resourceSegs.push(snaked);
    }
    i++;
  }

  const tableName = findBestTable(resourceSegs, tableNames);

  // Query params as extra conditions
  for (const [k, v] of Object.entries(params)) {
    if (!conditions.find(c => c.field === k))
      conditions.push({ field: k, value: v, op: '=' });
  }

  return { tableName, conditions };
}

/**
 * Given ordered resource segments (already snake_cased), find the table
 * that best matches by trying all suffix combinations from longest to shortest.
 * Prefers longer matches and matches that start from the beginning of the path.
 */
function findBestTable(segs, tableNames) {
  if (!segs.length) return null;

  const candidates = [];

  for (let start = 0; start < segs.length; start++) {
    for (let end = segs.length; end > start; end--) {
      const base  = segs.slice(start, end).join('_');
      const len   = end - start;
      // Bonus for matches anchored at the start of the path
      const bonus = start === 0 ? 1 : 0;

      candidates.push({ name: base,           score: len * 2 + bonus });
      candidates.push({ name: singular(base), score: len * 2 + bonus - 0.1 });
      candidates.push({ name: base + 's',     score: len * 2 + bonus - 0.2 });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  for (const c of candidates) {
    const found = tableNames.find(t => t.toLowerCase() === c.name.toLowerCase());
    if (found) return found;
  }
  return null;
}

/**
 * Given a field base (e.g. 'projection') and actual column names,
 * return the column that best represents a FK reference to that entity.
 * Scores based on: contains the base term, coverage ratio, and contains 'id'.
 */
function findBestColumn(fieldBase, colNames) {
  const norm  = (s) => s.toLowerCase().replace(/[_-]/g, '');
  const base  = norm(fieldBase);

  let best = null, bestScore = -Infinity;

  for (const col of colNames) {
    const c = norm(col);
    if (!c.includes(base)) continue; // must contain the base word

    let score = 10; // base match
    score += (base.length / c.length) * 8; // coverage — shorter names score higher
    if (c.includes('id')) score += 4;       // likely an FK column
    // Exact canonical patterns get a big bonus
    if (c === base + 'id' || c === 'id' + base) score += 6;

    if (score > bestScore) { bestScore = score; best = col; }
  }

  return best; // null if nothing contains the base word
}

function singular(w) {
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (/[sx]es$/.test(w))  return w.slice(0, -2);
  if (w.endsWith('s'))    return w.slice(0, -1);
  return w;
}

function sqlValue(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  const s = String(v);
  if (/^\d+$/.test(s))          return s;          // integer
  if (/^\d+\.\d+$/.test(s))     return s;          // float
  if (/^(true|false)$/i.test(s)) return s.toLowerCase(); // boolean
  // UUID or any string — single-quote with escaping
  return `'${s.replace(/'/g, "''")}'`;
}

function shortPath(url) {
  try { const u = new URL(url); return u.pathname + u.search; } catch { return url; }
}

function inp(value, cls, placeholder) {
  const el = document.createElement('input');
  el.className = `modal-input ${cls}`;
  el.value = value; el.placeholder = placeholder ?? '';
  return el;
}

function colSelect(selected, columns, cls) {
  const sel = document.createElement('select');
  sel.className = `modal-input ${cls}`;
  for (const col of columns) {
    const o = document.createElement('option');
    o.value = col; o.textContent = col; o.selected = col === selected;
    sel.appendChild(o);
  }
  // If the current value isn't in the column list (e.g. parsed from URL), add it
  if (selected && !columns.includes(selected)) {
    const o = document.createElement('option');
    o.value = selected; o.textContent = selected; o.selected = true;
    sel.insertBefore(o, sel.firstChild);
  }
  return sel;
}

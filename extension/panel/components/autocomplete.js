const KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'NOT IN',
  'BETWEEN', 'LIKE', 'NOT LIKE', 'EXISTS', 'NOT EXISTS',
  'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'CROSS JOIN', 'ON',
  'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET',
  'DISTINCT', 'AS', 'UNION', 'UNION ALL',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
  'IS NULL', 'IS NOT NULL', 'ASC', 'DESC', 'NULL',
  'COUNT', 'COUNT(*)', 'SUM', 'AVG', 'MIN', 'MAX',
  'COALESCE', 'NULLIF', 'IFNULL', 'IF', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'CONCAT', 'LENGTH', 'LOWER', 'UPPER', 'TRIM', 'SUBSTRING', 'REPLACE',
  'DATE', 'YEAR', 'MONTH', 'DAY', 'DATE_FORMAT',
  'NOW()', 'CURRENT_TIMESTAMP', 'UUID()', 'LAST_INSERT_ID()',
];

const TABLE_TRIGGERS = ['FROM', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'CROSS JOIN', 'UPDATE', 'INSERT INTO'];
const COL_TRIGGERS   = ['SELECT', 'WHERE', 'ON', 'ORDER BY', 'GROUP BY', 'HAVING', 'SET', 'DISTINCT'];

export class SqlAutocomplete {
  constructor({ editorEl, getTableNames, getTableColumns }) {
    this._editor      = editorEl;
    this._getNames    = getTableNames;
    this._getCols     = getTableColumns; // async (tableName) => string[]
    this._colCache    = new Map();
    this._popup       = null;
    this._items       = [];
    this._selIdx      = 0;
    this._currentWord = '';

    editorEl.addEventListener('input',   ()  => this._onInput());
    // Capture phase so this fires before panel.js Tab handler
    editorEl.addEventListener('keydown', (e) => this._onKeydown(e), true);
    editorEl.addEventListener('scroll',  ()  => this._reposition());
    editorEl.addEventListener('blur',    ()  => setTimeout(() => this._hide(), 120));
    // Hide on page scroll but NOT when scrolling inside the popup itself
    document.addEventListener('scroll', (e) => {
      if (this._popup && this._popup.contains(e.target)) return;
      this._hide();
    }, true);
  }

  // ── Public ──────────────────────────────────────────────────────────────────

  hide() { this._hide(); }

  // ── Input handling ──────────────────────────────────────────────────────────

  async _onInput() {
    const { word, partial, context, extra } = this._context();
    if (!partial || partial.length < 1) { this._hide(); return; }
    const items = await this._suggest(partial, context, extra);
    if (!items.length) { this._hide(); return; }
    this._currentWord = word;
    this._show(items);
  }

  _onKeydown(e) {
    if (!this._popup) return;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); this._move(1);  break;
      case 'ArrowUp':   e.preventDefault(); this._move(-1); break;
      case 'Tab':
      case 'Enter':
        if (this._items.length) {
          e.preventDefault();
          e.stopImmediatePropagation(); // prevent panel.js Tab handler from inserting spaces
          this._accept(this._items[this._selIdx]);
        }
        break;
      case 'Escape':    e.preventDefault(); this._hide(); break;
    }
  }

  // ── Context detection ────────────────────────────────────────────────────────

  _context() {
    const pos    = this._editor.selectionStart;
    const before = this._editor.value.slice(0, pos);

    // Current statement (after last ;) — needed for alias resolution
    const stmtStart = before.lastIndexOf(';') + 1;
    const stmt      = before.slice(stmtStart);

    // Current word (including possible alias. prefix)
    const wordMatch = before.match(/[\w.]*$/);
    const word      = wordMatch ? wordMatch[0] : '';

    // alias.column or table.column completion
    if (word.includes('.')) {
      const dot     = word.lastIndexOf('.');
      const prefix  = word.slice(0, dot);
      const partial = word.slice(dot + 1);
      // Resolve alias → real table name
      const aliases   = this._extractAliases(stmt);
      const tableName = aliases.get(prefix) ?? aliases.get(prefix.toLowerCase()) ?? prefix;
      return { word, partial, context: 'col_specific', extra: { tableName, prefix } };
    }

    const upper = stmt.toUpperCase();

    // Last SQL keyword before cursor
    let lastKw = null, lastPos = -1;
    for (const kw of [...TABLE_TRIGGERS, ...COL_TRIGGERS]) {
      const re = new RegExp(`\\b${kw.replace(/ /g, '\\s+')}\\b`, 'gi');
      let m;
      while ((m = re.exec(upper)) !== null) {
        if (m.index > lastPos) { lastPos = m.index; lastKw = kw; }
      }
    }

    if (lastKw && TABLE_TRIGGERS.includes(lastKw))
      return { word, partial: word, context: 'table', extra: {} };

    if (lastKw && COL_TRIGGERS.includes(lastKw)) {
      const tables = this._tablesInStmt(stmt);
      return { word, partial: word, context: 'col_any', extra: { tables } };
    }

    return { word, partial: word, context: 'keyword', extra: {} };
  }

  _tablesInStmt(sql) {
    const tables = [];
    const re = /(?:FROM|JOIN)\s+`?(\w+)`?/gi;
    let m;
    while ((m = re.exec(sql)) !== null) tables.push(m[1]);
    return [...new Set(tables)];
  }

  // Builds alias → tableName map from a SQL statement.
  // Handles: FROM tbl alias, FROM tbl AS alias, JOIN tbl alias, JOIN tbl AS alias
  _extractAliases(sql) {
    const SKIP = new Set([
      'WHERE', 'ON', 'SET', 'AND', 'OR', 'NOT', 'IN', 'AS',
      'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'FULL',
      'JOIN', 'FROM', 'SELECT', 'GROUP', 'ORDER', 'HAVING',
      'LIMIT', 'OFFSET', 'UNION', 'WITH', 'BY',
    ]);
    const aliases = new Map();
    const re = /(?:FROM|JOIN)\s+`?(\w+)`?\s+(?:AS\s+)?([a-zA-Z_]\w*)/gi;
    let m;
    while ((m = re.exec(sql)) !== null) {
      const table = m[1];
      const alias = m[2];
      if (!SKIP.has(alias.toUpperCase())) {
        aliases.set(alias, table);
      }
    }
    return aliases;
  }

  // ── Suggestions ──────────────────────────────────────────────────────────────

  async _suggest(partial, context, extra) {
    const lp = partial.toLowerCase();
    const match = (list, limit = 25) =>
      list
        .filter(s => s.toLowerCase().startsWith(lp) && s.toLowerCase() !== lp)
        .slice(0, limit);

    if (context === 'keyword')
      return match(KEYWORDS).map(s => ({ label: s, insert: s, kind: 'keyword' }));

    if (context === 'table')
      return match(this._getNames(), 200).map(s => ({ label: s, insert: s, kind: 'table' }));

    if (context === 'col_specific') {
      const { tableName, prefix } = extra;
      const cols   = await this._fetchCols(tableName);
      const detail = prefix !== tableName ? `${prefix} → ${tableName}` : tableName;
      return match(cols).map(s => ({ label: s, insert: s, kind: 'column', detail }));
    }

    if (context === 'col_any') {
      const { tables } = extra;
      const colArrays = await Promise.all(tables.map(t => this._fetchCols(t)));
      const cols      = [...new Set(colArrays.flat())];
      const tableHits = match(this._getNames(), 10).map(s => ({ label: s, insert: s, kind: 'table' }));
      const colHits   = match(cols, 20).map(s => ({ label: s, insert: s, kind: 'column' }));
      return [...tableHits, ...colHits];
    }

    return [];
  }

  async _fetchCols(tableName) {
    if (this._colCache.has(tableName)) return this._colCache.get(tableName);
    try {
      const cols = await this._getCols(tableName);
      this._colCache.set(tableName, cols);
      return cols;
    } catch { return []; }
  }

  invalidateCache() { this._colCache.clear(); }

  // ── Popup rendering ──────────────────────────────────────────────────────────

  _show(items) {
    this._hide();
    this._items  = items;
    this._selIdx = 0;

    const popup = document.createElement('div');
    popup.className = 'ac-popup';

    items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'ac-item' + (i === 0 ? ' ac-selected' : '');
      row.dataset.idx = i;

      const badge = document.createElement('span');
      badge.className = `ac-badge ac-badge-${item.kind}`;
      badge.textContent = item.kind === 'keyword' ? 'KW' : item.kind === 'table' ? 'TBL' : 'COL';

      const label = document.createElement('span');
      label.className = 'ac-label';
      label.textContent = item.label;

      if (item.detail) {
        const det = document.createElement('span');
        det.className = 'ac-detail';
        det.textContent = item.detail;
        row.append(badge, label, det);
      } else {
        row.append(badge, label);
      }

      row.addEventListener('mousedown', (e) => { e.preventDefault(); this._accept(item); });
      popup.appendChild(row);
    });

    document.body.appendChild(popup);
    this._popup = popup;
    this._reposition();
  }

  _hide() {
    this._popup?.remove();
    this._popup = null;
    this._items = [];
  }

  _move(delta) {
    if (!this._popup) return;
    const prev = this._selIdx;
    this._selIdx = Math.max(0, Math.min(this._items.length - 1, this._selIdx + delta));
    if (prev === this._selIdx) return;
    const els = this._popup.querySelectorAll('.ac-item');
    els.forEach((el, i) => el.classList.toggle('ac-selected', i === this._selIdx));
    // Scroll within the popup only — scrollIntoView would move the whole page
    const sel = els[this._selIdx];
    if (sel) {
      const { offsetTop, offsetHeight } = sel;
      const { scrollTop, clientHeight } = this._popup;
      if (offsetTop < scrollTop)
        this._popup.scrollTop = offsetTop;
      else if (offsetTop + offsetHeight > scrollTop + clientHeight)
        this._popup.scrollTop = offsetTop + offsetHeight - clientHeight;
    }
  }

  _accept(item) {
    const ta      = this._editor;
    const pos     = ta.selectionStart;
    const before  = ta.value.slice(0, pos);
    const after   = ta.value.slice(pos);
    const wordLen = this._currentWord.length;
    const insert  = item.insert;

    ta.value = before.slice(0, pos - wordLen) + insert + after;
    const newPos = pos - wordLen + insert.length;
    ta.selectionStart = ta.selectionEnd = newPos;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    this._hide();
  }

  // ── Positioning ───────────────────────────────────────────────────────────────

  _reposition() {
    if (!this._popup) return;
    const { x, y } = this._caretCoords();
    const popup    = this._popup;
    const vw       = window.innerWidth;
    const vh       = window.innerHeight;

    popup.style.left   = Math.min(x, vw - 260) + 'px';
    popup.style.top    = 'auto';
    popup.style.bottom = 'auto';

    // Show above caret if not enough space below
    const spaceBelow = vh - y;
    if (spaceBelow < 200 && y > 200) {
      popup.style.bottom = (vh - y + 4) + 'px';
    } else {
      popup.style.top = (y + 2) + 'px';
    }
  }

  _caretCoords() {
    const ta    = this._editor;
    const style = window.getComputedStyle(ta);
    const pos   = ta.selectionStart;

    // Mirror div to measure caret position
    const mirror = document.createElement('div');
    for (const p of [
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
      'letterSpacing', 'lineHeight', 'textTransform',
      'paddingTop', 'paddingLeft', 'paddingRight', 'paddingBottom',
      'borderTopWidth', 'borderLeftWidth', 'borderRightWidth', 'borderBottomWidth',
      'boxSizing', 'tabSize',
    ]) mirror.style[p] = style[p];

    mirror.style.position   = 'fixed';
    mirror.style.visibility = 'hidden';
    mirror.style.overflow   = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordBreak  = 'break-all';
    mirror.style.width      = ta.offsetWidth + 'px';

    const before = document.createTextNode(ta.value.slice(0, pos));
    const caret  = document.createElement('span');
    caret.textContent = '​';
    mirror.append(before, caret);
    document.body.appendChild(mirror);

    const taRect  = ta.getBoundingClientRect();
    const cRect   = caret.getBoundingClientRect();
    const mRect   = mirror.getBoundingClientRect();
    document.body.removeChild(mirror);

    const x = taRect.left + (cRect.left - mRect.left) - ta.scrollLeft;
    const y = taRect.top  + (cRect.bottom - mRect.top) - ta.scrollTop;
    return { x: Math.max(taRect.left, x), y: Math.min(y, taRect.bottom) };
  }
}

export class ResultsTable {
  constructor(headEl, bodyEl) {
    this.head = headEl;
    this.body = bodyEl;
    this._fields = [];
    this._rows = [];
    this._callbacks = null;
    this._fkMap = new Map();
    this._editable = false;
    this._sortState = { col: -1, dir: 0 };
  }

  render(fields, rows, { fkMap = new Map(), onFkClick = null } = {}) {
    this._fields = fields;
    this._rows = rows;
    this._fkMap = fkMap;
    this._callbacks = onFkClick ? { onFkClick } : null;
    this._editable = false;
    this._sortState = { col: -1, dir: 0 };
    this._buildHead(fields, false);
    this._buildBody(fields, rows, false);
  }

  renderEditable(fields, rows, callbacks) {
    this._fields = fields;
    this._rows = rows;
    this._fkMap = callbacks.fkMap ?? new Map();
    this._callbacks = callbacks;
    this._editable = true;
    this._sortState = { col: -1, dir: 0 };
    this._buildHead(fields, true);
    this._buildBody(fields, rows, true);
    this._buildInsertRow(fields);
  }

  _sortedRows() {
    const { col, dir } = this._sortState;
    if (dir === 0 || col < 0) return this._rows;
    return [...this._rows].sort((a, b) => {
      const av = a[col], bv = b[col];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
      return dir * String(av).localeCompare(String(bv));
    });
  }

  _onHeaderClick(colIdx) {
    const s = this._sortState;
    if (s.col === colIdx) {
      if (s.dir === 1)       s.dir = -1;
      else if (s.dir === -1) { s.dir = 0; s.col = -1; }
    } else {
      s.col = colIdx;
      s.dir = 1;
    }
    this._buildHead(this._fields, this._editable);
    this._buildBody(this._fields, this._sortedRows(), this._editable);
    if (this._editable) this._buildInsertRow(this._fields);
  }

  _buildHead(fields, editable) {
    this.head.innerHTML = '';
    const tr = document.createElement('tr');
    fields.forEach((f, i) => {
      const th = document.createElement('th');
      th.title = `type id: ${f.dataTypeID}`;
      th.className = 'th-sortable';

      const label = document.createElement('span');
      label.textContent = f.name;
      th.appendChild(label);

      const ind = document.createElement('span');
      ind.className = 'sort-indicator';
      ind.textContent = this._sortState.col === i
        ? (this._sortState.dir === 1 ? ' ▲' : ' ▼')
        : '';
      th.appendChild(ind);

      th.addEventListener('click', () => this._onHeaderClick(i));
      tr.appendChild(th);
    });
    if (editable) {
      const th = document.createElement('th');
      th.className = 'th-actions';
      tr.appendChild(th);
    }
    this.head.appendChild(tr);
  }

  _buildBody(fields, rows, editable) {
    this.body.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const row of rows) {
      const snapshot = [...row];
      const tr = document.createElement('tr');
      for (let i = 0; i < row.length; i++) {
        const td = document.createElement('td');
        this._setCellContent(td, fields[i].name, row[i]);
        if (editable) {
          td.classList.add('td-editable');
          td.addEventListener('click', () => this._startEdit(td, fields[i].name, snapshot));
        }
        tr.appendChild(td);
      }
      if (editable) tr.appendChild(document.createElement('td'));
      frag.appendChild(tr);
    }
    this.body.appendChild(frag);
  }

  _buildInsertRow(fields) {
    const tr = document.createElement('tr');
    tr.className = 'tr-insert';

    const inputs = fields.map(f => {
      const td = document.createElement('td');
      td.className = 'td-insert';
      const inp = document.createElement('input');
      inp.className = 'cell-input';
      inp.placeholder = f.name;
      inp.title = 'Empty → default  |  NULL → null  |  now() / uuid() → SQL expression';
      inp.addEventListener('input', () => this._applyValueStyles(inp));
      td.appendChild(inp);
      tr.appendChild(td);
      return inp;
    });

    const actionTd = document.createElement('td');
    actionTd.className = 'td-insert-action';
    const btn = document.createElement('button');
    btn.className = 'btn-insert';
    btn.textContent = '＋ Insert';

    const doInsert = async () => {
      const values = inputs.map(inp => inp.value.trim() === '' ? null : inp.value.trim());
      if (values.every(v => v === null)) return;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        await this._callbacks.onInsert(fields, values);
        inputs.forEach(inp => { inp.value = ''; this._applyValueStyles(inp); });
        inputs[0]?.focus();
        tr.classList.add('tr-success');
        setTimeout(() => tr.classList.remove('tr-success'), 700);
      } catch (err) {
        tr.classList.add('tr-error');
        setTimeout(() => tr.classList.remove('tr-error'), 2500);
        this._callbacks.onError?.(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '＋ Insert';
      }
    };

    btn.addEventListener('click', doInsert);
    inputs[inputs.length - 1]?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doInsert(); }
    });

    actionTd.appendChild(btn);
    tr.appendChild(actionTd);
    this.body.appendChild(tr);
  }

  // FK-aware cell content — shows ↗ nav button when fkMap has an entry for fieldName
  _setCellContent(td, fieldName, value) {
    td.innerHTML = '';
    td.classList.remove('null-cell', 'td-fk');

    if (value === null || value === undefined) {
      td.textContent = 'NULL';
      td.classList.add('null-cell');
      return;
    }

    td.title = String(value);
    const fk = this._fkMap?.get(fieldName);
    const onFkClick = this._callbacks?.onFkClick;

    if (fk && onFkClick) {
      td.classList.add('td-fk');
      const span = document.createElement('span');
      span.textContent = String(value);
      td.appendChild(span);

      const btn = document.createElement('button');
      btn.className = 'fk-nav-btn';
      btn.textContent = '↗';
      btn.title = `→ ${fk.refTable} where ${fk.refCol} = ${value}`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onFkClick(fk.refTable, fk.refCol, value);
      });
      td.appendChild(btn);
    } else {
      td.textContent = String(value);
    }
  }

  _classifyEditValue(raw) {
    if (raw.trim() === '') return { kind: 'param', value: null };
    const v = raw.trim();
    if (/^null$/i.test(v)) return { kind: 'param', value: null };
    if (/^\w+\(.*\)$/.test(v) || /^(CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME)$/i.test(v))
      return { kind: 'expr', value: v };
    return { kind: 'param', value: raw };
  }

  _applyValueStyles(inp) {
    const v = inp.value.trim();
    const isNull = /^null$/i.test(v);
    const isExpr = !isNull && (/^\w+\(.*\)$/.test(v) || /^(CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME)$/i.test(v));
    inp.classList.toggle('is-null', isNull);
    inp.classList.toggle('is-expr', isExpr);
  }

  _startEdit(td, fieldName, snapshot) {
    if (td.querySelector('input')) return;

    const isNull = td.classList.contains('null-cell');
    // For FK cells the value lives in a <span>; fall back to textContent for plain cells
    const originalText = isNull ? '' : (td.querySelector('span')?.textContent ?? td.textContent);
    let cancelled = false;
    let confirmed = false;

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = originalText;
    inp.className = 'cell-input cell-input-inline';
    td.innerHTML = '';
    td.classList.remove('null-cell', 'td-fk');
    td.appendChild(inp);
    inp.focus();
    inp.select();

    inp.addEventListener('input', () => this._applyValueStyles(inp));

    const restore = () => {
      td.innerHTML = '';
      this._setCellContent(td, fieldName, isNull ? null : originalText);
    };

    const cancel = () => {
      if (cancelled || confirmed) return;
      cancelled = true;
      restore();
    };

    const confirm = async () => {
      if (cancelled || confirmed) return;
      confirmed = true;

      const parsed = this._classifyEditValue(inp.value);
      if (!isNull && parsed.kind === 'param' && parsed.value === originalText) { restore(); return; }

      td.innerHTML = '<span class="cell-saving">saving…</span>';
      try {
        await this._callbacks.onUpdate(fieldName, parsed, snapshot);
        td.innerHTML = '';
        if (parsed.kind === 'expr') {
          this._setCellContent(td, fieldName, parsed.value);
          this._callbacks.onReload?.();
        } else {
          const idx = this._fields.findIndex(f => f.name === fieldName);
          if (idx >= 0) snapshot[idx] = parsed.value;
          this._setCellContent(td, fieldName, parsed.value);
        }
        td.classList.add('cell-saved');
        setTimeout(() => td.classList.remove('cell-saved'), 700);
      } catch (err) {
        restore();
        td.classList.add('cell-error');
        setTimeout(() => td.classList.remove('cell-error'), 3000);
        this._callbacks.onError?.(err.message);
      }
    };

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); confirm(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    inp.addEventListener('blur', confirm);
  }

  _setValue(td, value) {
    td.classList.remove('null-cell');
    if (value === null || value === undefined) {
      td.textContent = 'NULL';
      td.classList.add('null-cell');
    } else {
      td.textContent = String(value);
      td.title = String(value);
    }
  }

  clear() {
    this.head.innerHTML = '';
    this.body.innerHTML = '';
  }
}

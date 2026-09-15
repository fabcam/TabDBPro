// Diagrama ER: renderiza el grafo del schema (tablas + relaciones FK) como un
// canvas pan/zoomeable con nodos arrastrables. Vanilla JS + SVG (sin dependencias,
// compatible con la CSP de MV3).

const NODE_W     = 220;   // ancho fijo de cada nodo-tabla
const HEADER_H   = 30;    // alto del header de la tabla
const ROW_H      = 22;    // alto de cada fila-columna
const GAP_X      = 90;    // separación horizontal entre capas
const GAP_Y      = 40;    // separación vertical entre nodos de una capa
const WORLD      = 8000;  // tamaño del "mundo" SVG

export class ERDiagram {
  // opts: { panelEl, fetchGraph:()=>Promise, getContext:()=>({connection,database}),
  //         onSelectTable:(name)=>void }
  constructor(opts) {
    this.o = opts;
    this.nodes = new Map();       // name -> { x, y, columns, el }
    this.rels = [];
    this.transform = { s: 1, tx: 0, ty: 0 };
    this.hasContent = false;      // true una vez renderizado (permite show() sin recargar)
    this.selected = null;         // tabla seleccionada (click) → resalta y filtra el export
    this._build();
  }

  // ── DOM base ──────────────────────────────────────────────────────────────
  _build() {
    const p = this.o.panelEl;
    p.classList.add('erd-panel');
    p.innerHTML = `
      <div class="erd-header">
        <span class="erd-title">Schema diagram</span>
        <input class="erd-search" type="text" placeholder="Find table…" spellcheck="false">
        <div class="erd-header-controls">
          <button class="icon-btn erd-fit" title="Fit to screen">⤢ Fit</button>
          <button class="icon-btn erd-reset" title="Reset layout">↺ Reset</button>
          <button class="icon-btn erd-export" title="Export SVG (selected table + related, or all if none selected)">↓ SVG</button>
          <button class="icon-btn erd-close" title="Close">✕</button>
        </div>
      </div>
      <div class="erd-viewport">
        <div class="erd-world">
          <svg class="erd-edges" width="${WORLD}" height="${WORLD}"></svg>
        </div>
        <div class="erd-state erd-loading hidden">Loading schema…</div>
        <div class="erd-state erd-empty hidden">No tables in this database.</div>
        <div class="erd-state erd-error hidden"></div>
      </div>`;

    this.viewport = p.querySelector('.erd-viewport');
    this.world    = p.querySelector('.erd-world');
    this.svg      = p.querySelector('.erd-edges');
    this.searchEl = p.querySelector('.erd-search');

    p.querySelector('.erd-close').addEventListener('click', () => this.close());
    p.querySelector('.erd-fit').addEventListener('click', () => this.fit());
    p.querySelector('.erd-reset').addEventListener('click', () => this.resetLayout());
    p.querySelector('.erd-export').addEventListener('click', () => this.exportSvg());
    this.searchEl.addEventListener('input', () => this._focusSearch(this.searchEl.value));

    this._wirePanZoom();
  }

  // ── Abrir / mostrar / ocultar ───────────────────────────────────────────────
  get visible() { return !this.o.panelEl.classList.contains('hidden'); }

  async toggle() { this.visible ? this.hide() : this.show(); }

  // Abrir desde cero: (re)carga el grafo desde el bridge y muestra.
  async open() {
    this.o.panelEl.classList.remove('hidden');
    await this.load();                    // _render setea this.hasContent
    this.o.onVisibilityChange?.();
  }

  // Volver a mostrar sin recargar (mantiene layout/selección). Si no hay contenido, carga.
  show() {
    if (!this.hasContent) return this.open();
    this.o.panelEl.classList.remove('hidden');
    this.o.onVisibilityChange?.();
  }

  // Ocultar manteniendo el estado renderizado.
  hide() {
    this.o.panelEl.classList.add('hidden');
    this.o.onVisibilityChange?.();
  }

  close() { this.hide(); }               // ✕ del panel = ocultar (se puede reabrir)

  async load() {
    this._showState('loading');
    let graph;
    try {
      graph = await this.o.fetchGraph();
    } catch (err) {
      this._showState('error', err.message || 'Failed to load schema');
      return;
    }
    if (!graph?.tables?.length) { this._showState('empty'); return; }
    await this._hydratePositions();
    this._showState(null);
    this._render(graph);
  }

  // ── Render ───────────────────────────────────────────────────────────────
  _render(graph) {
    // limpiar nodos previos (dejar el svg)
    this.world.querySelectorAll('.erd-node').forEach((n) => n.remove());
    this.svg.innerHTML = '';
    this.nodes.clear();
    this.rels = graph.relationships || [];
    this.selected = null;

    const positions = this._autoLayout(graph);
    const saved = this._loadPositions();

    for (const t of graph.tables) {
      const pos = saved[t.name] || positions[t.name] || { x: 0, y: 0 };
      const el = this._nodeEl(t);
      el.style.left = `${pos.x}px`;
      el.style.top  = `${pos.y}px`;
      this.world.appendChild(el);
      this.nodes.set(t.name, { x: pos.x, y: pos.y, columns: t.columns, el });
      this._makeDraggable(t.name, el);
    }

    this._drawEdges();
    this.fit();
    this.hasContent = true;
  }

  _nodeEl(t) {
    const el = document.createElement('div');
    el.className = 'erd-node';
    el.style.width = `${NODE_W}px`;
    el.dataset.table = t.name;

    const header = document.createElement('div');
    header.className = 'erd-node-header';
    header.textContent = t.name;
    header.title = `${t.name} — click: SELECT * en una pestaña nueva (el diagrama queda abierto)`;
    header.addEventListener('click', (e) => {
      if (this._dragged) return;      // ignorar el click que cierra un drag
      e.stopPropagation();
      this.o.onSelectTable?.(t.name);
    });
    el.appendChild(header);

    for (const c of t.columns) {
      const row = document.createElement('div');
      row.className = 'erd-col';
      row.dataset.col = c.name;
      const badge = c.pk ? '🔑' : (c.fk ? '🔗' : '');
      row.innerHTML =
        `<span class="erd-col-badge">${badge}</span>` +
        `<span class="erd-col-name${c.pk ? ' pk' : ''}">${escapeHtml(c.name)}</span>` +
        `<span class="erd-col-type">${escapeHtml(c.type)}</span>`;
      el.appendChild(row);
    }

    // Click en el cuerpo (no el header) selecciona/deselecciona la tabla.
    el.addEventListener('click', (e) => {
      if (e.target.closest('.erd-node-header')) return;   // el header hace SELECT
      if (this._dragged) return;
      this._toggleSelect(t.name);
    });
    return el;
  }

  _relatedSet(name) {
    const s = new Set();
    for (const r of this.rels) {
      if (r.sourceTable === name) s.add(r.targetTable);
      if (r.targetTable === name) s.add(r.sourceTable);
    }
    return s;
  }

  _toggleSelect(name) {
    this.selected = this.selected === name ? null : name;
    this._applySelection();
  }

  // Resaltado persistente según la selección (o limpio si no hay).
  _applySelection() {
    const name = this.selected;
    const related = name ? this._relatedSet(name) : null;
    this.svg.querySelectorAll('.erd-edge').forEach((p) => {
      const hit = name && (p.dataset.source === name || p.dataset.target === name);
      p.classList.toggle('active', !!hit);
      p.classList.toggle('dim', !!name && !hit);
    });
    this.world.querySelectorAll('.erd-node').forEach((n) => {
      const t = n.dataset.table;
      const inSel = !!name && (t === name || related.has(t));
      n.classList.toggle('dim', !!name && !inSel);
      n.classList.toggle('selected', name === t);
    });
  }

  // ── Layout automático por capas según FKs ──────────────────────────────────
  _autoLayout(graph) {
    const tables = graph.tables.map((t) => t.name);
    const heightOf = (name) => {
      const t = graph.tables.find((x) => x.name === name);
      return HEADER_H + (t ? t.columns.length : 0) * ROW_H;
    };
    // adyacencia: source referencia target
    const out = new Map(tables.map((t) => [t, new Set()]));
    for (const r of graph.relationships || []) {
      if (out.has(r.sourceTable) && r.targetTable !== r.sourceTable) {
        out.get(r.sourceTable).add(r.targetTable);
      }
    }
    // layer = 1 + max(layer de sus targets); con guarda de ciclos
    const layer = new Map();
    const visiting = new Set();
    const calc = (t) => {
      if (layer.has(t)) return layer.get(t);
      if (visiting.has(t)) return 0;   // ciclo
      visiting.add(t);
      let mx = -1;
      for (const dep of out.get(t)) mx = Math.max(mx, calc(dep));
      visiting.delete(t);
      const l = mx + 1;
      layer.set(t, l);
      return l;
    };
    for (const t of tables) calc(t);

    // agrupar por capa y apilar verticalmente
    const byLayer = new Map();
    for (const t of tables) {
      const l = layer.get(t);
      if (!byLayer.has(l)) byLayer.set(l, []);
      byLayer.get(l).push(t);
    }
    const pos = {};
    for (const [l, group] of byLayer) {
      group.sort();
      let y = 40;
      for (const t of group) {
        pos[t] = { x: 40 + l * (NODE_W + GAP_X), y };
        y += heightOf(t) + GAP_Y;
      }
    }
    return pos;
  }

  // ── Aristas FK ─────────────────────────────────────────────────────────────
  // Geometría de una relación (bezier horizontal columna origen → destino).
  _edgeD(r) {
    const s = this.nodes.get(r.sourceTable);
    const t = this.nodes.get(r.targetTable);
    if (!s || !t) return null;
    const sy = this._colY(s, r.sourceColumn);
    const ty = this._colY(t, r.targetColumn);
    const sLeft = s.x + NODE_W / 2 < t.x + NODE_W / 2;
    const sx = sLeft ? s.x + NODE_W : s.x;
    const tx = sLeft ? t.x : t.x + NODE_W;
    const dx = sLeft ? 45 : -45;
    return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
  }

  _drawEdges() {
    this.svg.innerHTML = '';
    for (const r of this.rels) {
      const d = this._edgeD(r);
      if (!d) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'erd-edge');
      path.dataset.source = r.sourceTable;
      path.dataset.target = r.targetTable;
      this.svg.appendChild(path);
    }
  }

  _colY(node, colName) {
    const idx = node.columns.findIndex((c) => c.name === colName);
    const i = idx < 0 ? 0 : idx;
    return node.y + HEADER_H + i * ROW_H + ROW_H / 2;
  }

  // ── Drag de nodos ────────────────────────────────────────────────────────
  _makeDraggable(name, el) {
    const header = el.querySelector('.erd-node-header');
    header.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const node = this.nodes.get(name);
      const startX = e.clientX, startY = e.clientY;
      const origX = node.x, origY = node.y;
      this._dragged = false;
      const move = (ev) => {
        const dx = (ev.clientX - startX) / this.transform.s;
        const dy = (ev.clientY - startY) / this.transform.s;
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) this._dragged = true;
        node.x = origX + dx;
        node.y = origY + dy;
        el.style.left = `${node.x}px`;
        el.style.top  = `${node.y}px`;
        this._drawEdges();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (this._dragged) this._savePositions();
        setTimeout(() => { this._dragged = false; }, 0);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    el.addEventListener('pointerenter', () => this._highlight(name, true));
    el.addEventListener('pointerleave', () => this._highlight(name, false));
  }

  _highlight(name, on) {
    if (this.selected) return;   // hay selección fija: el hover no interfiere
    const related = this._relatedSet(name);
    this.svg.querySelectorAll('.erd-edge').forEach((p) => {
      const hit = p.dataset.source === name || p.dataset.target === name;
      p.classList.toggle('active', on && hit);
      p.classList.toggle('dim', on && !hit);
    });
    this.world.querySelectorAll('.erd-node').forEach((n) => {
      const t = n.dataset.table;
      const hit = t === name || related.has(t);
      n.classList.toggle('dim', on && !hit);
    });
  }

  // ── Pan / zoom ──────────────────────────────────────────────────────────────
  _wirePanZoom() {
    this.viewport.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.erd-node')) return;   // el nodo maneja su propio drag
      const startX = e.clientX, startY = e.clientY;
      const { tx, ty } = this.transform;
      let panned = false;
      const move = (ev) => {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) panned = true;
        this.transform.tx = tx + (ev.clientX - startX);
        this.transform.ty = ty + (ev.clientY - startY);
        this._applyTransform();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (!panned && this.selected) { this.selected = null; this._applySelection(); }  // click en vacío deselecciona
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    this.viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.viewport.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const old = this.transform.s;
      const next = Math.min(2.5, Math.max(0.15, old * (e.deltaY < 0 ? 1.1 : 0.9)));
      // zoom centrado en el cursor
      this.transform.tx = px - (px - this.transform.tx) * (next / old);
      this.transform.ty = py - (py - this.transform.ty) * (next / old);
      this.transform.s = next;
      this._applyTransform();
    }, { passive: false });
  }

  _applyTransform() {
    const { s, tx, ty } = this.transform;
    this.world.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  }

  fit() {
    if (!this.nodes.size) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [, n] of this.nodes) {
      const h = HEADER_H + n.columns.length * ROW_H;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W); maxY = Math.max(maxY, n.y + h);
    }
    const pad = 40;
    const vw = this.viewport.clientWidth, vh = this.viewport.clientHeight;
    const w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
    const s = Math.min(2, Math.max(0.15, Math.min(vw / w, vh / h)));
    this.transform.s = s;
    this.transform.tx = (vw - w * s) / 2 - (minX - pad) * s;
    this.transform.ty = (vh - h * s) / 2 - (minY - pad) * s;
    this._applyTransform();
  }

  _focusSearch(q) {
    const term = q.trim().toLowerCase();
    this.world.querySelectorAll('.erd-node').forEach((n) => {
      const hit = term && n.dataset.table.toLowerCase().includes(term);
      n.classList.toggle('match', !!hit);
      n.classList.toggle('dim', !!term && !hit);
    });
    if (!term) {
      this.world.querySelectorAll('.erd-node').forEach((n) => n.classList.remove('dim'));
      return;
    }
    const first = [...this.nodes.entries()].find(([name]) => name.toLowerCase().includes(term));
    if (first) this._centerOn(first[1]);
  }

  _centerOn(node) {
    const vw = this.viewport.clientWidth, vh = this.viewport.clientHeight;
    const h = HEADER_H + node.columns.length * ROW_H;
    const s = this.transform.s;
    this.transform.tx = vw / 2 - (node.x + NODE_W / 2) * s;
    this.transform.ty = vh / 2 - (node.y + h / 2) * s;
    this._applyTransform();
  }

  resetLayout() {
    const key = this._posKey();
    try { chrome.storage.local.remove(key); } catch {}
    this.load();
  }

  // ── Persistencia de posiciones (por conexión::database) ─────────────────────
  _posKey() {
    const { connection, database } = this.o.getContext?.() || {};
    return `erd_pos::${connection || '?'}::${database || '?'}`;
  }
  _loadPositions() {
    try {
      const raw = this._posCache;
      return raw || {};
    } catch { return {}; }
  }
  async _hydratePositions() {
    try {
      const r = await chrome.storage.local.get(this._posKey());
      this._posCache = r[this._posKey()] || {};
    } catch { this._posCache = {}; }
  }
  _savePositions() {
    const data = {};
    for (const [name, n] of this.nodes) data[name] = { x: Math.round(n.x), y: Math.round(n.y) };
    this._posCache = data;
    try { chrome.storage.local.set({ [this._posKey()]: data }); } catch {}
  }

  // ── Export a SVG vectorial autocontenido ────────────────────────────────────
  exportSvg() {
    if (!this.nodes.size) return;

    // Si hay una tabla seleccionada, exporta solo ella + sus relacionadas; si no, todas.
    const keep = this.selected ? new Set([this.selected, ...this._relatedSet(this.selected)]) : null;
    const nodeEntries = [...this.nodes.entries()].filter(([name]) => !keep || keep.has(name));
    if (nodeEntries.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [, n] of nodeEntries) {
      const h = HEADER_H + n.columns.length * ROW_H;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W); maxY = Math.max(maxY, n.y + h);
    }
    const pad = 30;
    const x0 = minX - pad, y0 = minY - pad;
    const w = (maxX - minX) + pad * 2, h = (maxY - minY) + pad * 2;

    const edges = this.rels
      .filter((r) => !keep || (keep.has(r.sourceTable) && keep.has(r.targetTable)))
      .map((r) => { const d = this._edgeD(r); return d ? `<path d="${d}" fill="none" stroke="#94a3b8" stroke-width="1.5"/>` : ''; })
      .join('');
    const nodes = nodeEntries.map(([name, n]) => this._nodeSvg(name, n)).join('');

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" ` +
      `viewBox="${round(x0)} ${round(y0)} ${round(w)} ${round(h)}">` +
      `<rect x="${round(x0)}" y="${round(y0)}" width="${round(w)}" height="${round(h)}" fill="#ffffff"/>` +
      `<g>${edges}</g><g>${nodes}</g></svg>`;

    const { database } = this.o.getContext?.() || {};
    const suffix = this.selected ? `-${this.selected}` : '';
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `erd-${database || 'schema'}${suffix}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  _nodeSvg(name, n) {
    const cols = n.columns;
    const h = HEADER_H + cols.length * ROW_H;
    const mono = 'font-family="Menlo,Consolas,monospace"';
    let s = `<g transform="translate(${round(n.x)} ${round(n.y)})">`;
    s += `<rect x="0" y="0" width="${NODE_W}" height="${h}" rx="6" fill="#ffffff" stroke="#c8c8cc"/>`;
    s += `<path d="${roundedTopRect(NODE_W, HEADER_H, 6)}" fill="#334155"/>`;
    s += `<text x="10" y="${HEADER_H / 2}" dominant-baseline="middle" fill="#ffffff" font-size="12" ` +
         `font-weight="600" font-family="-apple-system,Segoe UI,sans-serif">${escapeHtml(trunc(name, 26))}</text>`;
    cols.forEach((c, i) => {
      const y = HEADER_H + i * ROW_H;
      if (i > 0) s += `<line x1="0" y1="${y}" x2="${NODE_W}" y2="${y}" stroke="#ececf0"/>`;
      const cy = y + ROW_H / 2;
      const badge = c.pk ? 'PK' : (c.fk ? 'FK' : '');
      if (badge) s += `<text x="8" y="${cy}" dominant-baseline="middle" font-size="8" font-weight="700" ` +
                      `fill="${c.pk ? '#b7791f' : '#2563eb'}" ${mono}>${badge}</text>`;
      s += `<text x="30" y="${cy}" dominant-baseline="middle" font-size="11" fill="#1e1e1e" ${mono}` +
           `${c.pk ? ' font-weight="700"' : ''}>${escapeHtml(trunc(c.name, 18))}</text>`;
      s += `<text x="${NODE_W - 8}" y="${cy}" text-anchor="end" dominant-baseline="middle" font-size="9" ` +
           `fill="#6b7280" ${mono}>${escapeHtml(trunc(c.type, 12))}</text>`;
    });
    return s + '</g>';
  }

  _showState(which, msg) {
    const map = { loading: '.erd-loading', empty: '.erd-empty', error: '.erd-error' };
    for (const sel of Object.values(map)) this.o.panelEl.querySelector(sel).classList.add('hidden');
    if (!which) return;
    const el = this.o.panelEl.querySelector(map[which]);
    if (msg) el.textContent = msg;
    el.classList.remove('hidden');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function trunc(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function round(n) { return Math.round(n); }

// Path de un rectángulo con esquinas superiores redondeadas y base recta.
function roundedTopRect(w, h, r) {
  return `M 0 ${h} L 0 ${r} Q 0 0 ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h} Z`;
}

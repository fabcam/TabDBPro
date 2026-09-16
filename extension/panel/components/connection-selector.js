import { colorName } from './settings.js';

export class ConnectionSelector {
  constructor({ sectionEl, listEl, onSwitch, getColor, beforeSwitch, onSwitchStart }) {
    this.sectionEl = sectionEl;
    this.listEl = listEl;
    this.onSwitch = onSwitch;
    this.beforeSwitch = beforeSwitch;     // async (name) → bool; si false, no cambia
    this.onSwitchStart = onSwitchStart;   // se llama apenas se confirma el cambio (para limpiar UI)
    this.getColor  = getColor ?? (() => null);
    this.currentName = null;
    this.activeFilter = null;   // color actualmente filtrado, o null = todas
    this.filterEl = null;
  }

  async load(bridge) {
    const { connections, current } = await bridge.connections();
    this.currentName = current;
    this._connections = connections;
    this._bridge = bridge;

    if (connections.length <= 1) {
      this.sectionEl.classList.add('hidden');
      return;
    }

    this.sectionEl.classList.remove('hidden');
    this._renderFilter();
    this._render();
  }

  // ── Barra de filtro por color ────────────────────────────────────────────
  _renderFilter() {
    // colores distintos en uso (preservando orden de aparición)
    const colors = [];
    for (const conn of this._connections) {
      const c = this.getColor(conn.name);
      if (c && !colors.includes(c)) colors.push(c);
    }

    if (!this.filterEl) {
      this.filterEl = document.createElement('div');
      this.filterEl.className = 'conn-filter';
      this.listEl.parentNode.insertBefore(this.filterEl, this.listEl);
    }
    this.filterEl.innerHTML = '';

    // solo tiene sentido con ≥2 colores distintos
    if (colors.length < 2) {
      this.filterEl.classList.add('hidden');
      this.activeFilter = null;
      return;
    }
    this.filterEl.classList.remove('hidden');

    for (const color of colors) {
      const sw = document.createElement('span');
      sw.className = 'conn-swatch' + (this.activeFilter === color ? ' active' : '');
      sw.style.background = color;
      sw.title = colorName(color);
      sw.addEventListener('click', () => {
        this.activeFilter = this.activeFilter === color ? null : color;  // toggle
        this._renderFilter();
        this._render();
      });
      this.filterEl.appendChild(sw);
    }
  }

  _render() {
    this.listEl.innerHTML = '';
    for (const conn of this._connections) {
      const color = this.getColor(conn.name);
      if (this.activeFilter && color !== this.activeFilter) continue;   // filtro activo

      const item = document.createElement('div');
      item.className = 'conn-item' + (conn.name === this.currentName ? ' active' : '');

      const dot = document.createElement('span');
      dot.className = 'conn-dot';
      if (color) dot.style.background = color;
      else dot.classList.add(`conn-dot-${conn.type}`);
      dot.title = conn.type;

      const label = document.createElement('span');
      label.className = 'conn-label';
      label.textContent = conn.name;

      item.appendChild(dot);
      item.appendChild(label);

      item.addEventListener('click', async () => {
        if (conn.name === this.currentName) return;
        item.classList.add('switching');
        try {
          if (this.beforeSwitch && !(await this.beforeSwitch(conn.name))) return;   // p.ej. Touch ID
          this.currentName = conn.name;
          this.listEl.querySelectorAll('.conn-item').forEach((el) => el.classList.remove('active'));
          item.classList.add('active');
          this.onSwitchStart?.();                        // limpiar bases/tablas de inmediato
          await this._bridge.useConnection(conn.name);
          this.onSwitch?.(conn.name);
        } catch (err) {
          this._showError(err.message);
        } finally {
          item.classList.remove('switching');
        }
      });

      this.listEl.appendChild(item);
    }
  }

  _showError(msg) {
    this.listEl.querySelector('.conn-error')?.remove();
    const el = document.createElement('div');
    el.className = 'sidebar-msg error conn-error';
    el.textContent = msg;
    this.listEl.appendChild(el);
  }
}

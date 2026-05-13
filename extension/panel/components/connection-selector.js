export class ConnectionSelector {
  constructor({ sectionEl, listEl, onSwitch, getColor }) {
    this.sectionEl = sectionEl;
    this.listEl = listEl;
    this.onSwitch = onSwitch;
    this.getColor  = getColor ?? (() => null);
    this.currentName = null;
  }

  async load(bridge) {
    const { connections, current } = await bridge.connections();
    this.currentName = current;

    if (connections.length <= 1) {
      this.sectionEl.classList.add('hidden');
      return;
    }

    this.sectionEl.classList.remove('hidden');
    this._render(connections, current, bridge);
  }

  _render(connections, current, bridge) {
    this.listEl.innerHTML = '';
    for (const conn of connections) {
      const item = document.createElement('div');
      item.className = 'conn-item' + (conn.name === current ? ' active' : '');

      const dot = document.createElement('span');
      dot.className = 'conn-dot';
      const color = this.getColor(conn.name);
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
          await bridge.useConnection(conn.name);
          this.currentName = conn.name;
          this.listEl.querySelectorAll('.conn-item').forEach((el) => el.classList.remove('active'));
          item.classList.add('active');
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

export class ContextMenu {
  constructor(menuEl) {
    this.menuEl = menuEl;
    this._context = null;
    this._handlers = {};

    menuEl.addEventListener('click', (e) => {
      const item = e.target.closest('[data-action]');
      if (!item) return;
      e.stopPropagation();
      const handler = this._handlers[item.dataset.action];
      handler?.(this._context);
      this.hide();
    });

    document.addEventListener('click', () => this.hide());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hide(); });
  }

  on(action, fn) {
    this._handlers[action] = fn;
    return this;
  }

  show(x, y, context) {
    this._context = context;

    // Update label of the select item
    const selectItem = this.menuEl.querySelector('[data-action="select"]');
    if (selectItem) selectItem.textContent = `SELECT * FROM ${context.tableName}`;

    this.menuEl.style.left = `${x}px`;
    this.menuEl.style.top = `${y}px`;
    this.menuEl.classList.remove('hidden');

    // Flip if off-screen
    const rect = this.menuEl.getBoundingClientRect();
    if (rect.right > window.innerWidth)  this.menuEl.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) this.menuEl.style.top = `${y - rect.height}px`;
  }

  hide() {
    this.menuEl.classList.add('hidden');
  }
}

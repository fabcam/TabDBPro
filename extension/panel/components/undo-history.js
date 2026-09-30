// Pila de undo/redo propia para el textarea. El undo nativo se rompe porque seteamos
// .value programáticamente (autocomplete, Tab, cambio de pestaña); esto lo maneja aparte.
export class UndoHistory {
  constructor(editor) {
    this.ta = editor;
    this.hist = [this._state()];
    this.pos = 0;
    this.applying = false;
    this._t = null;

    editor.addEventListener('input', () => this._onInput());
    editor.addEventListener('keydown', (e) => this._onKey(e));
    // Cambio de pestaña / carga programática de otro contenido → reinicia la historia.
    editor.addEventListener('rehighlight', () => this.reset());
  }

  _state() { return { v: this.ta.value, s: this.ta.selectionStart, e: this.ta.selectionEnd }; }

  reset() {
    clearTimeout(this._t);
    this.hist = [this._state()];
    this.pos = 0;
  }

  _onInput() {
    if (this.applying) return;
    clearTimeout(this._t);
    this._t = setTimeout(() => this._commit(), 250);   // agrupa el tipeo en pasos
  }

  _commit() {
    const st = this._state();
    if (this.hist[this.pos] && this.hist[this.pos].v === st.v) return;
    this.hist = this.hist.slice(0, this.pos + 1);   // descarta el redo pendiente
    this.hist.push(st);
    this.pos = this.hist.length - 1;
    if (this.hist.length > 300) { this.hist.shift(); this.pos--; }
  }

  _apply(st) {
    this.applying = true;
    this.ta.value = st.v;
    this.ta.setSelectionRange(st.s, st.e);
    this.ta.dispatchEvent(new Event('input', { bubbles: true }));   // actualiza resaltado + persistencia
    this.applying = false;
    this.ta.focus();
  }

  _onKey(e) {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); this.undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); e.stopImmediatePropagation(); this.redo(); }
  }

  undo() {
    clearTimeout(this._t); this._commit();   // captura cambios pendientes antes de deshacer
    if (this.pos > 0) { this.pos--; this._apply(this.hist[this.pos]); }
  }

  redo() {
    if (this.pos < this.hist.length - 1) { this.pos++; this._apply(this.hist[this.pos]); }
  }
}

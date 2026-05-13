/**
 * Attach a drag-to-resize handle to a target element.
 * axis:   'x' resizes width, 'y' resizes height
 * invert: true when dragging in the opposite direction grows the panel
 *         (e.g. dragging the top edge of a bottom-anchored panel upward)
 */
export function makeResizable(handle, target, axis, { invert = false, min = 60 } = {}) {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startPos  = axis === 'x' ? e.clientX : e.clientY;
    const startSize = axis === 'x'
      ? target.getBoundingClientRect().width
      : target.getBoundingClientRect().height;

    const cursor = axis === 'x' ? 'ew-resize' : 'ns-resize';
    document.body.style.cursor     = cursor;
    document.body.style.userSelect = 'none';
    handle.classList.add('dragging');

    const onMove = (e) => {
      const pos   = axis === 'x' ? e.clientX : e.clientY;
      const delta = invert ? startPos - pos : pos - startPos;
      const size  = Math.max(min, startSize + delta);
      target.style[axis === 'x' ? 'width' : 'height'] = size + 'px';
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',  onUp);
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
      handle.classList.remove('dragging');
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',  onUp);
  });
}

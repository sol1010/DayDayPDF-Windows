export function bindMobileToolbarGesture(bar, { moveBar, finishBar, clamp, longPressMs }) {
  let active = null, suppressClickUntil = 0;
  const stopClick = event => {
    if (Date.now() >= suppressClickUntil) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  bar.addEventListener('click', stopClick, true);
  bar.addEventListener('touchstart', event => {
    const select = event.target.closest('select');
    if (!event.target.closest('input[type="range"]') && (!select || typeof select.showPicker === 'function')) event.preventDefault();
  }, { capture: true, passive: false });
  bar.addEventListener('touchend', event => {
    if (!event.target.closest('input[type="range"]') && Date.now() < suppressClickUntil) event.preventDefault();
  }, { capture: true, passive: false });
  bar.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' || !event.isPrimary || active) return;
    suppressClickUntil = 0;
    const control = event.target.closest('input,select,textarea') || event.target.closest('label')?.control;
    if (control?.type === 'range') return;
    if (control && control.tagName !== 'SELECT') event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, left: bar.offsetLeft,
      top: bar.offsetTop, scrollLeft: bar.scrollLeft, id: event.pointerId };
    let mode = 'waiting';
    const timer = setTimeout(() => {
      mode = 'drag';
      bar.classList.add('mobileToolbarDragging');
      bar._mobileLongPressUntil = Date.now() + 900;
      try { bar.setPointerCapture(start.id); } catch {}
    }, longPressMs);
    const move = next => {
      if (next.pointerId !== start.id) return;
      const dx = next.clientX - start.x, dy = next.clientY - start.y;
      if (mode === 'waiting' && Math.hypot(dx, dy) >= 6) {
        clearTimeout(timer);
        mode = 'scroll';
      }
      if (mode === 'waiting') return;
      next.preventDefault(); next.stopPropagation();
      if (mode === 'scroll') bar.scrollLeft = start.scrollLeft - dx;
      else moveBar(clamp(start.left + dx, bar.offsetWidth, window.innerWidth, 6),
        clamp(start.top + dy, bar.offsetHeight, window.innerHeight, 6));
    };
    const finish = next => {
      if (next.pointerId !== start.id) return;
      clearTimeout(timer); active = null;
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      bar.classList.remove('mobileToolbarDragging');
      if (mode !== 'waiting' || next.type === 'pointercancel') {
        suppressClickUntil = Date.now() + 500;
        if (mode === 'drag') finishBar();
        return;
      }
      if (!control) {
        const button = event.target.closest('button');
        if (button && !button.disabled) button.click();
        suppressClickUntil = Date.now() + 500;
        return;
      }
      if (control.disabled) return;
      if (control.tagName === 'SELECT') {
        if (typeof control.showPicker === 'function') {
          control.focus({ preventScroll: true });
          try { control.showPicker(); } catch {}
        }
        return;
      }
      if (control.type === 'checkbox' || control.type === 'radio') {
        control.click();
        suppressClickUntil = Date.now() + 500;
        return;
      }
      suppressClickUntil = Date.now() + 500;
      control.focus({ preventScroll: true });
      if (control.type === 'number') control.select();
    };
    active = start;
    window.addEventListener('pointermove', move, { passive: false, capture: true });
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
  }, { capture: true, passive: false });
  bar.addEventListener('contextmenu', event => {
    if (Date.now() > (+bar._mobileLongPressUntil || 0)) return;
    event.preventDefault(); event.stopPropagation();
  });
}

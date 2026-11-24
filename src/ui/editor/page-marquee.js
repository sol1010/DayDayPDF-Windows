export function startPageMarquee({ windowObject, viewer, event, isActive,
  acceptsPage = () => true, onClick = () => {}, onSelect }) {
  if (event.button !== 0 || !isActive()) return false;
  if (event.target.closest('button, input, select, textarea, .origEdit')) return false;
  const initialPage = event.target.closest('.pageWrap');
  if (initialPage && !acceptsPage(initialPage)) return false;
  const pages = [...viewer.querySelectorAll('.pageWrap')].filter(acceptsPage);
  if (!pages.length) return false;
  const documentObject = windowObject.document;
  const startX = event.clientX, startY = event.clientY;
  const viewport = viewer.getBoundingClientRect();
  if (startX >= viewport.left + viewer.clientLeft + viewer.clientWidth ||
      startY >= viewport.top + viewer.clientTop + viewer.clientHeight) return false;
  event.preventDefault(); event.stopPropagation();
  documentObject.activeElement?.blur?.();
  let box = null, lastEvent = event;
  const rectFor = point => ({ left: Math.min(startX, point.clientX), right: Math.max(startX, point.clientX),
    top: Math.min(startY, point.clientY), bottom: Math.max(startY, point.clientY) });
  function choosePage(point, rect) {
    if (initialPage) return initialPage.isConnected ? initialPage : null;
    let best = null, largest = 0;
    for (const page of pages) {
      if (!page.isConnected) continue;
      const r = page.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(rect.right, r.right) - Math.max(rect.left, r.left)) *
        Math.max(0, Math.min(rect.bottom, r.bottom) - Math.max(rect.top, r.top));
      if (!overlap) continue;
      if (point.clientX >= r.left && point.clientX <= r.right &&
          point.clientY >= r.top && point.clientY <= r.bottom) return page;
      if (overlap > largest) { best = page; largest = overlap; }
    }
    return best;
  }
  function cleanup() {
    box?.remove();
    windowObject.removeEventListener('mousemove', move);
    windowObject.removeEventListener('mouseup', up);
    windowObject.removeEventListener('keydown', keydown, true);
    windowObject.removeEventListener('blur', cleanup);
    windowObject.removeEventListener('resize', cleanup);
    viewer.removeEventListener('scroll', redraw);
  }
  function redraw() { move(lastEvent); }
  function move(point) {
    lastEvent = point;
    if (!isActive()) { cleanup(); return; }
    if (!box) {
      if (Math.hypot(point.clientX - startX, point.clientY - startY) < 5) return;
      box = documentObject.createElement('div');
      box.className = 'origMarq'; box.style.position = 'fixed'; box.style.boxSizing = 'border-box';
      box.setAttribute('aria-hidden', 'true');
      documentObject.body.appendChild(box);
    }
    const rect = rectFor(point), view = viewer.getBoundingClientRect();
    const left = Math.max(rect.left, view.left + viewer.clientLeft);
    const top = Math.max(rect.top, view.top + viewer.clientTop);
    const right = Math.min(rect.right, view.left + viewer.clientLeft + viewer.clientWidth);
    const bottom = Math.min(rect.bottom, view.top + viewer.clientTop + viewer.clientHeight);
    Object.assign(box.style, { left: left + 'px', top: top + 'px',
      width: Math.max(0, right - left) + 'px', height: Math.max(0, bottom - top) + 'px' });
  }
  function up(point) {
    const dragged = !!box;
    cleanup();
    if (!isActive()) return;
    if (!dragged) { onClick(initialPage); return; }
    const rect = rectFor(point), page = choosePage(point, rect);
    onSelect(page, rect, { startX, startY, endX: point.clientX, endY: point.clientY });
  }
  function keydown(keyEvent) { if (keyEvent.key === 'Escape') cleanup(); }
  windowObject.addEventListener('mousemove', move);
  windowObject.addEventListener('mouseup', up);
  windowObject.addEventListener('keydown', keydown, true);
  windowObject.addEventListener('blur', cleanup);
  windowObject.addEventListener('resize', cleanup);
  viewer.addEventListener('scroll', redraw, { passive: true });
  return true;
}

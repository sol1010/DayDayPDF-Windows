export function createViewportZoom({ viewer, getZoom, getDocument, applyZoom, settleZoom = () => {} }) {
  let pinch = null;
  function capture(x, y) {
    let anchor = null, nearest = Infinity;
    for (const page of viewer.querySelectorAll('.pageWrap')) {
      if (page.style.display === 'none') continue;
      const rect = page.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const dx = Math.max(rect.left - x, 0, x - rect.right);
      const dy = Math.max(rect.top - y, 0, y - rect.bottom);
      const distance = dx * dx + dy * dy;
      if (distance < nearest) {
        nearest = distance;
        anchor = { page, fx: (x - rect.left) / rect.width, fy: (y - rect.top) / rect.height };
      }
    }
    return anchor;
  }
  function apply(zoom, x, y, anchor) {
    if (!anchor?.page.isConnected || !Number.isFinite(zoom) || zoom <= 0) return;
    if (zoom !== getZoom()) applyZoom(zoom);
    const rect = anchor.page.getBoundingClientRect();
    viewer.scrollLeft += rect.left + anchor.fx * rect.width - x;
    viewer.scrollTop += rect.top + anchor.fy * rect.height - y;
  }
  function capturePageCenter(page) {
    const rect = page?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return null;
    const view = viewer.getBoundingClientRect();
    return {
      fx: (view.left + viewer.clientWidth / 2 - rect.left) / rect.width,
      fy: (view.top + viewer.clientHeight / 2 - rect.top) / rect.height,
      zoom: getZoom(),
    };
  }
  function restorePageCenter(page, saved) {
    if (saved.zoom !== getZoom()) applyZoom(saved.zoom);
    const view = viewer.getBoundingClientRect();
    apply(saved.zoom, view.left + viewer.clientWidth / 2, view.top + viewer.clientHeight / 2,
          { page, fx: saved.fx, fy: saved.fy });
  }
  function to(zoom) {
    const rect = viewer.getBoundingClientRect();
    const x = rect.left + viewer.clientWidth / 2, y = rect.top + viewer.clientHeight / 2;
    const anchor = capture(x, y);
    if (anchor) apply(zoom, x, y, anchor);
    else if (Number.isFinite(zoom) && zoom > 0) applyZoom(zoom);
  }
  function atPoint(factor, x, y) {
    apply(getZoom() * factor, x, y, capture(x, y));
  }
  function beginPinch(x, y) {
    pinch = { anchor: capture(x, y), zoom: getZoom(), document: getDocument() };
  }
  function movePinch(factor, x, y) {
    if (!pinch || pinch.document !== getDocument()) return;
    apply(pinch.zoom * factor, x, y, pinch.anchor);
  }
  function endPinch() {
    if (pinch) settleZoom();
    pinch = null;
  }
  return Object.freeze({ to, atPoint, beginPinch, movePinch, endPinch, capturePageCenter, restorePageCenter });
}

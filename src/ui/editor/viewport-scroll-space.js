export function createViewportScrollSpace({ viewer, windowObject: win }) {
  let observer = null, space = 0;
  function resize() {
    const next = Math.max(0, viewer.clientHeight / 2 - 24) / 2;
    if (next === space) return;
    const top = viewer.scrollTop, delta = next - space;
    space = next;
    viewer.style.setProperty('--page-scroll-space', `${space}px`);
    if (viewer.querySelector('.pageWrap')) viewer.scrollTop = top + delta;
  }
  function align(wraps, fromBottom = false) {
    const rects = [...wraps].filter(w => w.style.display !== 'none').map(w => w.getBoundingClientRect());
    if (!rects.length) return;
    const view = viewer.getBoundingClientRect();
    const top = Math.min(...rects.map(r => r.top)), bottom = Math.max(...rects.map(r => r.bottom));
    const height = bottom - top;
    const offset = height <= viewer.clientHeight - 48
      ? (top + bottom) / 2 - view.top - viewer.clientHeight / 2
      : fromBottom ? bottom - view.top - viewer.clientHeight + 24 : top - view.top - 24;
    viewer.scrollTop += offset;
  }
  function mount() {
    if (observer) return false;
    resize();
    observer = new win.ResizeObserver(resize);
    observer.observe(viewer);
    return true;
  }
  function dispose() {
    if (!observer) return false;
    observer.disconnect();
    observer = null;
    return true;
  }
  return Object.freeze({ name: 'viewport-scroll-space', mount, dispose, align });
}

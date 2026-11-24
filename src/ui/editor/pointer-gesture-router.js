export function createPointerGestureRouter({
  documentObject,
  viewer,
  sidebar,
  isMobileLayout,
  onViewerScale,
  onSidebarScale,
  onViewerPointerDown,
  onViewerPinchStart = () => {},
  onViewerPinchEnd = () => {},
  onSidebarPinchStart = () => {},
}) {
  let mounted = false;
  let cleanups = [];

  function listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    cleanups.push(() => target.removeEventListener(type, listener, options));
  }

  function pinchify(element, onScale, onStart, onEnd = () => {}) {
    let gesture = null, consumeUntilRelease = false;
    const ownedIds = new Set(), targets = new Set(), handled = new WeakSet();
    const touches = event => [...event.touches].filter(touch =>
      ownedIds.has(touch.identifier) || element.contains(touch.target));
    const stop = () => { if (gesture) onEnd(); gesture = null; };
    const releaseTargets = () => {
      for (const target of targets) {
        target.removeEventListener('touchmove', move, true);
        target.removeEventListener('touchend', end, true);
        target.removeEventListener('touchcancel', end, true);
      }
      targets.clear(); ownedIds.clear();
    };
    const start = event => {
      const points = touches(event);
      if (points.length !== 2 || gesture) return;
      const [a, b] = points, distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (!distance) return;
      if (event.cancelable) event.preventDefault();
      gesture = { ids: [a.identifier, b.identifier], distance };
      consumeUntilRelease = true;
      for (const touch of points) {
        ownedIds.add(touch.identifier);
        if (touch.target === element || targets.has(touch.target)) continue;
        targets.add(touch.target);
        touch.target.addEventListener('touchmove', move, { capture: true, passive: false });
        touch.target.addEventListener('touchend', end, { capture: true, passive: false });
        touch.target.addEventListener('touchcancel', end, { capture: true, passive: false });
      }
      onStart((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    };
    const move = event => {
      if (handled.has(event)) return;
      handled.add(event);
      if (!consumeUntilRelease) return;  
      if (event.cancelable) event.preventDefault();
      if (!gesture) return;
      const points = touches(event);
      const [a, b] = gesture.ids.map(id => points.find(touch => touch.identifier === id));
      if (!a || !b) { stop(); return; }
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (distance > 0) onScale(distance / gesture.distance,
        (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    };
    const end = event => {
      if (handled.has(event)) return;
      handled.add(event);
      if (consumeUntilRelease && event.cancelable) event.preventDefault();
      const points = touches(event);
      if (gesture && (event.type === 'touchcancel' ||
          !gesture.ids.every(id => points.some(touch => touch.identifier === id)))) stop();
      if (!points.length) { consumeUntilRelease = false; releaseTargets(); }
    };
    listen(element, 'touchstart', start, { passive: false });
    listen(element, 'touchmove', move, { passive: false });
    listen(element, 'touchend', end, { passive: false });
    listen(element, 'touchcancel', end, { passive: false });
    cleanups.push(() => { stop(); releaseTargets(); });
  }

  function mount() {
    if (mounted) return false;
    mounted = true;
    for (const type of ['gesturestart', 'gesturechange', 'gestureend'])
      listen(documentObject, type, event => event.preventDefault(), { passive: false });
    pinchify(viewer, onViewerScale, onViewerPinchStart, onViewerPinchEnd);
    pinchify(sidebar, onSidebarScale, onSidebarPinchStart);
    listen(viewer, 'pointerdown', onViewerPointerDown, true);
    if (isMobileLayout()) sidebar.classList.add('hidden');
    return true;
  }

  function dispose() {
    if (!mounted) return false;
    for (const cleanup of cleanups.splice(0).reverse()) {
      try { cleanup(); } catch {}
    }
    mounted = false;
    return true;
  }

  return Object.freeze({ name: 'pointer-gestures', mount, dispose, get mounted() { return mounted; } });
}

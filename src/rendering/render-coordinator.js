export const createRenderCoordinator = ({
  viewer, renderPage, pageForWrap, cleanupPage, createObserver,
  requestFrame, setTimer, now, maxCacheBytes, releaseExtraLayers = () => {},
}) => {
  const queue = new Set();
  const blobCache = new Map();
  const pendingCache = new Map();
  const sourceGenerations = new Map();
  let queueTimer = null;
  let queueBusy = false;
  let activeWrap = null;
  let blobBytes = 0;

  function schedule() {
    if (queueTimer) return;
    queueTimer = setTimer(() => {
      queueTimer = null;
      process();
    }, 40);
  }

  function enqueue(wrap) {
    queue.add(wrap);
    schedule();
  }

  function focus(wrap) {
    if (!wrap?.isConnected || wrap.style.display === 'none') return;
    queue.add(wrap);
    if (activeWrap && activeWrap !== wrap) {
      const view = viewer.getBoundingClientRect(), rect = activeWrap.getBoundingClientRect();
      if (activeWrap.style.display === 'none' || rect.bottom <= view.top || rect.top >= view.bottom) {
        activeWrap._renderGen = (activeWrap._renderGen || 0) + 1;
        activeWrap._task?.cancel();
        if (activeWrap.isConnected) queue.add(activeWrap);
      }
    }
    if (!queueBusy) schedule();
  }

  async function process() {
    if (queueBusy) return;
    queueBusy = true;
    try {
      while (queue.size) {
        const viewerRect = viewer.getBoundingClientRect();
        const center = viewerRect.top + viewerRect.height / 2;
        let best = null;
        let bestDistance = Infinity;
        let bestVisible = false;
        for (const wrap of queue) {
          if (!wrap.isConnected || wrap.style.display === 'none') {
            queue.delete(wrap);
            continue;
          }
          const rect = wrap.getBoundingClientRect();
          if (rect.bottom < viewerRect.top - 700 || rect.top > viewerRect.bottom + 700) {
            queue.delete(wrap);
            continue;
          }
          const distance = Math.abs((rect.top + rect.bottom) / 2 - center);
          const visible = rect.bottom > viewerRect.top && rect.top < viewerRect.bottom;
          if (!best || (visible && !bestVisible) || (visible === bestVisible && distance < bestDistance)) {
            bestDistance = distance;
            bestVisible = visible;
            best = wrap;
          }
        }
        if (!best) break;
        queue.delete(best);
        activeWrap = best;
        try { await renderPage(best); } finally { activeWrap = null; }
        await new Promise(resolve => requestFrame(resolve));
      }
    } finally {
      queueBusy = false;
      if (queue.size) schedule();
    }
  }

  function releaseWrap(wrap) {
    queue.delete(wrap);
    wrap._renderGen = (wrap._renderGen || 0) + 1;
    try { wrap._task?.cancel(); } catch {}
    releaseExtraLayers(wrap);
    if (wrap.dataset.rendered || wrap.dataset.pageId) {
      const canvas = wrap.querySelector('canvas');
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      delete wrap.dataset.rendered;
      delete wrap.dataset.pageId;
    }
    cleanupPage(pageForWrap(wrap));
  }

  const observer = createObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) enqueue(entry.target);
      else releaseWrap(entry.target);
    }
  }, { root: viewer, rootMargin: '600px 0px' });

  function cacheGet(key) {
    const entry = blobCache.get(key);
    if (entry) entry.last = now();
    return entry;
  }

  function cacheCanvas(sourceId, key, canvas, cssWidth, cssHeight) {
    const generation = sourceGenerations.get(sourceId) || 0;
    let finish;
    const ready = new Promise(resolve => { finish = resolve; });
    pendingCache.set(key, { sourceId, ready });
    const complete = () => {
      if (pendingCache.get(key)?.ready === ready) pendingCache.delete(key);
      finish();
    };
    try {
      canvas.toBlob(blob => {
        if (!blob || (sourceGenerations.get(sourceId) || 0) !== generation ||
            pendingCache.get(key)?.ready !== ready) { complete(); return; }
        const previous = blobCache.get(key);
        if (previous) blobBytes -= previous.bytes;
        blobCache.set(key, {
          sourceId, blob, cssW: cssWidth, cssH: cssHeight, bytes: blob.size, last: now(),
        });
        blobBytes += blob.size;
        complete();
        if (blobBytes <= maxCacheBytes) return;
        const oldest = [...blobCache.entries()].sort((a, b) => a[1].last - b[1].last);
        for (const [oldKey, entry] of oldest) {
          if (blobBytes <= maxCacheBytes * .9) break;
          blobCache.delete(oldKey);
          blobBytes -= entry.bytes;
        }
      }, 'image/png');
    } catch { complete(); }
    return ready;
  }

  function cacheGetReady(key) {
    const pending = pendingCache.get(key);
    return pending ? pending.ready.then(() => cacheGet(key)) : cacheGet(key);
  }

  function invalidateSource(sourceId) {
    sourceGenerations.set(sourceId, (sourceGenerations.get(sourceId) || 0) + 1);
    for (const [key, entry] of pendingCache)
      if (entry.sourceId === sourceId) pendingCache.delete(key);
    for (const [key, entry] of blobCache) {
      if (entry.sourceId !== sourceId) continue;
      blobCache.delete(key);
      blobBytes -= entry.bytes;
    }
  }

  return Object.freeze({
    enqueue,
    focus,
    schedule,
    process,
    observer,
    has: wrap => queue.has(wrap),
    remove: wrap => queue.delete(wrap),
    cacheHas: key => blobCache.has(key) || pendingCache.has(key),
    cacheGet,
    cacheGetReady,
    cacheCanvas,
    invalidateSource,
    get busy() { return queueBusy; },
    get size() { return queue.size; },
    get cacheBytes() { return blobBytes; },
  });
};

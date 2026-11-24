export const createThumbnailCoordinator = ({
  sidebar, renderThumbnail, mainRenderPending, thumbKey, pageForWrap,
  createBitmap, createObjectUrl, revokeObjectUrl, createObserver,
  requestFrame, setTimer, clearTimer, now, maxCacheBytes,
}) => {
  const queue = new Set();
  const blobCache = new Map();
  const sourceGenerations = new Map();
  const blankImage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  let queueTimer = null;
  let queueBusy = false;
  let paused = false;
  let scrolling = false;
  let scrollIdleTimer = null;
  let activeRender = null;
  let blobBytes = 0;
  let trimTimer = null;

  function cacheGet(key) {
    const entry = blobCache.get(key);
    if (entry) entry.last = now();
    return entry;
  }

  function cachePut(sourceId, key, blob, width, height) {
    const previous = blobCache.get(key);
    if (previous) blobBytes -= previous.bytes;
    blobCache.set(key, {
      sourceId, blob, w: width, h: height, bytes: blob.size, last: now(),
    });
    blobBytes += blob.size;
    if (blobBytes > maxCacheBytes) scheduleTrim();
  }

  function clearImage(element) {
    const image = element.querySelector('img');
    if (!image) return;
    const url = image.dataset.url;
    if (url) {
      revokeObjectUrl(url);
      delete image.dataset.url;
    }
    image.src = blankImage;
    delete element.dataset.rendered;
    delete element.dataset.preview;
  }

  function setImage(element, key, blob, width, height, preview = false) {
    const image = element.querySelector('img');
    if (!image) return;
    if (width > 0 && height > 0) image.style.aspectRatio = (width / height).toFixed(4);
    const url = createObjectUrl(blob);
    const previous = image.dataset.url;
    image.src = url;
    image.dataset.url = url;
    if (previous) revokeObjectUrl(previous);
    if (preview) {
      element.dataset.preview = key;
      delete element.dataset.rendered;
    } else {
      element.dataset.rendered = key;
      delete element.dataset.preview;
    }
  }

  function scheduleTrim() {
    clearTimer(trimTimer);
    trimTimer = setTimer(() => {
      if (blobBytes <= maxCacheBytes) return;
      const inUse = new Set();
      sidebar.querySelectorAll('.thumb[data-rendered]').forEach(thumb => inUse.add(thumb.dataset.rendered));
      const oldest = [...blobCache.entries()]
        .filter(([key]) => !inUse.has(key))
        .sort((a, b) => a[1].last - b[1].last);
      for (const [key, entry] of oldest) {
        if (blobBytes <= maxCacheBytes * .9) break;
        blobCache.delete(key);
        blobBytes -= entry.bytes;
      }
    }, 250);
  }

  function setPaused(value) {
    if (paused === value) return;
    paused = value;
    if (paused) {
      clearTimer(queueTimer);
      queueTimer = null;
    } else if (queue.size) schedule(0);
  }

  function schedule(delay = 40) {
    if (paused) return;
    if (queueTimer) {
      if (delay !== 0) return;
      clearTimer(queueTimer);
    }
    queueTimer = setTimer(() => {
      queueTimer = null;
      process();
    }, scrolling ? 60 : delay);
  }

  function enqueue(element) {
    queue.add(element);
    schedule();
  }

  async function process() {
    if (paused || queueBusy) return;
    queueBusy = true;
    try {
      while (!paused && queue.size) {
        if (scrolling || mainRenderPending()) {
          for (const element of [...queue]) {
            if (!element.isConnected) {
              queue.delete(element);
              continue;
            }
            if (await renderThumbnail(element, true)) queue.delete(element);
          }
          break;
        }
        const sidebarRect = sidebar.getBoundingClientRect();
        const center = sidebarRect.top + sidebarRect.height / 2;
        let best = null;
        let bestDistance = Infinity, bestRank = Infinity;
        for (const element of queue) {
          if (!element.isConnected) {
            queue.delete(element);
            continue;
          }
          const rect = element.getBoundingClientRect();
          if (rect.bottom < sidebarRect.top - 500 || rect.top > sidebarRect.bottom + 500) {
            queue.delete(element);
            continue;
          }
          const distance = Math.abs((rect.top + rect.bottom) / 2 - center);
          const visible = rect.bottom > sidebarRect.top && rect.top < sidebarRect.bottom;
          const rank = (visible ? 0 : 2) + (element.dataset.preview || element.dataset.rendered ? 1 : 0);
          if (rank < bestRank || (rank === bestRank && distance < bestDistance)) {
            bestRank = rank;
            bestDistance = distance;
            best = element;
          }
        }
        if (!best) break;
        queue.delete(best);
        const done = await renderThumbnail(best);
        if (!done && best.isConnected) queue.add(best);
        await new Promise(resolve => requestFrame(resolve));
      }
    } finally {
      queueBusy = false;
      if (queue.size) schedule();
    }
  }

  sidebar.addEventListener('scroll', () => {
    scrolling = true;
    if (activeRender) {
      try { activeRender.task.cancel(); } catch {}
    }
    clearTimer(scrollIdleTimer);
    scrollIdleTimer = setTimer(() => {
      scrolling = false;
      schedule(0);
    }, 110);
  }, { passive: true });

  const observer = createObserver(entries => {
    for (const entry of entries) {
      entry.target._thumbNear = entry.isIntersecting;
      if (entry.isIntersecting) enqueue(entry.target);
      else queue.delete(entry.target);
    }
  }, { root: sidebar, rootMargin: '220px 0px' });

  function trackRender(task, finished, element, token) {
    if (task) {
      activeRender = { task, el: element, token };
      if (scrolling) {
        try { task.cancel(); } catch {}
      }
    } else if (activeRender?.task === finished) activeRender = null;
  }

  function paintPreview(wrap, pageModel) {
    if (!pageModel || pageModel.blank || pageModel.texts?.length) return;
    const key = thumbKey(pageModel), hit = blobCache.get(key);
    const canvas = wrap.querySelector('canvas');
    if (!hit || !canvas) return;
    const token = wrap._pvToken = (wrap._pvToken || 0) + 1;
    createBitmap(hit.blob).then(bitmap => {
      try {
        if (wrap._pvToken !== token || !wrap.isConnected || wrap.dataset.rendered ||
            pageForWrap(wrap) !== pageModel || thumbKey(pageModel) !== key) return;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
      } finally { bitmap.close?.(); }
    }).catch(() => {});
  }

  function invalidateSource(sourceId) {
    sourceGenerations.set(sourceId, (sourceGenerations.get(sourceId) || 0) + 1);
    for (const [key, entry] of blobCache) {
      if (entry.sourceId !== sourceId) continue;
      blobCache.delete(key);
      blobBytes -= entry.bytes;
    }
  }

  return Object.freeze({
    enqueue,
    setPaused,
    schedule,
    process,
    observer,
    has: element => queue.has(element),
    remove: element => queue.delete(element),
    isRendering: element => activeRender?.el === element,
    trackRender,
    cacheGet,
    cachePut,
    cacheHas: key => blobCache.has(key),
    clearImage,
    setImage,
    paintPreview,
    invalidateSource,
    blankImage,
    get scrolling() { return scrolling; },
    get busy() { return queueBusy; },
    get size() { return queue.size; },
    get cacheBytes() { return blobBytes; },
  });
};

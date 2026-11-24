export function readingQuality(width, height, zoom, devicePixelRatio) {
  const deviceRatio = Math.min(devicePixelRatio || 1, 3);
  const readingRatio = 1.725 / Math.max(.45, zoom);
  let renderDpr = Math.max(deviceRatio, 1, readingRatio);
  const estimatedArea = width * height * zoom * zoom;
  renderDpr = Math.min(renderDpr, Math.sqrt(4000000 / Math.max(1, estimatedArea)));
  const estimatedMax = Math.max(width, height) * zoom;
  if (estimatedMax * renderDpr > 16000)
    renderDpr = Math.max(.05, 16000 / estimatedMax);
  const outputDpr = Math.min(deviceRatio, renderDpr);
  const smoothingStep = Math.min(1, Math.max(0, (.9 - zoom) / .45));
  const smoothingMix = smoothingStep * smoothingStep;
  return { renderDpr, outputDpr, smoothingMix };
}

export const createPageRenderer = ({
  getPageAt, getZoom, getSource, makeKey, cancelCleanup, cacheHas, cacheGet,
  cacheCanvas, paintThumbPreview, createBitmap, createCanvas, paintPage,
  blitPagePreview, positionMarks, buildLinkLayer, repositionSearchHits,
  enqueue, getDevicePixelRatio, reportError, onSlowPageVisible = () => {},
  getViewport, paintRegion, getViewerRect, createTiledRenderer, usePagePainter = false, canReuseOverview,
}) => {
  const tiled = getViewerRect && createTiledRenderer({ getPageAt, getZoom, getSource,
    getViewport, getViewerRect, createCanvas, paintPage, paintRegion, getDevicePixelRatio,
    positionMarks, buildLinkLayer, repositionSearchHits, enqueue, reportError,
    cacheGet, cacheCanvas, createBitmap, canReuseOverview });
  const pendingZooms = new Map();
  function finishZoom(wrap) {
    const targets = wrap ? [wrap] : [...pendingZooms.keys()];
    for (const target of targets) {
      clearTimeout(pendingZooms.get(target)); pendingZooms.delete(target);
      if (target.isConnected) enqueue(target);
    }
  }
  function prepareZoom(wrap, zoom) {
    tiled?.prepareZoom(wrap, zoom);
    clearTimeout(pendingZooms.get(wrap));
    pendingZooms.set(wrap, setTimeout(() => finishZoom(wrap), 120));
  }
  function releaseTiles(wrap, preview) {
    clearTimeout(pendingZooms.get(wrap)); pendingZooms.delete(wrap);
    tiled?.releaseTiles(wrap, preview);
  }
  function commitRaster(wrap) {
    tiled?.releaseTiles(wrap, true);
    tiled?.rememberFullPage(wrap);
  }
  const sizeWrap = (wrap, width, height) => {
    wrap.style.width = width + 'px';
    wrap.style.height = height + 'px';
  };

  const preparing = new WeakMap(), slowPages = new WeakSet();

  async function paintReadingThumbnail(page, index, thumb, scale, hook) {
    const zoom = getZoom(), key = makeKey(page), source = getSource(page.src);
    const width = page._w1 * zoom, height = page._h1 * zoom;
    const quality = readingQuality(page._w1, page._h1, zoom, getDevicePixelRatio());
    if (!(width > 0 && height > 0) || Math.max(width, height) * quality.outputDpr > 2400 ||
        width * height * quality.renderDpr ** 2 > 2200000 || page._h1 * scale > 16000 || page.crop || page.resize || page.blank) return false;
    const bytes = source?.bytes;
    const current = () => getPageAt(index) === page && getSource(page.src)?.bytes === bytes && makeKey(page) === key;
    function copyThumbnail(raster) {
      thumb.width = Math.max(1, Math.round(page._w1 * scale));
      thumb.height = Math.max(1, Math.round(page._h1 * scale));
      thumb.getContext('2d').drawImage(raster, 0, 0, thumb.width, thumb.height);
    }
    const hit = await cacheGet(key);
    if (!current()) return false;
    if (hit) {
      const bitmap = await createBitmap(hit.blob);
      try { if (current()) { copyThumbnail(bitmap); return true; } }
      finally { bitmap.close(); }
      return false;
    }
    const raw = createCanvas(), sharp = createCanvas();
    const ready = (async () => {
      const started = performance.now();
      await paintPage(page, raw, zoom, quality.renderDpr, hook, { backgroundTask: true });
      if (performance.now() - started > 350) slowPages.add(page);
      if (!current()) return false;
      const viewport = await getViewport(page, zoom * quality.renderDpr);
      if (!current()) return false;
      const cssWidth = viewport.width / quality.renderDpr, cssHeight = viewport.height / quality.renderDpr;
      blitPagePreview(raw, sharp, cssWidth, cssHeight, quality.outputDpr, quality.smoothingMix);
      cacheCanvas(page.src, key, sharp, cssWidth, cssHeight);
      copyThumbnail(sharp);
      return true;
    })();
    preparing.set(page, { key, ready });
    try { return await ready; }
    finally {
      if (preparing.get(page)?.ready === ready) preparing.delete(page);
      raw.width = raw.height = sharp.width = sharp.height = 0;
    }
  }

  async function renderPage(wrap) {
    if (pendingZooms.has(wrap)) return;
    const index = +wrap.dataset.k;
    const pageModel = getPageAt(index);
    if (!pageModel) return;
    cancelCleanup(pageModel);
    const zoom = getZoom();
    if (tiled) {
      const previous = wrap.dataset.rendered;
      if (await tiled.render(wrap, pageModel, zoom)) {
        if (wrap.dataset.rendered && wrap.dataset.rendered !== previous && slowPages.has(pageModel))
          onSlowPageVisible(pageModel);
        return;
      }
    }
    if (getZoom() !== zoom || pendingZooms.has(wrap)) return;
    const key = makeKey(pageModel);
    if (!wrap.dataset.pageId && !cacheHas(key)) paintThumbPreview(wrap, pageModel);
    if (wrap.dataset.rendered === key) {
      const existingCanvas = wrap.querySelector('canvas');
      const cssWidth = parseFloat(existingCanvas && existingCanvas.style.width) || 0;
      const stale = cssWidth > 0 && existingCanvas.width < cssWidth * .95;
      if (!stale) { commitRaster(wrap); return; }
      if (wrap._retryKey !== key) {
        wrap._retryKey = key;
        wrap._retry = 0;
      }
      if (++wrap._retry > 2) return;
    } else {
      wrap._retryKey = key;
      wrap._retry = 0;
    }

    const generation = wrap._renderGen = (wrap._renderGen || 0) + 1;
    const coldStart = !wrap.dataset.pageId;
    const isStale = () => wrap._renderGen !== generation || getZoom() !== zoom ||
      getPageAt(+wrap.dataset.k) !== pageModel;
    delete wrap.dataset.rendered;
    wrap.dataset.pageId = pageModel.src + ':' + pageModel.idx;
    const pending = preparing.get(pageModel);
    if (pending?.key === key) {
      let cancel;
      const cancelled = new Promise(resolve => { cancel = resolve; });
      const wait = wrap._task = { cancel };
      try { await Promise.race([pending.ready, cancelled]); } catch {}
      finally { if (wrap._task === wait) wrap._task = null; }
      if (isStale()) return;
    }
    const cached = cacheGet(key);
    const cacheHit = cached?.then ? await cached : cached;
    if (isStale()) return;
    if (cacheHit) {
      wrap._pvToken = (wrap._pvToken || 0) + 1;
      try {
        const bitmap = await createBitmap(cacheHit.blob);
        if (isStale()) {
          if (bitmap.close) bitmap.close();
          if (wrap._renderGen === generation) delete wrap.dataset.rendered;
          return;
        }
        const canvas = wrap.querySelector('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        if (bitmap.close) bitmap.close();
        canvas.style.width = cacheHit.cssW + 'px';
        canvas.style.height = cacheHit.cssH + 'px';
        sizeWrap(wrap, cacheHit.cssW, cacheHit.cssH);
        pageModel._w1 = cacheHit.cssW / zoom;
        pageModel._h1 = cacheHit.cssH / zoom;
        wrap.dataset.rendered = key;
        positionMarks(wrap, pageModel);
        buildLinkLayer(wrap, pageModel);
        repositionSearchHits(wrap);
        commitRaster(wrap);
        if (slowPages.has(pageModel)) onSlowPageVisible(pageModel);
        return;
      } catch {}
    }

    const { renderDpr, outputDpr, smoothingMix } = readingQuality(pageModel._w1 || 595, pageModel._h1 || 842, zoom, getDevicePixelRatio());

    if (pageModel.blank) {
      const canvas = wrap.querySelector('canvas');
      wrap._pvToken = (wrap._pvToken || 0) + 1;
      canvas.width = 4;
      canvas.height = 4;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, 4, 4);
      canvas.style.width = pageModel.blank[0] * zoom + 'px';
      canvas.style.height = pageModel.blank[1] * zoom + 'px';
      sizeWrap(wrap, pageModel.blank[0] * zoom, pageModel.blank[1] * zoom);
      wrap.dataset.rendered = key;
      positionMarks(wrap, pageModel);
      buildLinkLayer(wrap, pageModel);
      repositionSearchHits(wrap);
      commitRaster(wrap);
      return;
    }

    if (pageModel.resize || pageModel.crop) {
      const canvas = wrap.querySelector('canvas');
      const temporary = createCanvas();
      try {
        await paintPage(pageModel, temporary, zoom, renderDpr, (task, finished) => {
          if (task) wrap._task = task;
          else if (wrap._task === finished) wrap._task = null;
        });
        if (isStale()) {
          if (wrap._renderGen === generation) delete wrap.dataset.rendered;
          return;
        }
        const { width: displayWidth, height: displayHeight } = await getViewport(pageModel, zoom);
        if (isStale()) return;
        wrap._pvToken = (wrap._pvToken || 0) + 1;
        blitPagePreview(temporary, canvas, displayWidth, displayHeight, outputDpr, smoothingMix);
        canvas.style.width = displayWidth + 'px';
        canvas.style.height = displayHeight + 'px';
        sizeWrap(wrap, displayWidth, displayHeight);
        pageModel._w1 = displayWidth / zoom;
        pageModel._h1 = displayHeight / zoom;
        cacheCanvas(pageModel.src, key, canvas, displayWidth, displayHeight);
        wrap.dataset.rendered = key;
        positionMarks(wrap, pageModel);
        buildLinkLayer(wrap, pageModel);
        repositionSearchHits(wrap);
        commitRaster(wrap);
      } catch (error) {
        if (wrap._renderGen === generation) {
          delete wrap.dataset.rendered;
          if (error?.name === 'RenderingCancelledException') {
            if ((wrap._retry || 0) <= 2) enqueue(wrap);
          } else reportError(error);
        } else if (error?.name !== 'RenderingCancelledException') reportError(error);
      } finally { temporary.width = temporary.height = 0; }
      return;
    }

    const pdfPage = await getSource(pageModel.src).doc.getPage(pageModel.idx + 1);
    if (isStale()) {
      if (wrap._renderGen === generation) delete wrap.dataset.rendered;
      return;
    }
    const rotation = (pdfPage.rotate + pageModel.rot) % 360;
    const viewport = pdfPage.getViewport({ scale: zoom * renderDpr, rotation });
    pageModel._w1 = viewport.width / (zoom * renderDpr);
    pageModel._h1 = viewport.height / (zoom * renderDpr);
    const canvas = wrap.querySelector('canvas');
    canvas.style.width = viewport.width / renderDpr + 'px';
    canvas.style.height = viewport.height / renderDpr + 'px';
    sizeWrap(wrap, viewport.width / renderDpr, viewport.height / renderDpr);
    positionMarks(wrap, pageModel);
    repositionSearchHits(wrap);
    if (wrap._task) {
      try { wrap._task.cancel(); } catch {}
      wrap._task = null;
    }

    if (!usePagePainter && coldStart && renderDpr > outputDpr * 1.2) {
      const fastViewport = pdfPage.getViewport({ scale: zoom * outputDpr, rotation });
      const fastCanvas = createCanvas();
      fastCanvas.width = fastViewport.width;
      fastCanvas.height = fastViewport.height;
      const fastTask = pdfPage.render({
        canvasContext: fastCanvas.getContext('2d'), viewport: fastViewport,
      });
      wrap._task = fastTask;
      try {
        await fastTask.promise;
        if (isStale()) {
          if (wrap._renderGen === generation) delete wrap.dataset.rendered;
          return;
        }
        wrap._pvToken = (wrap._pvToken || 0) + 1;
        blitPagePreview(fastCanvas, canvas,
          fastViewport.width / outputDpr, fastViewport.height / outputDpr, outputDpr, 0);
      } catch (error) {
        if (wrap._renderGen === generation) {
          delete wrap.dataset.rendered;
          if (error?.name === 'RenderingCancelledException') {
            if ((wrap._retry || 0) <= 2) enqueue(wrap);
          } else reportError(error);
        } else if (error?.name !== 'RenderingCancelledException') reportError(error);
        return;
      } finally {
        if (wrap._task === fastTask) wrap._task = null;
        fastCanvas.width = fastCanvas.height = 0;
      }
    }

    const temporary = createCanvas();
    temporary.width = viewport.width;
    temporary.height = viewport.height;
    let task;
    const started = performance.now();
    if (usePagePainter) {
      task = { promise: paintPage(pageModel, temporary, zoom, renderDpr, (next, finished) => {
        if (next) wrap._task = next;
        else if (wrap._task === finished) wrap._task = null;
      }) };
    } else {
      task = pdfPage.render({ canvasContext: temporary.getContext('2d'), viewport });
      wrap._task = task;
    }
    try {
      await task.promise;
      if (isStale()) {
        if (wrap._renderGen === generation) delete wrap.dataset.rendered;
        return;
      }
      wrap._pvToken = (wrap._pvToken || 0) + 1;
      blitPagePreview(temporary, canvas,
        viewport.width / renderDpr, viewport.height / renderDpr, outputDpr, smoothingMix);
      const displayWidth = viewport.width / renderDpr;
      const displayHeight = viewport.height / renderDpr;
      canvas.style.width = displayWidth + 'px';
      canvas.style.height = displayHeight + 'px';
      sizeWrap(wrap, displayWidth, displayHeight);
      cacheCanvas(pageModel.src, key, canvas, displayWidth, displayHeight);
      wrap.dataset.rendered = key;
      commitRaster(wrap);
      if (usePagePainter && performance.now() - started > 350) {
        slowPages.add(pageModel); onSlowPageVisible(pageModel);
      }
    } catch (error) {
      if (wrap._renderGen === generation) {
        delete wrap.dataset.rendered;
        if (error?.name === 'RenderingCancelledException') {
          if ((wrap._retry || 0) <= 2) enqueue(wrap);
        } else reportError(error);
      } else if (error?.name !== 'RenderingCancelledException') reportError(error);
      return;
    } finally {
      if (wrap._task === task) wrap._task = null;
      temporary.width = temporary.height = 0;
    }
    positionMarks(wrap, pageModel);
    buildLinkLayer(wrap, pageModel);
    repositionSearchHits(wrap);
  }

  return Object.freeze({ renderPage, paintReadingThumbnail, sizeWrap, releaseTiles, prepareZoom, finishZoom });
};

export function createTiledPageRenderer({
  getPageAt, getZoom, getSource, getViewport, getViewerRect, createCanvas,
  paintPage, paintRegion, getDevicePixelRatio, positionMarks, buildLinkLayer,
  repositionSearchHits, enqueue, reportError,
  cacheGet = () => null, cacheCanvas = () => {}, createBitmap, canReuseOverview = () => true,
}) {
  const TILE = 768, PREVIEW_PIXELS = 1000000, RETAINED_PIXELS = 8000000;
  const contentKey = p => JSON.stringify([p.src, p.idx, p.rot, p.resize, p.crop]);
  const fullRasters = new WeakMap();
  function rememberFullPage(wrap) {
    const page = getPageAt(+wrap.dataset.k);
    if (!page || !wrap._tileContentKey || !wrap.dataset.rendered) return;
    wrap._lastFullRaster = wrap.dataset.rendered;
    fullRasters.set(page, { content: wrap._tileContentKey, raster: wrap.dataset.rendered });
  }
  async function restoreRaster(key, canvas, stale) {
    const hit = await cacheGet(key);
    if (!hit || stale()) return false;
    let bitmap;
    try {
      bitmap = await createBitmap(hit.blob);
      if (stale()) return false;
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      return true;
    } catch { return false; }
    finally { bitmap?.close?.(); }
  }
  function dispose(state) {
    if (state) {
      state.cancelled = true;
      try { state.task?.cancel(); } catch {}
      for (const canvas of state.tiles.values()) { canvas.width = canvas.height = 0; }
      state.layer.remove();
    }
  }
  function releaseTiles(wrap, releasePreview = false) {
    dispose(wrap._tiles); dispose(wrap._tileFallback);
    delete wrap._tiles; delete wrap._tileFallback;
    if (releasePreview) {
      delete wrap._tilePreviewKey; delete wrap._lastFullRaster;
    }
  }
  function prepareZoom(wrap, zoom) {
    if (wrap._tiles) {
      wrap._tiles.cancelled = true;
      try { wrap._tiles.task?.cancel(); } catch {}
    }
    for (const state of [wrap._tileFallback, wrap._tiles])
      if (state) state.layer.style.transform = `scale(${zoom / state.zoom})`;
  }
  function makeLayer(wrap, size, zoom, previous) {
    const layer = wrap.ownerDocument.createElement('div');
    layer.className = 'pageTiles'; layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = `position:absolute;left:0;top:0;width:${size.width * zoom}px;height:${size.height * zoom}px;overflow:hidden;pointer-events:none;transform-origin:0 0`;
    (previous || wrap.querySelector('canvas')).after(layer);
    return layer;
  }
  function positionTile(canvas, zoom) {
    const { x, y, right, bottom } = canvas._tileRect;
    Object.assign(canvas.style, { left: x * zoom + 'px', top: y * zoom + 'px',
      width: (right - x) * zoom + 'px', height: (bottom - y) * zoom + 'px' });
  }
  function retainTiles(wrap, size, zoom) {
    const state = wrap._tiles;
    if (!state) return;
    state.cancelled = true;
    try { state.task?.cancel(); } catch {}
    if (state.tiles.size) {
      const fallback = wrap._tileFallback ||= {
        layer: makeLayer(wrap, size, zoom), zoom, tiles: new Set(), pixels: 0,
      };
      fallback.layer.style.transform = `scale(${zoom / fallback.zoom})`;
      for (const canvas of state.tiles.values()) {
        const rect = canvas._tileRect;
        for (const old of fallback.tiles) {
          const r = old._tileRect;
          if (r.x >= rect.x && r.y >= rect.y && r.right <= rect.right && r.bottom <= rect.bottom) {
            fallback.pixels -= old.width * old.height;
            old.width = old.height = 0; old.remove(); fallback.tiles.delete(old);
          }
        }
        positionTile(canvas, fallback.zoom);
        fallback.layer.append(canvas); fallback.tiles.add(canvas);
        fallback.pixels += canvas.width * canvas.height;
      }
      const area = getViewerRect(), rect = wrap.getBoundingClientRect();
      const cx = (area.left + area.right) / 2 - rect.left, cy = (area.top + area.bottom) / 2 - rect.top;
      const distance = canvas => {
        const r = canvas._tileRect;
        return Math.hypot((r.x + r.right) * zoom / 2 - cx, (r.y + r.bottom) * zoom / 2 - cy);
      };
      const farthest = [...fallback.tiles].sort((a, b) => distance(b) - distance(a));
      for (const old of farthest) {
        if (fallback.pixels <= RETAINED_PIXELS) break;
        fallback.pixels -= old.width * old.height;
        old.width = old.height = 0; old.remove(); fallback.tiles.delete(old);
      }
      state.tiles.clear();
    }
    dispose(state); delete wrap._tiles;
  }
  function visibleTiles(wrap, width, height, ratio) {
    const rect = wrap.getBoundingClientRect(), area = getViewerRect();
    const left = Math.max(0, area.left - rect.left - 96);
    const top = Math.max(0, area.top - rect.top - 96);
    const right = Math.min(width, area.right - rect.left + 96);
    const bottom = Math.min(height, area.bottom - rect.top + 96);
    if (right <= left || bottom <= top) return [];
    const centerX = (left + right) * ratio / 2, centerY = (top + bottom) * ratio / 2;
    const result = [];
    for (let row = Math.floor(top * ratio / TILE); row < Math.ceil(bottom * ratio / TILE); row++) {
      for (let col = Math.floor(left * ratio / TILE); col < Math.ceil(right * ratio / TILE); col++) {
        const x = Math.max(0, col * TILE - 1), y = Math.max(0, row * TILE - 1);
        const w = Math.min(TILE + 2, Math.ceil(width * ratio) - x);
        const h = Math.min(TILE + 2, Math.ceil(height * ratio) - y);
        result.push({ key: col + ':' + row, x, y, w, h,
          distance: Math.hypot(x + w / 2 - centerX, y + h / 2 - centerY) });
      }
    }
    return result.sort((a, b) => a.distance - b.distance);
  }
  async function render(wrap, page, zoom) {
    if (page.blank) { releaseTiles(wrap, true); return false; }
    const generation = wrap._renderGen;
    const size = await getViewport(page, 1);
    if (wrap._renderGen !== generation || getPageAt(+wrap.dataset.k) !== page || getZoom() !== zoom || !wrap.isConnected) return true;
    const width = size.width * zoom, height = size.height * zoom;
    const deviceRatio = Math.min(3, Math.max(1, getDevicePixelRatio() || 1));
    const key = contentKey(page);
    const sameContent = wrap._tileContentKey === key;
    if (!sameContent) {
      releaseTiles(wrap, true); wrap._tileContentKey = key;
    }
    if (width * height * deviceRatio ** 2 <= 4000000 && Math.max(width, height) * deviceRatio <= 4000) return false;
    let ratio = deviceRatio;
    while (true) {
      const pixels = visibleTiles(wrap, width, height, ratio).reduce((sum, tile) => sum + tile.w * tile.h, 0);
      if (pixels <= 12000000) break;
      ratio *= Math.sqrt(12000000 / pixels) * .98;
    }
    const renderKey = key + ':' + zoom + ':' + ratio;
    if (wrap._tiles?.key !== renderKey || wrap._tiles.cancelled) {
      retainTiles(wrap, size, zoom);
      const layer = makeLayer(wrap, size, zoom, wrap._tileFallback?.layer);
      wrap._tiles = { key: renderKey, layer, zoom, tiles: new Map(), task: null, cancelled: false };
    }
    const state = wrap._tiles;
    const stale = () => state.cancelled || wrap._tiles !== state || !wrap.isConnected ||
      wrap._renderGen !== generation || contentKey(page) !== key ||
      getZoom() !== zoom || getPageAt(+wrap.dataset.k) !== page;
    const track = (task, finished) => {
      if (task) { state.task = wrap._task = task; if (stale()) task.cancel(); }
      else { if (wrap._task === finished) wrap._task = null; if (state.task === finished) state.task = null; }
    };
    wrap.style.width = width + 'px'; wrap.style.height = height + 'px';
    const base = wrap.querySelector('canvas');
    base.style.width = width + 'px'; base.style.height = height + 'px';
    const hadPage = wrap.dataset.pageId === page.src + ':' + page.idx;
    wrap.dataset.pageId = page.src + ':' + page.idx;
    positionMarks(wrap, page); repositionSearchHits(wrap);
    try {
      if (wrap._tilePreviewKey !== key) {
        const previewScale = Math.min(1, Math.sqrt(PREVIEW_PIXELS / (size.width * size.height)), 2048 / Math.max(size.width, size.height));
        const full = fullRasters.get(page);
        const reusable = full?.content === key && await canReuseOverview(page);
        if (stale()) return true;
        if (reusable && sameContent && hadPage && base.width && base.height && wrap._lastFullRaster === full.raster) {
          wrap._tilePreviewKey = key;
        } else {
          const preview = createCanvas();
          try {
            const previewKey = 'tile-preview:' + key;
            const restored = (reusable && await restoreRaster(full.raster, preview, stale)) ||
              await restoreRaster(previewKey, preview, stale);
            if (stale()) return true;
            if (!restored) {
              await paintPage(page, preview, previewScale, 1, track, { recordOperations: true });
              if (!stale()) cacheCanvas(page.src, previewKey, preview, size.width, size.height);
            }
            if (stale()) return true;
            if (!sameContent || !hadPage || base.width * base.height < preview.width * preview.height) {
              wrap._pvToken = (wrap._pvToken || 0) + 1;
              base.width = preview.width; base.height = preview.height;
              base.getContext('2d').drawImage(preview, 0, 0);
            }
            wrap._tilePreviewKey = key;
          } finally { preview.width = preview.height = 0; }
        }
      }
      const pdfPage = await getSource(page.src).doc.getPage(page.idx + 1);
      const rotation = (pdfPage.rotate + page.rot) % 360;
      const bounds = !page.resize && !page.crop && pdfPage._daydayBBoxRotation === rotation ? pdfPage.recordedBBoxes : null;
      const wanted = visibleTiles(wrap, width, height, ratio);
      const keys = new Set(wanted.map(tile => tile.key));
      for (const [id, canvas] of state.tiles) if (!keys.has(id)) {
        canvas.width = canvas.height = 0; canvas.remove(); state.tiles.delete(id);
      }
      for (const tile of wanted) {
        if (stale()) return true;
        if (state.tiles.has(tile.key)) continue;
        const now = visibleTiles(wrap, width, height, ratio);
        if (!now.some(item => item.key === tile.key)) { enqueue(wrap); break; }
        const canvas = createCanvas();
        const region = { x: tile.x / (ratio * zoom), y: tile.y / (ratio * zoom),
          width: tile.w / (ratio * zoom), height: tile.h / (ratio * zoom) };
        const options = bounds ? { operationsFilter(index) {
          return !bounds.isEmpty(index) && bounds.minX(index) <= (tile.x + tile.w) / (width * ratio) &&
            bounds.maxX(index) >= tile.x / (width * ratio) && bounds.minY(index) <= (tile.y + tile.h) / (height * ratio) &&
            bounds.maxY(index) >= tile.y / (height * ratio);
        } } : {};
        try {
          const tileKey = 'tile:' + renderKey + ':' + tile.key;
          const restored = await restoreRaster(tileKey, canvas, stale);
          if (stale()) { canvas.width = canvas.height = 0; return true; }
          if (!restored) {
            await paintRegion(page, canvas, zoom, ratio, region, track, options);
            if (!stale()) cacheCanvas(page.src, tileKey, canvas, region.width, region.height);
          }
          if (stale()) { canvas.width = canvas.height = 0; return true; }
          const unit = ratio * zoom;
          canvas._tileRect = { x: tile.x / unit, y: tile.y / unit,
            right: (tile.x + tile.w) / unit, bottom: (tile.y + tile.h) / unit };
          canvas.style.cssText = 'position:absolute;border-radius:0;pointer-events:none';
          positionTile(canvas, zoom);
          canvas.dataset.tile = tile.key;
          state.layer.append(canvas); state.tiles.set(tile.key, canvas);
        } catch (error) { canvas.width = canvas.height = 0; throw error; }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (!stale()) {
        const complete = visibleTiles(wrap, width, height, ratio).every(tile => state.tiles.has(tile.key));
        if (complete) {
          dispose(wrap._tileFallback); delete wrap._tileFallback;
          wrap.dataset.rendered = renderKey;
        } else enqueue(wrap);
        buildLinkLayer(wrap, page); repositionSearchHits(wrap);
      }
    } catch (error) {
      if (error?.name !== 'RenderingCancelledException') reportError(error);
      if (!stale()) delete wrap.dataset.rendered;
    }
    return true;
  }
  return { render, releaseTiles, prepareZoom, rememberFullPage };
}

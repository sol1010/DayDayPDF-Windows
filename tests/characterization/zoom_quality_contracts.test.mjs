import test from 'node:test';
import assert from 'node:assert/strict';
import { createTiledPageRenderer } from '../../src/rendering/tiled-page-renderer.js';
import { createPageRenderer } from '../../src/rendering/page-renderer.js';
import { createRenderCoordinator } from '../../src/rendering/render-coordinator.js';

function fixture({ maxCacheBytes = 10000000 } = {}) {
  const page = { src: 1, idx: 0, rot: 0 }, children = [];
  let zoom = 2, blocker = null;
  const element = () => ({ style: {}, dataset: {}, width: 0, height: 0, setAttribute() {},
    children: [], getContext: () => ({ drawImage() {} }),
    append(child) { child.remove(); this.children.push(child); child.parent = this; },
    after(child) { child.remove(); this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, child); child.parent = this.parent; },
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; },
  });
  const base = element(), wrap = { style: {}, dataset: { k: '0' }, isConnected: true, children,
    ownerDocument: { createElement: element }, querySelector: () => base,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1000 * zoom, bottom: 1500 * zoom }),
  };
  base.parent = wrap; children.push(base);
  const ratios = [], queued = [], previews = [];
  const coordinator = createRenderCoordinator({ createObserver: () => ({}), now: () => 0, maxCacheBytes });
  const renderer = createTiledPageRenderer({
    getPageAt: () => page, getZoom: () => zoom, getSource: () => ({ doc: { getPage: async () => ({ rotate: 0 }) } }),
    getViewport: async () => ({ width: 1000, height: 1500 }),
    getViewerRect: () => ({ left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844 }),
    createCanvas: element, getDevicePixelRatio: () => 3,
    paintPage: async (p, c) => { previews.push(p.idx); c.width = 800; c.height = 1200; },
    paintRegion: async (p, c, z, ratio, region) => {
      ratios.push(ratio); c.width = Math.round(region.width * z * ratio); c.height = Math.round(region.height * z * ratio);
      if (blocker) { const wait = blocker; blocker = null; await wait; }
    }, positionMarks() {}, buildLinkLayer() {}, repositionSearchHits() {},
    enqueue: w => queued.push(w), reportError: e => { throw e; },
    cacheGet: coordinator.cacheGetReady,
    cacheCanvas: (source, key, canvas, w, h) => coordinator.cacheCanvas(source, key, {
      toBlob(done) { done({ size: 100, width: canvas.width, height: canvas.height }); },
    }, w, h),
    createBitmap: async blob => ({ width: blob.width, height: blob.height, close() {} }),
  });
  return { renderer, wrap, page, ratios, queued, base, previews, coordinator,
    zoom(z) { zoom = z; wrap._renderGen = (wrap._renderGen || 0) + 1; renderer.prepareZoom(wrap, z); },
    render: () => renderer.render(wrap, page, zoom), block(promise) { blocker = promise; },
  };
}

test('zoom keeps completed pixels until replacement tiles cover the viewport, at phone DPR', async () => {
  const f = fixture(); await f.render();
  assert.ok(f.ratios.every(r => r === 3), 'small phone viewport can use its full DPR');
  const old = [...f.wrap._tiles.tiles.values()];
  f.zoom(3);
  assert.ok(old.every(c => c.width > 0 && c.parent), 'zoom must not clear completed canvases');
  assert.equal(f.wrap._tiles.layer.style.transform, 'scale(1.5)');
  assert.equal(parseFloat(old[0].style.width), old[0].width / 3);
  let resume; f.block(new Promise(resolve => { resume = resolve; }));
  const next = f.render(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.wrap._tileFallback.tiles.size > 0, 'old pixels remain while the first new tile is pending');
  resume(); await next;
  assert.equal(f.wrap._tileFallback, undefined, 'retire old pixels only after current coverage is complete');
  assert.ok(old.every(c => c.width === 0));
  assert.ok(f.wrap._tiles.tiles.size > 0);
  f.zoom(.3); assert.equal(await f.render(), false);
  assert.ok(f.wrap._tiles.tiles.size > 0, 'crossing into full-page mode must wait for its raster commit');
  f.renderer.releaseTiles(f.wrap, true);
  assert.equal(f.wrap._tiles, undefined);
});

test('returning to a released drawing restores preview and tiles without any PDF rendering', async () => {
  const f = fixture(); await f.render();
  const paints = f.ratios.length, previews = f.previews.length;
  const tiles = [...f.wrap._tiles.tiles].map(([key, c]) => [key, c.width, c.height]);
  f.renderer.releaseTiles(f.wrap, true);
  f.wrap._renderGen = (f.wrap._renderGen || 0) + 1;
  f.base.width = f.base.height = 0;
  delete f.wrap.dataset.rendered; delete f.wrap.dataset.pageId;
  await f.render();
  assert.equal(f.ratios.length, paints);
  assert.equal(f.previews.length, previews);
  assert.deepEqual([...f.wrap._tiles.tiles].map(([key, c]) => [key, c.width, c.height]), tiles);
  assert.ok(f.base.width > 0);
  f.coordinator.invalidateSource(1);
  f.renderer.releaseTiles(f.wrap, true);
  await f.render();
  assert.equal(f.ratios.length, paints * 2, 'source invalidation must discard cached tiles');
  assert.equal(f.previews.length, previews + 1);
});

test('tile snapshots respect the shared byte limit and changed rotation cannot reuse old pixels', async () => {
  const f = fixture({ maxCacheBytes: 300 }); await f.render();
  assert.ok(f.coordinator.cacheBytes <= 300);
  const paints = f.ratios.length;
  f.page.rot = 90; await f.render();
  assert.ok(f.ratios.length > paints);
  assert.equal(f.previews.length, 2);
  assert.ok(f.coordinator.cacheBytes <= 300);
});

test('a revisit waits for its pending snapshot and invalidation discards delayed encodes', async () => {
  const c = createRenderCoordinator({ createObserver: () => ({}), now: () => 0, maxCacheBytes: 1024 });
  let encode;
  c.cacheCanvas(1, 'pending', { toBlob(done) { encode = done; } }, 20, 30);
  assert.ok(c.cacheHas('pending'));
  const reading = c.cacheGetReady('pending');
  encode({ size: 50 });
  assert.equal((await reading).cssW, 20);
  c.cacheCanvas(1, 'pending', { toBlob(done) { encode = done; } }, 40, 60);
  const obsolete = c.cacheGetReady('pending');
  c.invalidateSource(1); encode({ size: 50 });
  assert.equal(await obsolete, undefined);
  assert.equal(c.cacheBytes, 0);
});

test('interrupted refinement retains partial regions with bounded memory and discards changed content', async () => {
  const f = fixture(); await f.render();
  for (const zoom of [3, 2.1, 4, 2.5, 5, 3.5]) {
    f.zoom(zoom);
    let resume; f.block(new Promise(resolve => { resume = resolve; }));
    const next = f.render(); await new Promise(resolve => setImmediate(resolve));
    assert.ok(f.wrap._tileFallback.pixels <= 8000000);
    f.zoom(zoom + .01); resume(); await next;
    assert.ok(f.wrap._tileFallback.tiles.size > 0, 'cancelled task must not dispose the previous visible pixels');
  }
  f.page.rot = 90; await f.render();
  assert.equal(f.wrap._tileFallback, undefined);
  assert.ok(f.wrap._tileContentKey.includes('90'));
  f.renderer.releaseTiles(f.wrap, true);
  assert.equal(f.wrap.children.length, 1, 'offscreen cleanup releases all tile layers');
});

test('zoom pause gates stale queue entries and gesture end enqueues the latest render immediately', async () => {
  const wrap = { isConnected: true, dataset: { k: '0' } }, queued = [];
  let reads = 0;
  const renderer = createPageRenderer({ getPageAt: () => { reads++; return null; }, enqueue: w => queued.push(w) });
  renderer.prepareZoom(wrap, 2); renderer.prepareZoom(wrap, 3);
  await renderer.renderPage(wrap); assert.equal(reads, 0);
  renderer.finishZoom(); assert.deepEqual(queued, [wrap]);
  await renderer.renderPage(wrap); assert.equal(reads, 1);
  renderer.prepareZoom(wrap, 4); renderer.releaseTiles(wrap);
  await new Promise(resolve => setTimeout(resolve, 140));
  assert.equal(queued.length, 1, 'released pages must not be revived by a pending zoom timer');
});

test('final page cache uses lossless encoding without changing source invalidation', () => {
  const coordinator = createRenderCoordinator({ createObserver: () => ({}), now: () => 0, maxCacheBytes: 1024 });
  let encoding;
  coordinator.cacheCanvas(1, 'key', { toBlob(callback, type) { encoding = type; callback({ size: 20, type }); } }, 20, 30);
  assert.equal(encoding, 'image/png');
  assert.equal(coordinator.cacheGet('key').blob.type, 'image/png');
  coordinator.invalidateSource(1); assert.equal(coordinator.cacheBytes, 0);
});

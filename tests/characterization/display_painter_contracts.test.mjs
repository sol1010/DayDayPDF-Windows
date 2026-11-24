import test from 'node:test';
import assert from 'node:assert/strict';
import { averageRasterPixels, createDisplayPainter } from '../../src/rendering/display-painter.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(overrides = {}) {
  const sources = new Map([[1, { bytes: new Uint8Array([1, 2, 3]), doc: { getFieldObjects: async () => null } }],
    [2, { bytes: new Uint8Array([4]), doc: { getFieldObjects: async () => null } }]]);
  const workers = [], fallback = [], timers = new Map(); let timeId = 0, closed = 0, live = 0, peak = 0;
  const painter = createDisplayPainter({ getSource: id => sources.get(id), getWasmBinary: async () => new ArrayBuffer(2), pdfiumCdn: '/local/',
    painter: { getRenderSpec: async () => ({ width: 120, height: 80, viewport: { width: 200, height: 100, offsetX: -15, offsetY: -10 } }),
      paintRegion: async (...args) => fallback.push(args) },
    setTimer: (fn, delay) => { const id = ++timeId; timers.set(id, { fn, delay }); return id; }, clearTimer: id => timers.delete(id),
    createWorker: () => { const w = { messages: [], terminated: false,
      postMessage(m) { this.messages.push(m); if (m.type !== 'paint' && m.type !== 'preview') queueMicrotask(() => this.onmessage({ data: m.type === 'size' ? { width: 120, height: 80 } : {} })); },
      terminate() { if (!this.terminated) { this.terminated = true; live--; } },
      finish(extra = {}) { this.onmessage({ data: { image: { width: 120, height: 80, close() { closed++; } }, heapBytes: 32e6, ...extra } }); } };
      workers.push(w); live++; peak = Math.max(peak, live); return w; }, ...overrides });
  const canvas = () => ({ draws: 0, getContext() { return { drawImage: () => this.draws++ }; } });
  const page = (idx = 0, src = 1) => ({ idx, src, rot: 0 });
  return { painter, sources, workers, fallback, timers, canvas, page, stats: () => ({ live, peak, closed }) };
}

test('first paint shares the in-flight worker initialization and keeps the source bytes', async () => {
  let finishLoad, loads = 0;
  const x = setup({ getWasmBinary: () => {
    loads++;
    return new Promise(resolve => { finishLoad = resolve; });
  } });
  x.painter.warmup();
  x.painter.warmup();
  const paint = x.painter.paintPage(x.page(), x.canvas(), 1);
  await tick();
  assert.equal(loads, 1);
  finishLoad(new ArrayBuffer(2));
  await tick();
  assert.equal(x.workers.length, 1);
  assert.deepEqual(x.workers[0].messages.map(m => m.type), ['init', 'open', 'paint']);
  x.workers[0].finish();
  await paint;
  assert.deepEqual([...x.sources.get(1).bytes], [1, 2, 3]);
  x.painter.shutdown();
});

test('display work stays serial, transfers each source once, releases bitmaps and idle worker', async () => {
  const x = setup(), a = x.canvas(), b = x.canvas();
  const first = x.painter.paintPage(x.page(), a, 2), second = x.painter.paintPage(x.page(1), b, 2);
  await tick(); assert.equal(x.workers.length, 1); const w = x.workers[0];
  assert.equal(w.messages.filter(m => m.type === 'paint').length, 1);
  assert.deepEqual(w.messages.at(-1), { type: 'paint', index: 0, width: 240, height: 160, fullWidth: 200, fullHeight: 100, x: -15, y: -10, rotation: 0 });
  w.finish(); await first; await tick(); assert.equal(w.messages.at(-1).index, 1);
  w.finish(); await second; assert.equal(w.messages.filter(m => m.type === 'open').length, 1);
  const next = x.painter.paintPage(x.page(0, 2), a, 1); await tick(); w.finish(); await next;
  assert.equal(w.messages.filter(m => m.type === 'open').length, 2);
  assert.equal(x.stats().closed, 3); assert.equal(x.stats().peak, 1);
  [...x.timers.values()].find(t => t.delay === 15000).fn(); assert.equal(x.stats().live, 0);
});

test('foreground page cancels a distant thumbnail and is never painted by its late result', async () => {
  const x = setup(), oldCanvas = x.canvas(), currentCanvas = x.canvas();
  const thumb = x.painter.paintThumbnail(x.page(5), oldCanvas, 1, 1);
  const rejected = assert.rejects(thumb, { name: 'RenderingCancelledException' }); await tick();
  const page = x.painter.paintPage(x.page(1), currentCanvas, 1); await tick(); await rejected;
  assert.equal(x.workers[0].terminated, true); assert.equal(x.stats().peak, 1);
  x.workers[0].finish(); assert.equal(oldCanvas.draws, 0);
  x.workers[1].finish(); await page; assert.equal(currentCanvas.draws, 1); assert.equal(x.fallback.length, 0);
  x.painter.shutdown();
});

test('cancel during WASM loading never resurrects a worker or falls back into expensive rendering', async () => {
  let release; const x = setup({ getWasmBinary: () => new Promise(r => { release = r; }) });
  const promise = x.painter.paintPage(x.page(), x.canvas(), 1); const rejected = assert.rejects(promise, { name: 'RenderingCancelledException' });
  await tick(); x.painter.shutdown(); release(new ArrayBuffer(2)); await rejected;
  assert.equal(x.workers.length, 0); assert.equal(x.fallback.length, 0);
});

test('task cancellation and source disposal stop work, while worker errors use the reader fallback', async () => {
  const x = setup(); let task;
  const first = x.painter.paintPage(x.page(), x.canvas(), 1, 1, t => { if (t) task = t; });
  const rejected = assert.rejects(first, { name: 'RenderingCancelledException' }); await tick(); task.cancel(); await rejected;
  assert.equal(x.stats().live, 0); assert.equal(x.fallback.length, 0);
  const broken = x.painter.paintPage(x.page(), x.canvas(), 1); await tick();
  x.workers.at(-1).onmessage({ data: { error: 'broken engine' } }); await broken;
  assert.equal(x.fallback.length, 1); assert.equal(x.stats().live, 0);
  await x.painter.paintPage(x.page(), x.canvas(), 1); assert.equal(x.workers.length, 2); assert.equal(x.fallback.length, 2);
  const third = x.painter.paintPage(x.page(0, 2), x.canvas(), 1); const disposal = assert.rejects(third, { name: 'RenderingCancelledException' });
  await tick(); x.painter.invalidateSource(2); await disposal; assert.equal(x.stats().live, 0);
});

test('forms, XFA, protected files and unsupported environments retain the existing painter', async () => {
  for (const change of [{ locked: true }, { doc: { isPureXfa: true } }, { doc: { getFieldObjects: async () => ({ name: [] }) } }]) {
    const x = setup(); Object.assign(x.sources.get(1), change);
    await x.painter.paintPage(x.page(), x.canvas(), 1);
    assert.equal(x.workers.length, 0); assert.equal(x.fallback.length, 1);
  }
  const resized = setup(); await resized.painter.paintPage({ ...resized.page(), resize: [400, 500] }, resized.canvas(), 1);
  assert.equal(resized.workers.length, 0); assert.equal(resized.fallback.length, 1);
  const x = setup({ supported: false }); await x.painter.paintPage(x.page(), x.canvas(), 1); assert.equal(x.fallback.length, 1);
});

test('large WASM heaps are released after transferring the completed image', async () => {
  const x = setup(), c = x.canvas(); const promise = x.painter.paintPage(x.page(), c, 1);
  await tick(); x.workers[0].finish({ heapBytes: 600 * 1024 * 1024 }); await promise;
  assert.equal(c.draws, 1); assert.equal(x.stats().live, 0); assert.equal(x.stats().closed, 1);
});

test('shutdown during document eligibility cancels before any worker can be queued', async () => {
  let release; const x = setup();
  x.sources.get(1).doc.getFieldObjects = () => new Promise(r => { release = r; });
  const paint = x.painter.paintPage(x.page(), x.canvas(), 1);
  const rejected = assert.rejects(paint, { name: 'RenderingCancelledException' });
  await tick(); x.painter.shutdown(); release(null); await rejected;
  assert.equal(x.workers.length, 0); assert.equal(x.fallback.length, 0);
});


function outputSetup() {
  const tiles = [], blits = [], width = 3508, height = 2481, ratio = 300 / 72;
  const x = setup({
    createCanvas: () => { const c = { width: 0, height: 0, getContext: () => ({ drawImage() {} }) }; tiles.push(c); return c; },
    painter: { getViewport: async () => ({ width: width / ratio, height: height / ratio }),
      getRenderSpec: async (_model, scale, region) => ({ width: region.width, height: region.height,
        viewport: { width, height, offsetX: -23, offsetY: -17 - region.y * scale } }) },
  });
  const canvas = { getContext: () => ({ drawImage: (tile, left, top) => blits.push([left, top, tile.width, tile.height]) }) };
  return { ...x, tiles, blits, output: canvas, ratio };
}

test('300 DPI output tiles are bounded, ordered and reuse one native document', async () => {
  const x = outputSetup(), promise = x.painter.paintOutputPage(x.page(), x.output, x.ratio);
  await tick(); const w = x.workers[0]; let m = w.messages.at(-1);
  assert.equal(m.width, 3508); assert.equal(m.x, -23); assert.equal(m.y, -17);
  assert.ok(m.width * m.height <= 8000000);
  const firstHeight = m.height;
  w.finish({ image: { width: m.width, height: m.height, close() {} } });
  await tick(); m = w.messages.at(-1);
  assert.equal(m.y, -17 - firstHeight); assert.equal(m.height, 2481 - firstHeight);
  w.finish({ image: { width: m.width, height: m.height, close() {} } }); await promise;
  assert.deepEqual(x.blits, [[0, 0, 3508, firstHeight], [0, firstHeight, 3508, 2481 - firstHeight]]);
  assert.equal(w.messages.filter(m => m.type === 'open').length, 1);
  assert.equal(x.stats().peak, 1); assert.equal(x.tiles.length, 1);
  assert.equal(x.tiles[0].width, 0); assert.equal(x.tiles[0].height, 0); x.painter.shutdown();
});

test('output cancellation releases a completed tile without copying it or starting another', async () => {
  const x = outputSetup(), abort = new AbortController();
  const promise = x.painter.paintOutputPage(x.page(), x.output, x.ratio, 1, null, { signal: abort.signal });
  const rejected = assert.rejects(promise, { name: 'AbortError' }); await tick();
  abort.abort(); const w = x.workers[0], m = w.messages.at(-1);
  w.finish({ image: { width: m.width, height: m.height, close() {} } }); await rejected;
  assert.equal(x.blits.length, 0); assert.equal(w.messages.filter(m => m.type === 'paint').length, 1);
  assert.equal(x.tiles[0].width, 0); x.painter.shutdown();
});

test('opening preview reuses the selected source for refinement and releases a superseded preview', async () => {
  const x = setup({ createCanvas: () => ({ getContext: () => ({ drawImage() {} }) }) });
  const preview = x.painter.primeSource(1, x.sources.get(1));
  const sharp = x.painter.paintPage(x.page(), x.canvas(), 1);
  await tick();
  const worker = x.workers[0];
  assert.equal(worker.messages.at(-1).type, 'preview');
  worker.finish();
  assert.equal((await preview).width, 120);
  await tick();
  assert.deepEqual(worker.messages.map(m => m.type), ['init', 'open', 'size', 'preview', 'paint']);
  worker.finish(); await sharp;
  assert.equal(x.stats().closed, 2);
  const unused = x.painter.primeSource(2, x.sources.get(2));
  await tick();
  x.painter.invalidateSource(2);
  assert.equal(await unused, null);
  assert.equal(x.stats().live, 0);
});

test('image duplication preserves fractional line coverage across neighboring output pixels', () => {
  const samples = 6, src = new Uint8ClampedArray(12 * 6 * 4).fill(255);
  for (let y = 0; y < 6; y++) {
    for (let x = 4; x <= 6; x++) src[(y * 12 + x) * 4] = 0;
  }
  const dst = new Uint8ClampedArray(8);
  averageRasterPixels(src, dst, 2, 1, samples);
  assert.deepEqual([...dst], [170, 255, 255, 255, 212, 255, 255, 255]);
});

test('sampling full-color tiles matches per-channel area averages at every duplication scale', () => {
  for (let samples = 2; samples <= 6; samples++) {
    const width = 5, height = 3, src = new Uint8ClampedArray(width * height * samples ** 2 * 4);
    for (let i = 0; i < src.length; i++) src[i] = (i * 113 + (i >>> 2)) % 256;
    const actual = new Uint8ClampedArray(width * height * 4), expected = new Uint8ClampedArray(actual.length);
    averageRasterPixels(src, actual, width, height, samples);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const pixel = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = 0; dy < samples; dy++) for (let dx = 0; dx < samples; dx++) {
          sum += src[((y * samples + dy) * width * samples + x * samples + dx) * 4 + c];
        }
        expected[pixel + c] = sum / (samples * samples);
      }
      expected[pixel + 3] = 255;
    }
    assert.deepEqual(actual, expected);
  }
});

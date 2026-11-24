import assert from 'node:assert/strict';
import test from 'node:test';

import { createOverlayCanvasRenderer } from '../../src/rendering/overlay-canvas-renderer.js';
import {
  arrowBodyPolyline, arrowMarkerStrokeWidth, connectorEndDirection, connectorPolyline,
  shapeUnitPolygon,
} from '../../src/core/shape-connectors.js';
import { createPagePainter } from '../../src/rendering/page-painter.js';
import { createRenderCoordinator } from '../../src/rendering/render-coordinator.js';
import { createThumbnailCoordinator } from '../../src/rendering/thumbnail-coordinator.js';
import { createPageLifecycle } from '../../src/rendering/page-lifecycle.js';
import { createThumbnailWorkerController } from '../../src/rendering/thumbnail-worker-controller.js';
import { createPageRenderer } from '../../src/rendering/page-renderer.js';
import { createThumbnailRenderer } from '../../src/rendering/thumbnail-renderer.js';

function recordingCanvas(width = 100, height = 200) {
  const calls = [];
  const context = new Proxy({
    measureText: text => ({ width: text.length * 5 }),
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return (...args) => calls.push([property, ...args]);
    },
    set(target, property, value) {
      calls.push(['set', property, value]);
      target[property] = value;
      return true;
    },
  });
  return { width, height, calls, context, getContext: () => context };
}

test('filled and open arrow heads rotate independently in canvas previews', () => {
  const renderer = createOverlayCanvasRenderer({
    isTextObject: () => false, colorWithAlpha: color => color,
    opacityOf: () => 1, rotationOf: () => 0, connectorPolylineOf: connectorPolyline,
  });
  for (const kind of ['arrow-filled','arrow-open']) {
    const arrow = {type:'arrow',x1:.1,y1:.2,x2:.7,y2:.6,sw:2,stroke:'#123456',
      arrowEndType:kind,arrowHeadSize:12,arrowHeadRotation:37};
    const original = structuredClone(arrow), canvas = recordingCanvas(100,200);
    renderer.drawObjects({texts:[arrow]},canvas,100);
    const angle = Math.atan2(80,60)+37*Math.PI/180;
    assert.ok(canvas.calls.some(call => call[0]==='rotate' && Math.abs(call[1]-angle)<1e-10),kind);
    assert.deepEqual(arrow,original,'rendering does not move endpoints');
  }
});

test('page painter keeps blank, resize, crop, and generation task hooks at its boundary', async () => {
  const renderCalls = [];
  const taskEvents = [];
  const pdfPage = {
    rotate: 90,
    getViewport: ({ scale, rotation, offsetX = 0, offsetY = 0 }) => ({ width: 100 * scale, height: 200 * scale, rotation, offsetX, offsetY }),
    render: options => {
      renderCalls.push(options);
      return { promise: Promise.resolve(), cancel() {} };
    },
  };
  const temporaryCanvases = [];
  const painter = createPagePainter({
    getSource: () => ({ doc: { getPage: async () => pdfPage } }),
    createCanvas: () => {
      const canvas = recordingCanvas(0, 0);
      temporaryCanvases.push(canvas);
      return canvas;
    },
  });

  const blank = { blank: [72, 144] };
  const blankCanvas = recordingCanvas(0, 0);
  assert.deepEqual(await painter.getViewport(blank, 2), { width: 144, height: 288, blank: true });
  await painter.paintPage(blank, blankCanvas, 2, 1.5);
  assert.equal(blankCanvas.width, 216);
  assert.equal(blankCanvas.height, 432);

  const cropped = { src: 1, idx: 0, rot: 90, crop: [.1, .2, .5, .25] };
  assert.deepEqual(await painter.getViewport(cropped, 2), { width: 100, height: 100, crop: true });
  const cropCanvas = recordingCanvas(0, 0);
  await painter.paintPage(cropped, cropCanvas, 2, 1, (task, finished) => taskEvents.push([task, finished]));
  assert.equal(cropCanvas.width, 100);
  assert.equal(cropCanvas.height, 100);
  assert.equal(temporaryCanvases.length, 0, 'crop renders directly into the bounded output');
  assert.equal(renderCalls[0].viewport.offsetX, -20);
  assert.equal(renderCalls[0].viewport.offsetY, -80);
  assert.equal(renderCalls.length, 1);
  assert.equal(taskEvents.length, 2);
  assert.ok(taskEvents[0][0]);
  assert.equal(taskEvents[1][0], null);
  assert.equal(taskEvents[1][1], taskEvents[0][0]);

  const resizedCrop = { src: 1, idx: 0, rot: 90, resize: [300, 200], crop: [.1, .25, .5, .5] };
  assert.deepEqual(await painter.getViewport(resizedCrop, 2), {
    width: 300, height: 200, resize: true, crop: true,
  });
  const resizedCropCanvas = recordingCanvas(0, 0);
  await painter.paintPage(resizedCrop, resizedCropCanvas, 2, 1);
  assert.equal(resizedCropCanvas.width, 300);
  assert.equal(resizedCropCanvas.height, 200);
  assert.equal(temporaryCanvases.length, 0);
  assert.equal(renderCalls[1].viewport.offsetX, 140);
  assert.equal(renderCalls[1].viewport.offsetY, -100);
});

test('page preview preserves direct-copy and two-pass smoothing behavior', () => {
  const painter = createPagePainter({ getSource: () => null, createCanvas: () => null });
  const direct = recordingCanvas(0, 0);
  painter.blitPagePreview({ width: 200, height: 400 }, direct, 100, 200, 2, 1);
  assert.deepEqual(direct.calls.filter(call => call[0] === 'drawImage'), [['drawImage', { width: 200, height: 400 }, 0, 0]]);

  const scaled = recordingCanvas(0, 0);
  painter.blitPagePreview({ width: 300, height: 600 }, scaled, 100, 200, 2, .4);
  assert.equal(scaled.width, 200);
  assert.equal(scaled.height, 400);
  assert.equal(scaled.calls.filter(call => call[0] === 'drawImage').length, 2);
  assert.deepEqual(scaled.calls.filter(call => call[0] === 'set' && call[1] === 'imageSmoothingQuality').map(call => call[2]), ['medium', 'high']);
});

test('overlay renderer composes text, shapes, lines, and deferred images without global state', () => {
  class FakeImage {
    complete = false;
    naturalWidth = 0;
    listeners = [];
    addEventListener(type, listener, options) { this.listeners.push({ type, listener, options }); }
  }
  const pending = [];
  const renderer = createOverlayCanvasRenderer({
    ImageConstructor: FakeImage,
    isTextObject: object => !object.type,
    colorWithAlpha: (color, opacity) => `${color}:${opacity}`,
    opacityOf: (object, key) => object[key] ?? 1,
    rotationOf: object => object.r ?? 0,
    shapePolygonOf: shapeUnitPolygon,
    connectorPolylineOf: connectorPolyline,
    arrowBodyPolylineOf: arrowBodyPolyline,
    connectorEndDirectionOf: connectorEndDirection,
    arrowMarkerStrokeWidthOf: arrowMarkerStrokeWidth,
    onImagePending: page => pending.push(page),
  });
  const page = { texts: [
    { fx: .1, fy: .1, text: 'A', size: 10, color: '#111', colorOp: .8 },
    { type: 'line', x1: .1, y1: .2, x2: .7, y2: .8, stroke: '#222', strokeOp: .5, sw: 2,
      lineCap: 'square' },
    { type: 'arrow', x1: .8, y1: .2, x2: .6, y2: .3, stroke: '#222', strokeOp: .5, sw: 2,
      connectorStyle: 'curve', arrowEndType: 'circle-open', arrowHeadSize: 12 },
    { type: 'polyline', points: [[.1, .1], [.5, .2], [.3, .6]], closed: true,
      stroke: '#225588', strokeOp: .8, sw: 2 },
    { type: 'rect', fx: .2, fy: .3, fw: .4, fh: .2, fill: '#333', fillOp: .4,
      stroke: '#444', strokeOp: .6, sw: 1, text: 'Inside', size: 10, font: 'robotoslab',
      color: '#111111', colorOp: .9, align: 'center', valign: 'middle' },
    { type: 'triangle', fx: .2, fy: .3, fw: .4, fh: .2, fill: '#333', fillOp: .4, stroke: '#444', strokeOp: .6, sw: 1 },
    { type: 'star', fx: .2, fy: .3, fw: .4, fh: .2, fill: '#333', fillOp: .4, stroke: '#444', strokeOp: .6, sw: 1 },
    { type: 'img', data: 'data:image/png;base64,x', fx: 0, fy: 0, fw: .5, fh: .5 },
  ] };
  const canvas = recordingCanvas();
  renderer.drawObjects(page, canvas, 100);
  assert.equal(canvas.calls.filter(call => call[0] === 'save').length, 11);
  assert.equal(canvas.calls.filter(call => call[0] === 'restore').length, 11);
  assert.ok(canvas.calls.some(call => call[0] === 'closePath'));
  assert.ok(canvas.calls.some(call => call[0] === 'set' && call[1] === 'lineJoin' && call[2] === 'round'));
  assert.ok(canvas.calls.some(call => call[0] === 'set' && call[1] === 'lineCap' && call[2] === 'square'));
  assert.ok(canvas.calls.some(call => call[0] === 'arc'));
  assert.equal(canvas.calls.filter(call => call[0] === 'fillText').length, 2);
  assert.ok(canvas.calls.some(call => call[0] === 'clip'));
  assert.ok(canvas.calls.some(call => call[0] === 'set' && call[1] === 'font' &&
    call[2].includes('"PDFEditor Roboto Slab"')));
  assert.ok(canvas.calls.some(call => call[0] === 'rect' &&
    Math.abs(call[1] + 16.8) < 1e-9 && Math.abs(call[2] + 16.8) < 1e-9 &&
    Math.abs(call[3] - 33.6) < 1e-9 && Math.abs(call[4] - 33.6) < 1e-9));
  assert.equal(pending.length, 0);

  const noneCanvas = recordingCanvas();
  renderer.drawObjects({ texts: [{
    type: 'arrow', x1: .1, y1: .2, x2: .8, y2: .7,
    stroke: '#222', strokeOp: 1, sw: 2, arrowEndType: 'none', arrowHeadSize: 12,
  }] }, noneCanvas, 100);
  assert.equal(noneCanvas.calls.filter(call => call[0] === 'fill').length, 0);
  assert.equal(noneCanvas.calls.filter(call => call[0] === 'arc' || call[0] === 'strokeRect').length, 0);
});

test('shape text thumbnail clips to its inset box and truncates lines to its height', () => {
  class FakeImage {}
  const renderer = createOverlayCanvasRenderer({
    ImageConstructor: FakeImage,
    isTextObject: object => !object.type,
    colorWithAlpha: (color, opacity) => `${color}:${opacity}`,
    opacityOf: (object, key) => object[key] ?? 1,
    rotationOf: () => 0,
    onImagePending: () => {},
  });
  const page = { texts: [{
    type: 'rect', fx: .1, fy: .1, fw: .4, fh: .1,
    fill: null, stroke: '#444', strokeOp: 1, sw: 1,
    text: 'first\nsecond\nthird', size: 10, font: 'nanum',
    color: '#111', colorOp: 1, align: 'left', valign: 'top',
  }] };
  const canvas = recordingCanvas();

  renderer.drawObjects(page, canvas, 100);

  assert.deepEqual(canvas.calls.filter(call => call[0] === 'fillText').map(call => call[1]), ['first']);
  assert.ok(canvas.calls.some(call => call[0] === 'set' && call[1] === 'font' &&
    call[2].includes('"PDFEditor Nanum Gothic"')));
  assert.ok(canvas.calls.some(call => call[0] === 'rect' &&
    Math.abs(call[1] + 16.8) < 1e-9 && Math.abs(call[2] + 8.4) < 1e-9 &&
    Math.abs(call[3] - 33.6) < 1e-9 && Math.abs(call[4] - 16.8) < 1e-9));
  assert.equal(canvas.calls.filter(call => call[0] === 'clip').length, 1);
});

test('render coordinator owns exact queue priority, observer margins, release, and source cache invalidation', async () => {
  const timers = [];
  const rendered = [];
  const cleaned = [];
  let observerCallback;
  let observerOptions;
  let clock = 10;
  const viewer = { getBoundingClientRect: () => ({ top: 0, bottom: 100, height: 100 }) };
  const wrap = (name, top, bottom) => ({
    name,
    isConnected: true,
    style: {},
    dataset: { k: name, rendered: 'old', pageId: name },
    getBoundingClientRect: () => ({ top, bottom }),
    querySelector: () => ({ width: 3, height: 4 }),
  });
  const near = wrap('near', 40, 60);
  const farther = wrap('farther', 80, 100);
  const coordinator = createRenderCoordinator({
    viewer,
    renderPage: async target => rendered.push(target.name),
    pageForWrap: target => ({ id: target.name }),
    cleanupPage: page => cleaned.push(page.id),
    createObserver: (callback, options) => {
      observerCallback = callback;
      observerOptions = options;
      return { observe() {}, unobserve() {} };
    },
    requestFrame: callback => callback(),
    setTimer: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    now: () => ++clock,
    maxCacheBytes: 100,
  });

  coordinator.enqueue(farther);
  coordinator.enqueue(near);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 40);
  assert.equal(observerOptions.root, viewer);
  assert.equal(observerOptions.rootMargin, '600px 0px');
  await coordinator.process();
  assert.deepEqual(rendered, ['near', 'farther']);

  rendered.length = 0;
  coordinator.enqueue(wrap('offscreen', 110, 200));
  coordinator.enqueue(wrap('large-visible', -5000, 50));
  await coordinator.process();
  assert.deepEqual(rendered, ['large-visible', 'offscreen']);

  observerCallback([{ target: near, isIntersecting: false }]);
  assert.deepEqual(cleaned, ['near']);
  assert.equal(near.dataset.rendered, undefined);
  assert.equal(near.dataset.pageId, undefined);

  const canvas = { toBlob: callback => callback({ size: 60 }) };
  coordinator.cacheCanvas(7, 'key-7', canvas, 12, 24);
  assert.equal(coordinator.cacheGet('key-7').cssW, 12);
  assert.equal(coordinator.cacheBytes, 60);
  coordinator.invalidateSource(7);
  assert.equal(coordinator.cacheHas('key-7'), false);
  assert.equal(coordinator.cacheBytes, 0);
});

test('thumbnail coordinator preserves queue delays, margins, cancellation, cache trim, and source invalidation', async () => {
  const timers = [];
  const rendered = [];
  const listeners = {};
  let observerOptions;
  let observerCallback;
  let clock = 0;
  let cancelled = 0;
  const sidebar = {
    addEventListener: (type, listener) => { listeners[type] = listener; },
    getBoundingClientRect: () => ({ top: 0, bottom: 100, height: 100 }),
    querySelectorAll: () => [],
  };
  const thumb = (name, top, bottom) => ({
    name,
    isConnected: true,
    dataset: { k: name },
    getBoundingClientRect: () => ({ top, bottom }),
    querySelector: () => null,
  });
  const near = thumb('near', 40, 60);
  const farther = thumb('farther', 80, 100);
  const coordinator = createThumbnailCoordinator({
    sidebar,
    renderThumbnail: async (element, cachedOnly) => { rendered.push([element.name, !!cachedOnly]); return true; },
    mainRenderPending: () => false,
    thumbKey: page => page.key,
    pageForWrap: () => null,
    createBitmap: async () => null,
    createObjectUrl: () => 'blob:test',
    revokeObjectUrl: () => {},
    createObserver: (callback, options) => {
      observerCallback = callback;
      observerOptions = options;
      return { observe() {}, unobserve() {} };
    },
    requestFrame: callback => callback(),
    setTimer: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; },
    clearTimer: timer => { if (timer) timer.cleared = true; },
    now: () => ++clock,
    maxCacheBytes: 100,
  });

  coordinator.enqueue(farther);
  coordinator.enqueue(near);
  assert.equal(timers[0].delay, 40);
  assert.equal(observerOptions.root, sidebar);
  assert.equal(observerOptions.rootMargin, '220px 0px');
  await coordinator.process();
  assert.deepEqual(rendered, [['near', false], ['farther', false]]);

  coordinator.trackRender({ cancel: () => { cancelled++; } }, null, near, 1);
  listeners.scroll();
  assert.equal(cancelled, 1);
  assert.equal(coordinator.scrolling, true);
  assert.equal(timers.at(-1).delay, 110);
  timers.at(-1).callback();
  assert.equal(coordinator.scrolling, false);

  coordinator.cachePut(1, 'one', { size: 60 }, 10, 20);
  coordinator.cachePut(2, 'two', { size: 60 }, 20, 10);
  const trim = timers.find(timer => timer.delay === 250 && !timer.cleared);
  assert.ok(trim);
  trim.callback();
  assert.equal(coordinator.cacheBytes, 60);
  coordinator.invalidateSource(2);
  assert.equal(coordinator.cacheBytes, 0);

  observerCallback([{ target: near, isIntersecting: true }]);
  assert.equal(near._thumbNear, true);
  assert.equal(coordinator.has(near), true);
  coordinator.setPaused(true);
  const before = rendered.length;
  coordinator.enqueue(farther);
  await coordinator.process();
  assert.equal(rendered.length, before);
  coordinator.setPaused(false);
  await coordinator.process();
  assert.deepEqual(rendered.slice(before).map(item => item[0]).sort(), ['farther', 'near']);
});

test('page lifecycle preserves delayed cleanup and cancellable 16-page dimension sweeps', async () => {
  const timers = [];
  const pages = Array.from({ length: 16 }, (_, index) => ({ src: 1, idx: index }));
  const ratios = [];
  let cleanupCount = 0;
  const source = {
    doc: { getPage: async () => ({ cleanup: () => { cleanupCount++; } }) },
  };
  const lifecycle = createPageLifecycle({
    getSource: () => source,
    isPageInUse: () => false,
    getPages: () => pages,
    getViewport: async page => { page._w1 = 100 + page.idx; page._h1 = 200; },
    updateAspectRatio: (index, page) => ratios.push([index, page._w1 / page._h1]),
    shouldRefit: page => page.idx === 3,
    requestRefit: () => ratios.push(['refit']),
    setTimer: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; },
    clearTimer: timer => { if (timer) timer.cleared = true; },
  });

  lifecycle.scheduleCleanup(pages[0]);
  assert.equal(timers[0].delay, 400);
  assert.equal(lifecycle.cleanupCount, 1);
  timers[0].callback();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(cleanupCount, 1);
  assert.equal(lifecycle.cleanupCount, 0);

  lifecycle.scheduleDimensionSweep();
  assert.equal(timers.at(-1).delay, 150);
  const sweep = lifecycle.sweepDimensions();
  for (let index = 0; index < 20; index++) await Promise.resolve();
  const yieldTimer = timers.find(timer => timer.delay === undefined);
  assert.ok(yieldTimer);
  yieldTimer.callback();
  await sweep;
  assert.equal(ratios.filter(item => typeof item[0] === 'number').length, 16);
  assert.equal(ratios.filter(item => item[0] === 'refit').length, 1);
});

test('thumbnail worker controller preserves transferable batches, pending keys, retries, and 60-second idle shutdown', async () => {
  const timers = [];
  const messages = [];
  const pageResults = [];
  let terminated = 0;
  const fakeWorker = {
    onmessage: null,
    onerror: null,
    postMessage: (message, transfer) => messages.push({ message, transfer }),
    terminate: () => { terminated++; },
  };
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const controller = createThumbnailWorkerController({
    workerSource: 'self.onmessage=()=>{}',
    pdfiumCdn: 'https://cdn.example/',
    getWasmBinary: async () => new Uint8Array([8, 9]).buffer,
    createWorker: source => { assert.match(source, /onmessage/); return fakeWorker; },
    getSource: sourceId => sourceId === 5 ? { bytes } : null,
    onPage: async (record, message) => pageResults.push([record.key, message.pw]),
    warn: () => {},
    setTimer: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; },
    clearTimer: timer => { if (timer) timer.cleared = true; },
  });
  const record = { index: 0, page: { idx: 2, rot: 90 }, key: 'thumb-key' };
  controller.enqueueSource(5, [record], 320);
  assert.equal(controller.hasPending('thumb-key'), true);
  await controller.start();
  assert.equal(messages[0].message.t, 'init');
  assert.equal(messages[0].message.cdn, 'https://cdn.example/');
  assert.equal(messages[0].transfer.length, 1);

  fakeWorker.onmessage({ data: { t: 'ready' } });
  assert.equal(messages[1].message.t, 'batch');
  assert.equal(messages[1].message.jobs[0].idx, 2);
  assert.equal(messages[1].message.jobs[0].rot, 90);
  assert.equal(messages[1].message.jobs[0].px, 320);
  fakeWorker.onmessage({ data: { t: 'page', u: messages[1].message.jobs[0].u, pw: 612 } });
  await Promise.resolve();
  assert.deepEqual(pageResults, [['thumb-key', 612]]);
  assert.equal(controller.hasPending('thumb-key'), false);
  fakeWorker.onmessage({ data: { t: 'done' } });
  assert.equal(timers.at(-1).delay, 60000);
  timers.at(-1).callback();
  assert.equal(terminated, 1);
});

test('page renderer keeps blank sizing, generation ownership, and render side effects behind one boundary', async () => {
  const page = { src: 0, idx: 0, blank: [72, 144] };
  const canvas = recordingCanvas(0, 0);
  canvas.style = {};
  const wrap = { dataset: { k: '0' }, style: {}, querySelector: () => canvas };
  const calls = [];
  const renderer = createPageRenderer({
    getPageAt: index => index === 0 ? page : null,
    getZoom: () => 2,
    getSource: () => null,
    makeKey: model => `2:${model.src}:${model.idx}`,
    cancelCleanup: model => calls.push(['cancel', model]),
    cacheHas: () => false,
    cacheGet: () => null,
    cacheCanvas: () => calls.push(['cache']),
    paintThumbPreview: () => calls.push(['preview']),
    createBitmap: async () => null,
    createCanvas: () => recordingCanvas(0, 0),
    paintPage: async () => {},
    blitPagePreview: () => {},
    positionMarks: () => calls.push(['marks']),
    buildLinkLayer: () => calls.push(['links']),
    repositionSearchHits: () => calls.push(['search']),
    enqueue: () => calls.push(['enqueue']),
    getDevicePixelRatio: () => 1,
    reportError: error => { throw error; },
  });
  await renderer.renderPage(wrap);
  assert.equal(wrap.dataset.rendered, '2:0:0');
  assert.equal(wrap.dataset.pageId, '0:0');
  assert.equal(wrap._renderGen, 1);
  assert.equal(canvas.width, 4);
  assert.equal(canvas.height, 4);
  assert.equal(canvas.style.width, '144px');
  assert.equal(canvas.style.height, '288px');
  assert.equal(wrap.style.width, '144px');
  assert.deepEqual(calls.map(call => call[0]), ['cancel', 'preview', 'marks', 'links', 'search']);
});

test('thumbnail renderer keeps cache-only fallback and one shared render canvas', async () => {
  const page = { src: 4, idx: 1, rot: 0, texts: [] };
  const image = { style: {}, dataset: {} };
  const element = { dataset: { k: '0' }, querySelector: () => image };
  const canvas = recordingCanvas(0, 0);
  canvas.toBlob = callback => callback({ size: 25 });
  const cacheWrites = [];
  const imageWrites = [];
  const renderer = createThumbnailRenderer({
    getPageAt: index => index === 0 ? page : null,
    maxPixelWidth: 168,
    makeKey: () => 'thumb:4:1',
    cacheGet: () => null,
    setImage: (...args) => imageWrites.push(args),
    cancelCleanup: () => {},
    getViewport: async () => ({ width: 84, height: 168 }),
    isScrolling: () => false,
    paintPage: async (model, target, scale, dpr, hook) => {
      assert.equal(scale, 2);
      target.width = 168;
      target.height = 336;
      const task = { id: 1 };
      hook(task);
      hook(null, task);
    },
    trackRender: () => {},
    drawObjects: () => {},
    createCanvas: () => canvas,
    cachePut: (...args) => cacheWrites.push(args),
    scheduleCleanup: () => {},
    warn: () => {},
  });
  assert.equal(await renderer.renderThumbnail(element, true), false);
  assert.equal(await renderer.renderThumbnail(element), true);
  assert.deepEqual(cacheWrites[0].slice(0, 2), [4, 'thumb:4:1']);
  assert.equal(cacheWrites[0][3], 168);
  assert.equal(cacheWrites[0][4], 336);
  assert.equal(imageWrites.length, 1);
});

test('late page renders cannot restore an earlier zoom or poison cached page dimensions', async t => {
  for (const phase of ['cache', 'page-fetch', 'raster', 'crop']) await t.test(phase, async () => {
    let release; const pending = new Promise(resolve => { release = resolve; });
    let zoom = 1, draws = 0, writes = 0;
    const page = { src: 1, idx: 0, rot: 0, _w1: 595, _h1: 842, ...(phase === 'crop' ? { crop: [0, 0, .5, .5] } : {}) };
    const canvas = recordingCanvas(595, 842); canvas.style = {};
    const wrap = { dataset: { k: '0', pageId: '1:0' }, style: {}, querySelector: () => canvas };
    const pdfPage = { rotate: 0, getViewport: ({scale}) => ({width: 595 * scale, height: 842 * scale}),
      render: () => ({ promise: pending, cancel() {} }) };
    const renderer = createPageRenderer({
      getPageAt: () => page, getZoom: () => zoom, makeKey: () => String(zoom),
      getSource: () => ({ doc: { getPage: () => phase === 'page-fetch' ? pending : Promise.resolve(pdfPage) } }),
      cancelCleanup() {}, cacheHas: () => false,
      cacheGet: () => phase === 'cache' ? { blob: {}, cssW: 595, cssH: 842 } : null,
      createBitmap: () => pending, createCanvas: () => recordingCanvas(),
      paintThumbPreview() {}, paintPage: () => pending,
      cacheCanvas: () => writes++, blitPagePreview: () => draws++,
      positionMarks: () => draws++, buildLinkLayer() {}, repositionSearchHits() {}, enqueue() {},
      getDevicePixelRatio: () => 1, reportError: error => { throw error; },
    });
    const rendering = renderer.renderPage(wrap);
    await Promise.resolve();  
    const drawsBeforeZoom = draws;
    zoom = 2;
    wrap.style.width = canvas.style.width = '1190px';
    wrap.style.height = canvas.style.height = '1684px';
    release(phase === 'page-fetch' ? pdfPage : { width: 595, height: 842, close() {} });
    await rendering;
    assert.equal(wrap.style.width, '1190px'); assert.equal(wrap.style.height, '1684px');
    assert.equal(canvas.style.width, '1190px'); assert.equal(page._w1, 595); assert.equal(page._h1, 842);
    assert.equal(draws, drawsBeforeZoom); assert.equal(writes, 0);
  });
});

test('page dimensions and objects update together before an asynchronous raster finishes', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const page = { src: 1, idx: 0, rot: 0 };
  const canvas = recordingCanvas(); canvas.style = {};
  const wrap = { dataset: { k: '0', pageId: '1:0' }, style: {}, querySelector: () => canvas };
  let marks = null, blits = 0;
  const pdfPage = { rotate: 0, getViewport: ({scale}) => ({width: 600 * scale, height: 900 * scale}),
    render: () => ({promise: pending, cancel() {}}) };
  const renderer = createPageRenderer({
    getPageAt: () => page, getZoom: () => 1.5, makeKey: () => '1.5',
    getSource: () => ({doc: {getPage: async () => pdfPage}}),
    cancelCleanup() {}, cacheHas: () => false, cacheGet: () => null, cacheCanvas() {},
    createCanvas: () => recordingCanvas(), paintThumbPreview() {},
    blitPagePreview: () => blits++,
    positionMarks: () => { marks = [wrap.style.width, wrap.style.height]; },
    buildLinkLayer() {}, repositionSearchHits() {}, enqueue() {},
    getDevicePixelRatio: () => 1, reportError: error => { throw error; },
  });
  const rendering = renderer.renderPage(wrap);
  await Promise.resolve();
  assert.equal(blits, 0, 'PDF raster is still pending');
  assert.ok(marks && Math.abs(parseFloat(marks[0]) - 900) < 1e-8 &&
    Math.abs(parseFloat(marks[1]) - 1350) < 1e-8, 'objects must follow the displayed page immediately');
  assert.deepEqual([canvas.style.width, canvas.style.height], marks);
  release(); await rendering;
  assert.equal(blits, 1);
  assert.ok(Math.abs(parseFloat(marks[0]) - 900) < 1e-8 && Math.abs(parseFloat(marks[1]) - 1350) < 1e-8);
});


test('a cold page displays its screen-resolution pass before refinement and marks only completion', async () => {
  let finish;
  const refinement = new Promise(resolve => { finish = resolve; });
  const page = { src: 1, idx: 0, rot: 0 }, canvas = recordingCanvas(); canvas.style = {};
  const wrap = { dataset: { k: '0' }, style: {}, querySelector: () => canvas };
  const scales = [], blits = [];
  const pdfPage = { rotate: 0,
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 900 * scale }),
    render: ({ viewport }) => {
      scales.push(viewport.width / 600);
      return { promise: scales.length === 1 ? Promise.resolve() : refinement, cancel() {} };
    },
  };
  const renderer = createPageRenderer({ getPageAt: () => page, getZoom: () => 1, makeKey: () => 'final',
    getSource: () => ({ doc: { getPage: async () => pdfPage } }),
    cancelCleanup() {}, cacheHas: () => false, cacheGet: () => null, cacheCanvas() {},
    createCanvas: () => recordingCanvas(), paintThumbPreview() {},
    blitPagePreview: source => blits.push(source.width), positionMarks() {},
    buildLinkLayer() {}, repositionSearchHits() {}, enqueue() {}, getDevicePixelRatio: () => 1,
    reportError: error => { throw error; },
  });
  const rendering = renderer.renderPage(wrap);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scales[0], 1); assert.ok(scales[1] > scales[0]);
  assert.deepEqual(blits, [600]);
  assert.equal(wrap.dataset.rendered, undefined, 'the preview is not a completed full render');
  finish(); await rendering;
  assert.equal(blits.length, 2); assert.equal(wrap.dataset.rendered, 'final');
});

test('canvas arrow body clips short end legs before drawing hollow heads', () => {
  const renderer = createOverlayCanvasRenderer({
    ImageConstructor: class {}, isTextObject: () => false,
    colorWithAlpha: color => color, opacityOf: () => 1, rotationOf: () => 0,
    connectorPolylineOf: connectorPolyline, arrowBodyPolylineOf: arrowBodyPolyline,
    connectorEndDirectionOf: connectorEndDirection, arrowMarkerStrokeWidthOf: arrowMarkerStrokeWidth,
    onImagePending() {},
  });
  for (const kind of ['circle-open', 'square']) {
    const canvas = recordingCanvas(200, 200);
    renderer.drawObjects({ texts: [{ type: 'arrow', arrowEndType: kind, arrowHeadSize: 100,
      x1: .1, y1: .6, x2: .7, y2: .5, connectorStyle: 'angled',
      connectorBendX: .7, connectorBendY: .6, sw: 2, stroke: '#ff0000' }] }, canvas, 200);
    const lines = canvas.calls.slice(0, canvas.calls.findIndex(c => c[0] === 'stroke'))
      .filter(c => c[0] === 'lineTo');
    assert.equal(lines.length, 1, 'no line to the elbow inside the hollow head');
    const x = kind === 'square' ? 25 : 60 - Math.sqrt(34 ** 2 - 20 ** 2);
    assert.ok(Math.abs(lines[0][1] - x) < 1e-8);
    assert.ok(Math.abs(lines[0][2] - 10) < 1e-8);
  }
});

test('only the precise page contributes to the thumbnail cache and an edit discards an in-flight thumbnail', async () => {
  const page = { src: 5, key: 'initial' }, element = { dataset: { k: '0' }, querySelector: () => ({}) };
  let precise = false, finish;
  const writes = [], canvas = recordingCanvas(168, 100);
  canvas.toBlob = callback => { finish = () => callback({ size: 42 }); };
  const renderer = createThumbnailRenderer({
    getPageAt: () => page, makeKey: p => p.key, maxPixelWidth: 168,
    getPageRaster: () => ({ canvas: recordingCanvas(512, 300), precise }),
    getViewport: async () => ({ width: 800, height: 470 }), createCanvas: () => canvas,
    cacheGet: () => null, cachePut: (...args) => writes.push(args), cancelCleanup() {}, scheduleCleanup() {},
    isScrolling: () => false, drawObjects() {}, setImage: (el, key, blob, w, h, preview) => {
      el.dataset[preview ? 'preview' : 'rendered'] = key;
    }, warn: error => assert.fail(error),
  });
  const first = renderer.renderThumbnail(element, true);
  await Promise.resolve(); finish();
  assert.equal(await first, false);
  assert.equal(element.dataset.preview, 'initial');
  assert.equal(writes.length, 0);
  precise = true;
  const replaced = renderer.renderThumbnail(element, true);
  await Promise.resolve(); page.key = 'edited'; finish();
  assert.equal(await replaced, false);
  assert.equal(writes.length, 0);
  const final = renderer.renderThumbnail(element, true);
  await Promise.resolve(); finish();
  assert.equal(await final, true);
  assert.equal(element.dataset.rendered, 'edited');
  assert.equal(writes.length, 1);
});

test('an opened page shares the precise raster being prepared for its thumbnail', async () => {
  let finish, paints = 0, cached;
  const page = { src: 3, idx: 2, rot: 0, _w1: 600, _h1: 400 };
  const source = { bytes: new Uint8Array(1) };
  const canvas = recordingCanvas(); canvas.style = {};
  const wrap = { dataset: { k: '2' }, style: {}, querySelector: () => canvas };
  const renderer = createPageRenderer({
    getPageAt: () => page, getZoom: () => 1, getSource: () => source, makeKey: () => 'sharp',
    getDevicePixelRatio: () => 1, usePagePainter: true, getViewport: async (p, z) => ({width: 600*z, height: 400*z}),
    createCanvas: () => recordingCanvas(), getViewerRect: null, cancelCleanup() {},
    cacheHas: () => !!cached, cacheGet: () => cached, cacheCanvas: (src, key, c, cssW, cssH) => {
      cached = { blob: {width: c.width, height: c.height}, cssW, cssH };
    }, createBitmap: async b => ({ ...b, close() {} }), paintThumbPreview() {},
    paintPage: async () => { paints++; await new Promise(resolve => { finish = resolve; }); },
    blitPagePreview: (_, c, w, h) => { c.width = w; c.height = h; },
    positionMarks() {}, buildLinkLayer() {}, repositionSearchHits() {},
  });
  const thumb = recordingCanvas();
  const prefetch = renderer.paintReadingThumbnail(page, 2, thumb, 168/600);
  await new Promise(resolve => setImmediate(resolve));
  const reading = renderer.renderPage(wrap);
  assert.equal(wrap.dataset.rendered, undefined);
  finish();
  assert.equal(await prefetch, true); await reading;
  assert.equal(paints, 1);
  assert.equal(wrap.dataset.rendered, 'sharp'); assert.equal(canvas.width, 600);
  assert.equal(thumb.width, 168); assert.equal(thumb.height, 112);
});

test('a change of reading page interrupts an offscreen render before the newly visible page', async () => {
  let release, firstBottom = 90;
  const order = [], cleared = [];
  const wrap = (k, rect) => ({dataset: {k}, style: {}, isConnected:true, getBoundingClientRect:rect});
  const a = wrap('a', () => ({top:firstBottom-80,bottom:firstBottom}));
  const b = wrap('b', () => ({top:5,bottom:95}));
  const q = createRenderCoordinator({
    viewer:{getBoundingClientRect:()=>({top:0,bottom:100,height:100})}, createObserver:()=>({}),
    setTimer:()=>1, requestFrame:f=>f(), renderPage:async w=>{
      order.push(w.dataset.k);
      if(w===a && order.length===1)await new Promise(r=>{ release=r; w._task={cancel(){cleared.push('a');r();}};});
    },
  });
  q.enqueue(a); const running=q.process(); assert.ok(release);
  q.focus(b); assert.deepEqual(cleared, []);
  firstBottom=-10; q.focus(b); await running;
  assert.deepEqual(cleared,['a']); assert.deepEqual(order,['a','b','a']);
});

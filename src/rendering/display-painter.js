export function averageRasterPixels(src, dst, width, height, samples) {
  const pixels = new Uint32Array(src.buffer, src.byteOffset, src.byteLength / 4);
  const stride = width * samples, count = samples * samples;
  for (let row = 0, out = 0; row < height; row++) {
    for (let col = 0; col < width; col++, out += 4) {
      const start = row * samples * stride + col * samples;
      let redBlue = 0, green = 0;
      for (let dy = 0; dy < samples; dy++) {
        const first = start + dy * stride;
        for (let i = first; i < first + samples; i++) {
          const pixel = pixels[i];
          redBlue += pixel & 0x00ff00ff;
          green += (pixel >>> 8) & 255;
        }
      }
      dst[out] = (redBlue & 65535) / count;
      dst[out + 1] = green / count;
      dst[out + 2] = (redBlue >>> 16) / count;
      dst[out + 3] = 255;
    }
  }
}

export function createDisplayPainter({ painter, getSource, getWasmBinary, pdfiumCdn,
  createWorker, supported = true, warn = () => {},
  setTimer = setTimeout, clearTimer = clearTimeout,
  createCanvas = () => new OffscreenCanvas(1, 1) }) {
  const eligibility = new WeakMap(), failedSources = new WeakSet(), queue = [], tasks = new Map();
  let session = null, starting = null, active = null, busy = false, epoch = 0, idle = null;
  const cancelled = () => Object.assign(new Error('Display rendering cancelled'), { name: 'RenderingCancelledException' });
  function stopWorker() {
    epoch++; starting = null; clearTimer(idle);
    const old = session; session = null;
    old?.worker.terminate(); old?.pending?.reject(cancelled());
  }
  function cancelJob(job) {
    job.cancelled = true;
    const index = queue.indexOf(job);
    if (index >= 0) { queue.splice(index, 1); job.reject(cancelled()); }
    if (active === job) stopWorker();
  }
  function shutdown() {
    for (const task of tasks.keys()) task.cancel();
    for (const job of queue.splice(0)) { job.cancelled = true; job.reject(cancelled()); }
    if (active) active.cancelled = true;
    stopWorker();
  }
  function invalidateSource(id) {
    for (const [task, sourceId] of tasks) if (sourceId === id) task.cancel();
    for (const job of [...queue]) if (job.sourceId === id) cancelJob(job);
    if (active?.sourceId === id) cancelJob(active);
    else if (session?.sourceId === id) stopWorker();
  }
  function request(current, message, transfer = []) {
    return new Promise((resolve, reject) => {
      const timer = setTimer(() => reject(new Error('Display worker timed out')), 30000);
      current.pending = { resolve: value => { clearTimer(timer); resolve(value); },
        reject: error => { clearTimer(timer); reject(error); } };
      try { current.worker.postMessage(message, transfer); }
      catch (error) { current.pending.reject(error); current.pending = null; }
    });
  }
  async function start(token) {
    const wasm = await getWasmBinary();
    if (token !== epoch) throw cancelled();
    const current = { worker: createWorker(), pending: null, source: null, sourceId: null };
    session = current;
    current.worker.onmessage = ({ data }) => {
      if (session !== current) { data.image?.close(); return; }
      const pending = current.pending; current.pending = null;
      if (!pending) { data.image?.close(); return; }
      if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data);
    };
    current.worker.onerror = event => current.pending?.reject(new Error(event.message || 'Display worker failed'));
    const copy = wasm.slice(0);
    await request(current, { type: 'init', cdn: pdfiumCdn, wasm: copy }, [copy]);
    return current;
  }
  function ready() {
    if (!starting) {
      const token = epoch;
      starting = start(token).catch(error => {
        if (token === epoch) stopWorker();
        throw error;
      });
    }
    return starting;
  }
  function scheduleIdle() {
    clearTimer(idle);
    idle = setTimer(() => { if (!busy && !queue.length) stopWorker(); }, 15000);
  }
  function warmup() {
    if (!supported || starting) return;
    ready().then(() => { if (!busy) scheduleIdle(); }, () => {});
  }
  function primeSource(sourceId, source, openingSize = (w, h) => ({
    width: Math.max(1, Math.round(512 * w / Math.max(w, h))),
    height: Math.max(1, Math.round(512 * h / Math.max(w, h))),
  })) {
    if (!supported || busy || queue.length) return null;
    return new Promise(resolve => {
      queue.push({ sourceId, source, openingSize, message: { type: 'preview', index: 0 }, background: true,
        resolve: ({ image }) => {
          try {
            const canvas = createCanvas();
            canvas.width = image.width; canvas.height = image.height;
            canvas.getContext('2d').drawImage(image, 0, 0);
            resolve(canvas);
          } finally { image.close(); }
        },
        reject: () => resolve(null),
      });
      pump();
    });
  }
  function prepareReadingPage(page, stillVisible) {
    const source = getSource(page.src);
    if (!source || session?.source !== source) return;
    if (active ? !active.background || active.message.index === page.idx : session.pageIndex === page.idx) return;
    if (queue.some(job => job.source === source && job.message.index === page.idx)) return;
    queue.push({ sourceId: page.src, source, message: { type: 'size', index: page.idx },
      prepare: stillVisible, resolve() {}, reject() {} });
    pump();
  }
  const priority = job => job.background ? 2 : job.prepare ? 1 : 0;
  async function pump() {
    if (busy) return;
    busy = true; clearTimer(idle);
    try {
      while (queue.length) {
        queue.sort((a, b) => priority(a) - priority(b));
        const job = active = queue.shift();
        try {
          if (job.prepare && !job.prepare()) continue;
          const current = await ready();
          if (job.cancelled) throw cancelled();
          if (current.source !== job.source || current.sourceBytes !== job.source.bytes) {
            const sourceBytes = job.source.bytes;
            const bytes = sourceBytes.slice().buffer;
            await request(current, { type: 'open', bytes }, [bytes]);
            current.source = job.source; current.sourceId = job.sourceId;
            current.sourceBytes = sourceBytes; current.pageIndex = -1;
          }
          if (job.cancelled) throw cancelled();
          if (job.openingSize) {
            const { width, height } = await request(current, { type: 'size', index: job.message.index });
            if (job.cancelled) throw cancelled();
            Object.assign(job.message, job.openingSize(width, height));
          }
          const result = await request(current, job.message);
          if (job.cancelled) { result.image?.close(); throw cancelled(); }
          current.pageIndex = job.message.index;
          job.resolve(result);
          if (result.heapBytes > 512 * 1024 * 1024) stopWorker();
        } catch (error) { stopWorker(); job.reject(error); }
        finally { active = null; }
      }
    } finally {
      busy = false;
      scheduleIdle();
    }
  }
  async function eligible(source) {
    if (!supported || !source?.bytes || source.locked || source.doc?.isPureXfa || failedSources.has(source)) return false;
    if (!eligibility.has(source)) eligibility.set(source,
      Promise.resolve().then(() => source.doc?.getFieldObjects?.()).then(fields => !fields, () => false));
    return eligibility.get(source);
  }
  function usesNative(model, output = false) {
    return !model.blank && (!model.resize || output) && eligible(getSource(model.src));
  }
  async function paintRegion(model, canvas, scale, dpr = 1, region = null, hook = null, options = {}) {
    let stopped = false, job = null, fallbackTask = null;
    const task = { cancel() { stopped = true; fallbackTask?.cancel(); if (job) cancelJob(job); } };
    const trackFallback = (next, finished) => {
      if (next) { fallbackTask = next; if (stopped) next.cancel(); }
      else if (fallbackTask === finished) fallbackTask = null;
    };
    tasks.set(task, model.src);
    hook?.(task);
    try {
      const source = getSource(model.src);
      if (await usesNative(model, !!options.samples)) {
        try {
          if (stopped) throw cancelled();
          const spec = await painter.getRenderSpec(model, scale * dpr, region);
          if (stopped) throw cancelled();
          const [ax, ay] = options.pixelRatio || [1, 1];
          const message = { ...(options.samples && { samples: options.samples }), type: 'paint', index: model.idx,
            width: Math.max(1, Math.round(spec.width * scale * dpr * ax)),
            height: Math.max(1, Math.round(spec.height * scale * dpr * ay)),
            fullWidth: Math.max(1, Math.round(spec.viewport.width * ax)),
            fullHeight: Math.max(1, Math.round(spec.viewport.height * ay)),
            x: Math.round((spec.viewport.offsetX || 0) * ax), y: Math.round((spec.viewport.offsetY || 0) * ay),
            rotation: (((model.rot || 0) / 90) % 4 + 4) % 4 };
          const result = await new Promise((resolve, reject) => {
            job = { source, sourceId: model.src, message, background: !!options.backgroundTask, resolve, reject, cancelled: false };
            queue.push(job);
            if (!job.background && (active?.background || active?.prepare) &&
                (active.source !== source || active.message.index !== model.idx)) cancelJob(active);
            pump();
          });
          try {
            if (stopped) throw cancelled();
            canvas.width = result.image.width; canvas.height = result.image.height;
            canvas.getContext('2d').drawImage(result.image, 0, 0);
          } finally { result.image.close(); }
          return;
        } catch (error) {
          if (error?.name === 'RenderingCancelledException') throw error;
          failedSources.add(source); warn('Display worker fallback:', error);
        }
      }
      if (stopped) throw cancelled();
      await painter.paintRegion(model, canvas, scale, dpr, region, trackFallback, options);
      if (options.samples) {
        const samples = options.samples, w = canvas.width / samples, h = canvas.height / samples;
        const ctx = canvas.getContext('2d'), pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const image = ctx.createImageData(w, h);
        averageRasterPixels(pixels.data, image.data, w, h, samples);
        canvas.width = w; canvas.height = h;
        ctx.putImageData(image, 0, 0);
      }
    } finally { tasks.delete(task); hook?.(null, task); }
  }
  const paintPage = (model, canvas, scale, dpr = 1, hook = null, options = {}) =>
    paintRegion(model, canvas, scale, dpr, null, hook, options);
  async function paintOutputPage(model, canvas, scale, dpr = 1, hook = null, options = {}) {
    const check = () => { if (options.signal?.aborted) throw new DOMException('이미지 변환을 취소했습니다.', 'AbortError'); };
    check();
    const viewport = await painter.getViewport(model, 1), ratio = scale * dpr;
    const width = Math.max(1, Math.round(viewport.width * ratio));
    const height = Math.max(1, Math.round(viewport.height * ratio));
    if (options.supersample && !model.blank) {
      const samples = Math.max(2, Math.min(6, Math.floor(Math.sqrt(320000000 / (width * height)))));
      const sx = width / viewport.width, sy = height / viewport.height;
      const tileOptions = { ...options, samples, pixelRatio: [sx / ratio, sy / ratio] };
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d'), tile = createCanvas();
      const native = await usesNative(model, true);
      let boxes = null;
      if (native) {
        const spec = await painter.getRenderSpec(model, ratio * samples);
        const [ax, ay] = tileOptions.pixelRatio;
        const message = { type:'output-bounds', index:model.idx, samples,
          x:Math.round(spec.viewport.offsetX * ax), y:Math.round(spec.viewport.offsetY * ay),
          fullWidth:Math.round(spec.viewport.width * ax), fullHeight:Math.round(spec.viewport.height * ay),
          rotation:(((model.rot || 0) / 90) % 4 + 4) % 4 };
        try {
          const result = await new Promise((resolve,reject) => {
            queue.push({ source:getSource(model.src), sourceId:model.src, message, resolve, reject });
            pump();
          });
          boxes = result.boxes;
        } catch { check(); }
      }
      check();
      if (boxes) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
      }
      const cols = Math.min(width, 2500);
      const tilePixels = native ? 14400000 : 6000000;
      const rows = Math.max(1, Math.floor(tilePixels / (cols * samples ** 2)));
      try {
        for (let y = 0; y < height; y += rows) {
          const h = Math.min(rows, height - y);
          let left = 0, right = width;
          if (boxes) {
            left = width; right = 0;
            for (const [x1,y1,x2,y2] of boxes) {
              if (y1 >= y + h || y2 <= y) continue;
              left = Math.min(left, Math.max(0, x1)); right = Math.max(right, Math.min(width, x2));
            }
          }
          for (let x = left; x < right; x += cols) {
            check();
            const w = Math.min(cols, right - x);
            await paintRegion(model, tile, scale * samples, dpr,
              { x: x / sx, y: y / sy, width: w / sx, height: h / sy }, hook, tileOptions);
            check();
            ctx.drawImage(tile, x, y);
            tile.width = tile.height = 0;
          }
        }
      } finally { tile.width = tile.height = 0; }
      return;
    }
    if (width * height <= 8000000 || model.blank || model.resize || !await eligible(getSource(model.src))) {
      await paintPage(model, canvas, scale, dpr, hook, options); check(); return;
    }
    canvas.width = width; canvas.height = height;
    const tile = createCanvas(), context = canvas.getContext('2d');
    const rows = Math.max(1, Math.floor(8000000 / width));
    try {
      for (let y = 0; y < height; y += rows) {
        check();
        const count = Math.min(rows, height - y);
        await paintRegion(model, tile, scale, dpr,
          { x: 0, y: y / ratio, width: viewport.width, height: count / ratio }, hook, options);
        check(); context.drawImage(tile, 0, y);
        tile.width = tile.height = 0;
      }
    } finally { tile.width = tile.height = 0; }
  }
  return Object.freeze({ paintRegion, paintPage, paintOutputPage, shutdown, invalidateSource, supported, usesNative, warmup, primeSource, prepareReadingPage,
    paintThumbnail: (model, canvas, scale, dpr, hook) => paintPage(model, canvas, scale, dpr, hook, { backgroundTask: true }) });
}

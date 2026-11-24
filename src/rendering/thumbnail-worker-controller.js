export const createThumbnailWorkerController = ({
  workerSource, pdfiumCdn, getWasmBinary, createWorker, getSource,
  onPage, warn, setTimer, clearTimer,
}) => {
  let worker = null;
  let generation = 0;
  let ready = false;
  let starting = false;
  let errors = 0;
  let sequence = 0;
  let batchId = 0;
  let active = null;
  let idleTimer = null;
  const jobs = new Map();
  const pendingKeys = new Set();
  const queue = [];

  function clearBatch(batch) {
    if (!batch) return;
    for (const id of batch.ids) {
      const record = jobs.get(id);
      if (!record) continue;
      jobs.delete(id);
      pendingKeys.delete(record.key);
    }
  }

  function shutdown() {
    generation++; starting = false;
    if (worker) {
      worker.terminate();
      worker = null;
    }
    ready = false;
    active = null;
    jobs.clear();
    pendingKeys.clear();
    queue.length = 0;
    clearTimer(idleTimer);
  }

  function fail(message) {
    warn('썸네일 프리패스 워커 중단:', message);
    errors++;
    shutdown();
  }

  async function start() {
    if (worker || starting || errors >= 2) return;
    starting = true;
    const token = generation;
    try {
      const wasmBinary = await getWasmBinary();
      if (token !== generation) return;
      const nextWorker = createWorker(workerSource);
      nextWorker.onmessage = handleMessage;
      nextWorker.onerror = event => fail(event.message || 'worker error');
      const copy = wasmBinary.slice(0);
      nextWorker.postMessage({ t: 'init', cdn: pdfiumCdn, wasm: copy }, [copy]);
      worker = nextWorker;
    } catch (error) {
      if (token === generation) fail(error.message || error);
    } finally {
      if (token === generation) starting = false;
    }
  }

  function finishBatch() {
    clearBatch(active);
    active = null;
    pump();
  }

  function handleMessage(event) {
    const message = event.data;
    if (message.t === 'ready') {
      ready = true;
      pump();
    } else if (message.t === 'page') {
      const record = jobs.get(message.u);
      jobs.delete(message.u);
      if (record) pendingKeys.delete(record.key);
      Promise.resolve(onPage(record, message)).catch(error => warn('썸네일 프리패스 페이지 실패:', error));
    } else if (message.t === 'done') {
      finishBatch();
    } else if (message.t === 'err') {
      warn('썸네일 프리패스 배치 실패:', message.msg);
      errors++;
      finishBatch();
    }
  }

  function enqueueSource(sourceId, records, pixelWidth) {
    const workerJobs = [];
    const ids = [];
    for (const record of records) {
      if (pendingKeys.has(record.key)) continue;
      const id = ++sequence;
      jobs.set(id, record);
      pendingKeys.add(record.key);
      workerJobs.push({
        u: id, idx: record.page.idx, rot: record.page.rot || 0, px: pixelWidth,
      });
      ids.push(id);
    }
    if (workerJobs.length) queue.push({ sourceId, jobs: workerJobs, ids });
  }

  function cancelMissingSources(sourceIds) {
    for (let index = queue.length - 1; index >= 0; index--) {
      if (sourceIds.has(queue[index].sourceId)) continue;
      clearBatch(queue[index]);
      queue.splice(index, 1);
    }
    if (active && worker && !sourceIds.has(active.sourceId))
      worker.postMessage({ t: 'cancel', id: active.id });
  }

  function pump() {
    if (!worker || !ready || active) return;
    while (queue.length) {
      const batch = queue.shift();
      const source = getSource(batch.sourceId);
      if (!source) {
        clearBatch(batch);
        continue;
      }
      clearTimer(idleTimer);
      const id = ++batchId;
      active = { id, sourceId: batch.sourceId, ids: batch.ids };
      const bytes = source.bytes;
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      worker.postMessage({ t: 'batch', id, bytes: copy, jobs: batch.jobs }, [copy]);
      return;
    }
    clearTimer(idleTimer);
    idleTimer = setTimer(() => {
      if (!active && !queue.length) shutdown();
    }, 60000);
  }

  return Object.freeze({
    start,
    pump,
    shutdown,
    enqueueSource,
    cancelMissingSources,
    hasPending: key => pendingKeys.has(key),
    get errorCount() { return errors; },
  });
};

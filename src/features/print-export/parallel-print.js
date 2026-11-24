const MiB = 1024 * 1024;

export function printWorkerLimit(memory, { sourceBytes = 0, bufferedBytes = 0, heapBytes = 0 } = {}) {
  if (!memory || !Number.isFinite(memory.availablePhysicalBytes) || !Number.isFinite(memory.availableCommitBytes)) return 1;
  const reserve = 2048 * MiB + sourceBytes * 2;
  return memory.availablePhysicalBytes < reserve || memory.availableCommitBytes < reserve ||
    memory.memoryLoadPercent >= 85 || memory.processorCount <= 2 || bufferedBytes >= 128 * MiB || heapBytes >= 768 * MiB ? 1 : 2;
}

export function createParallelPrintFeature({ pdfLib, getWasmBinary, pdfiumCdn, createWorker, getResources }) {
  function client(signal) {
    const worker = createWorker(); let pending = null, closed = false;
    function close() {
      if (closed) return;
      closed = true; worker.terminate(); signal?.removeEventListener('abort', abort);
      if (pending) { clearTimeout(pending.timer); pending.reject(new Error('Print worker stopped')); pending = null; }
    }
    function abort() { close(); }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (!pending) return;
      const task = pending; pending = null; clearTimeout(task.timer);
      data.error ? task.reject(new Error(data.error)) : task.resolve(data);
    };
    worker.onerror = event => {
      if (!pending) return;
      const task = pending; pending = null; clearTimeout(task.timer);
      task.reject(new Error(event.message || 'Print worker failed'));
    };
    return { close, heapBytes: 0, run(message, transfer = []) {
      if (closed || signal?.aborted) return Promise.reject(new Error('Print canceled'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending = null; close(); reject(new Error('Print worker timed out')); }, 120000);
        pending = { resolve, reject, timer };
        try { worker.postMessage(message, transfer); }
        catch (error) { clearTimeout(timer); pending = null; reject(error); }
      });
    } };
  }

  async function buildPdf(bytes, pageSizes, { fitWithin, autoRotateFit = false, name, monochrome = false, onProgress = () => {}, signal } = {}) {
    const workers = [], output = await pdfLib.PDFDocument.create();
    if (name) output.setTitle(name);
    const stats = { maxWorkers: 0, finalWorkers: 0, reductions: [], maxWorkerHeapBytes: 0, bufferedBytes: 0, pages: 0 };
    let limit = 2, retried = false;
    function checkCanceled() { if (signal?.aborted) throw new DOMException('인쇄 준비를 취소했습니다.', 'AbortError'); }
    async function pressure() {
      checkCanceled();
      let memory;
      try { memory = (await getResources())?.memory; } catch { memory = null; }
      checkCanceled();
      if (memory && Math.min(memory.availablePhysicalBytes, memory.availableCommitBytes) < 384 * MiB)
        throw new Error('사용 가능한 메모리가 부족합니다. 다른 문서를 닫은 뒤 다시 인쇄하세요.');
      if (limit === 2 && printWorkerLimit(memory, { sourceBytes: bytes.byteLength,
        bufferedBytes: stats.bufferedBytes, heapBytes: workers.reduce((sum, w) => sum + w.heapBytes, 0) }) === 1) {
        limit = 1; stats.reductions.push(memory ? 'memory-pressure' : 'memory-unknown');
        while (workers.length > 1) workers.pop().close();
      }
    }
    function stopWorkers() { while (workers.length) workers.pop().close(); }
    try {
      await pressure();
      const wasm = await getWasmBinary();
      async function addWorker() {
        checkCanceled();
        const next = client(signal); workers.push(next);
        stats.maxWorkers = Math.max(stats.maxWorkers, workers.length);
        const copy = bytes.slice().buffer, wasmCopy = wasm.slice(0);
        const result = await next.run({ type: 'init', bytes: copy, wasm: wasmCopy, cdn: pdfiumCdn, pages: pageSizes.length }, [copy, wasmCopy]);
        next.heapBytes = result.heapBytes;
      }
      async function ensureWorkers() {
        while (workers.length < limit) { await pressure(); if (workers.length < limit) await addWorker(); }
      }
      async function serialRetry() {
        if (retried) return false;
        retried = true; stopWorkers(); limit = 1; stats.reductions.push('worker-retry');
        await pressure(); await addWorker(); return true;
      }
      try { await ensureWorkers(); }
      catch (error) { checkCanceled(); if (!await serialRetry()) throw error; }
      for (let start = 0; start < pageSizes.length;) {
        await pressure(); onProgress(start, pageSizes.length);
        const jobs = pageSizes.slice(start, start + limit).map((v, offset) => {
          const sheet = autoRotateFit && fitWithin && (fitWithin[0] > fitWithin[1]) !== (v.width > v.height)
            ? [fitWithin[1], fitWithin[0]] : fitWithin;
          const scale = Math.min(300 / 72 * (sheet ? Math.min(sheet[0] / v.width, sheet[1] / v.height) : 1),
            6000 / Math.max(v.width, v.height), Math.sqrt(16e6 / (v.width * v.height)));
          return { type: 'render', index: start + offset, width: Math.max(1, Math.round(v.width * scale)),
            height: Math.max(1, Math.round(v.height * scale)), monochrome };
        });
        let results;
        try { results = await Promise.all(jobs.map((job, index) => workers[index].run(job))); }
        catch (error) {
          checkCanceled(); if (!await serialRetry()) throw error;
          continue;
        }
        checkCanceled();
        for (let i = 0; i < results.length; i++) {
          const result = results[i], index = start + i, viewport = pageSizes[index];
          if (result.index !== index) throw new Error('인쇄 페이지 순서 검증에 실패했습니다.');
          workers[i].heapBytes = result.heapBytes;
          stats.maxWorkerHeapBytes = Math.max(stats.maxWorkerHeapBytes, result.heapBytes);
          const page = output.addPage([viewport.width, viewport.height]);
          const image = await output.embedJpg(new Uint8Array(result.bytes));
          page.drawImage(image, { x: 0, y: 0, width: viewport.width, height: viewport.height });
          stats.bufferedBytes += result.bytes.byteLength; result.bytes = null;
          stats.pages++;
        }
        start += results.length; onProgress(start, pageSizes.length);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      stats.finalWorkers = workers.length;
      stopWorkers(); checkCanceled();
      return { bytes: new Uint8Array(await output.save({ useObjectStreams: false })), stats };
    } finally { stopWorkers(); }
  }
  return Object.freeze({ buildPdf });
}

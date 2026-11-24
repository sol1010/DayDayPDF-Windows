import test from 'node:test';
import assert from 'node:assert/strict';
import { createParallelPrintFeature, printWorkerLimit } from '../../src/features/print-export/parallel-print.js';
const GiB = 1024 ** 3;
const normal = { availablePhysicalBytes: 8 * GiB, availableCommitBytes: 8 * GiB, memoryLoadPercent: 40 };
const low = { ...normal, availablePhysicalBytes: GiB };
function setup({ memory = () => normal, failIndex = -1, delay = i => i % 2 ? 1 : 8 } = {}) {
  const state = { alive: 0, peakAlive: 0, active: 0, peakActive: 0, order: [], calls: [], terminated: 0 };
  let failed = false;
  const feature = createParallelPrintFeature({
    pdfLib: { PDFDocument: { create: async () => ({
      addPage: () => ({ drawImage: image => state.order.push(image) }), embedJpg: async bytes => bytes[0],
      save: async () => new Uint8Array(state.order),
    }) } },
    getWasmBinary: async () => new ArrayBuffer(2), pdfiumCdn: 'test/',
    getResources: async () => ({ memory: memory(state) }),
    createWorker: () => {
      state.alive++; state.peakAlive = Math.max(state.peakAlive, state.alive);
      let closed = false, timer, busy = false;
      const worker = {
        terminate() { if (closed) return; closed = true; clearTimeout(timer); state.alive--; state.terminated++; if (busy) state.active--; },
        postMessage(job) {
          if (job.type === 'init') { queueMicrotask(() => !closed && worker.onmessage({ data: { heapBytes: 128 * 1024 ** 2 } })); return; }
          busy = true; state.active++; state.peakActive = Math.max(state.peakActive, state.active); state.calls.push(job.index);
          timer = setTimeout(() => {
            busy = false; state.active--;
            if (job.index === failIndex && !failed) { failed = true; worker.onmessage({ data: { error: 'memory allocation failed' } }); return; }
            worker.onmessage({ data: { index: job.index, bytes: new Uint8Array([job.index]).buffer, heapBytes: 160 * 1024 ** 2 } });
          }, delay(job.index));
        },
      }; return worker;
    },
  });
  return { state, run: signal => feature.buildPdf(new Uint8Array([1, 2]), Array.from({ length: 8 }, () => ({ width: 595, height: 842 })), { fitWithin: [595, 842], signal }) };
}
test('print order survives reversed completion; at most two workers/pages exist and all are released', async () => {
  const s = setup(); const result = await s.run();
  assert.deepEqual(s.state.order, [0,1,2,3,4,5,6,7]);
  assert.equal(s.state.peakAlive, 2); assert.equal(s.state.peakActive, 2); assert.equal(s.state.alive, 0);
  assert.equal(result.stats.maxWorkers, 2);
});
test('low and unknown memory start with one worker', async () => {
  for (const memory of [low, null]) { const s = setup({ memory: () => memory }); await s.run(); assert.equal(s.state.peakAlive, 1); assert.equal(s.state.alive, 0); }
});
test('memory pressure between batches reduces two to one without losing/duplicating/reordering pages', async () => {
  const s = setup({ memory: state => state.order.length >= 2 ? low : normal });
  const result = await s.run(); assert.equal(result.stats.finalWorkers, 1);
  assert.deepEqual(result.stats.reductions, ['memory-pressure']); assert.deepEqual(s.state.order, [0,1,2,3,4,5,6,7]);
  assert.equal(s.state.alive, 0);
});
test('a failed uncommitted batch is retried serially once; completed pages are not duplicated', async () => {
  const s = setup({ failIndex: 3 }); const result = await s.run();
  assert.equal(result.stats.finalWorkers, 1); assert.deepEqual(result.stats.reductions, ['worker-retry']);
  assert.deepEqual(s.state.order, [0,1,2,3,4,5,6,7]); assert.equal(s.state.alive, 0);
});
test('cancellation rejects the pending render and releases both workers', async () => {
  const s = setup({ delay: () => 1000 }), abort = new AbortController();
  const task = s.run(abort.signal); setTimeout(() => abort.abort(), 20);
  await assert.rejects(task, { name: 'AbortError' }); assert.equal(s.state.alive, 0); assert.equal(s.state.active, 0);
});
test('severe exhaustion stops before allocating an engine; limits include commit and engine buffers', async () => {
  const s = setup({ memory: () => ({ ...normal, availablePhysicalBytes: 100 * 1024 ** 2 }) });
  await assert.rejects(s.run(), /메모리/); assert.equal(s.state.peakAlive, 0);
  assert.equal(printWorkerLimit({ ...normal, availableCommitBytes: GiB }), 1);
  assert.equal(printWorkerLimit(normal, { heapBytes: 768 * 1024 ** 2 }), 1);
  assert.equal(printWorkerLimit(normal, { bufferedBytes: 128 * 1024 ** 2 }), 1);
});

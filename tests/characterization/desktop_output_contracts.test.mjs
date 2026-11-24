import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopOutputAdapter } from '../../src/adapters/desktop-output-adapter.js';
import * as pdfLib from 'pdf-lib';
import { makePdfPrintCopy } from '../../src/features/print-export/pdf-print-copy.js';

function setup() {
  const sent = [];
  let onMessage, onBuffer;
  const adapter = createDesktopOutputAdapter({
    onMessage: handler => { onMessage = handler; },
    onSharedBuffer: handler => { onBuffer = handler; },
    send: message => { sent.push(message); return true; },
  });
  return { adapter, sent, message: value => onMessage(value), buffer: value => onBuffer(value) };
}
test('desktop outputs copy exact binary bytes and keep PDF save and conversion requests independent', async () => {
  const s = setup();
  const bytes = new Uint8Array([37, 80, 68, 70, 45, 0, 255]);
  const print = s.adapter.print(bytes, { printer: 'Test printer', copies: 2 });
  const save = s.adapter.save(new Uint8Array([80, 75, 0, 255]), 'report.xlsx');
  const [first, second] = s.sent;
  assert.notEqual(first.requestId, second.requestId);
  assert.equal(first.apiVersion, 4);
  const buffer = new ArrayBuffer(bytes.length);
  s.buffer({ metadata: { cmd: 'output-buffer', requestId: first.requestId }, buffer });
  assert.deepEqual(new Uint8Array(buffer), bytes);
  assert.deepEqual(s.sent.at(-1), { type: 'output-put-done', apiVersion: 4, requestId: first.requestId });
  s.message({ cmd: 'output-result', requestId: second.requestId, canceled: true });
  s.message({ cmd: 'output-result', requestId: first.requestId, ok: true });
  assert.equal((await print).ok, true);
  assert.equal((await save).canceled, true);
});
test('desktop output rejects a mismatched shared buffer without committing partial data', async () => {
  const s = setup();
  const task = s.adapter.save(new Uint8Array([1, 2, 3]), 'report.pdf');
  s.buffer({ metadata: { cmd: 'output-buffer', requestId: s.sent[0].requestId }, buffer: new ArrayBuffer(2) });
  await assert.rejects(task, /크기가 일치하지/);
  assert.equal(s.sent.length, 1);
});
test('desktop output reports printer failures and does not resolve unrelated requests', async () => {
  const s = setup();
  const task = s.adapter.printers();
  s.message({ cmd: 'output-result', requestId: 'unrelated', ok: true });
  s.message({ cmd: 'output-result', requestId: s.sent[0].requestId, error: 'Printer unavailable' });
  await assert.rejects(task, /Printer unavailable/);
});

test('opening a conversion result waits for the native tab and reports a failed open for retry', async () => {
  const s = setup();
  const task = s.adapter.openSaved('saved-pdf');
  const request = s.sent[0];
  assert.equal(request.type, 'output-open-saved');
  assert.equal(request.savedRequestId, 'saved-pdf');
  let finished = false;
  task.then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  s.message({ cmd: 'output-result', requestId: request.requestId, ok: true });
  assert.equal((await task).ok, true);
  const retry = s.adapter.openSaved('missing-pdf');
  s.message({ cmd: 'output-result', requestId: s.sent.at(-1).requestId, error: 'PDF unavailable' });
  await assert.rejects(retry, /PDF unavailable/);
});

test('PDF printing fits rotated, cropped and blank pages to the chosen paper and collates copies', async () => {
  const source = await pdfLib.PDFDocument.create();
  for (const rotation of [0, 90, 180, 270]) {
    const page = source.addPage([300, 500]);
    page.setCropBox(30, 40, 200, 350);
    page.setRotation(pdfLib.degrees(rotation));
    page.drawText(`Rotation ${rotation}`, { x: 50, y: 100 });
  }
  source.addPage([300, 500]);
  const original = await source.save();
  const printed = await pdfLib.PDFDocument.load(await makePdfPrintCopy(pdfLib, original, { paper: 'letter', orientation: 'landscape', copies: 2 }));
  assert.equal(printed.getPageCount(), 10);
  for (const page of printed.getPages()) {
    assert.deepEqual(page.getSize(), { width: 792, height: 612 });
    assert.equal(page.getRotation().angle, 0);
  }
  assert.equal((await pdfLib.PDFDocument.load(original)).getPageCount(), 5);
  await assert.rejects(makePdfPrintCopy(pdfLib, original, { copies: 0 }), /인쇄 매수/);
});

test('30-page PDF print copies reuse shared image streams instead of multiplying document data', async () => {
  const source = await pdfLib.PDFDocument.create();
  const image = source.context.register(source.context.flateStream(new Uint8Array(64 * 64 * 3).fill(128), {
    Type: 'XObject', Subtype: 'Image', Width: 64, Height: 64, ColorSpace: 'DeviceRGB', BitsPerComponent: 8,
  }));
  for (let index = 0; index < 30; index++) {
    const page = source.addPage([600, 400]), name = page.node.newXObject('Drawing', image);
    page.pushOperators(pdfLib.pushGraphicsState(), pdfLib.concatTransformationMatrix(200, 0, 0, 200, 40, 40),
      pdfLib.drawObject(name), pdfLib.popGraphicsState());
  }
  const printed = await pdfLib.PDFDocument.load(await makePdfPrintCopy(pdfLib, await source.save(), {
    paper: 'a4', orientation: 'landscape', copies: 2,
  }));
  assert.equal(printed.getPageCount(), 60);
  const images = printed.context.enumerateIndirectObjects().filter(([, value]) =>
    value instanceof pdfLib.PDFRawStream && value.dict.get(pdfLib.PDFName.of('Subtype')) === pdfLib.PDFName.of('Image'));
  assert.equal(images.length, 1, 'Shared drawing data must remain a single stream across pages and copies');
});


test('native resource requests correlate memory readings and release the preparation lease', async () => {
  const s = setup(); const task = s.adapter.resources('begin');
  assert.equal(s.sent[0].type, 'output-resources'); assert.equal(s.sent[0].action, 'begin');
  s.message({ cmd: 'output-result', requestId: s.sent[0].requestId, ok: true, memory: { availablePhysicalBytes: 123 } });
  assert.equal((await task).memory.availablePhysicalBytes, 123);
  const end = s.adapter.resources('end');
  s.message({ cmd: 'output-result', requestId: s.sent[1].requestId, ok: true }); await end;
});

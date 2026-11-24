import test from 'node:test';
import assert from 'node:assert/strict';
import pdfLib from 'pdf-lib';
import { addPrintMediaRun, alignPrinterMedia, makePdfPrintCopy, withPrintTitle, printPaperSize, printPaperSizes } from '../../src/features/print-export/pdf-print-copy.js';
import { normalizePrintPreferences } from '../../src/ui/editor/print-dialog-controller.js';

test('printable media and saved selections use the same physical dimensions', () => {
  const keys = ['auto', ...Object.keys(printPaperSizes).map(key => key.toLowerCase())];
  for (const paper of keys) assert.equal(normalizePrintPreferences({ paper }, keys).paper, paper);
  assert.equal(printPaperSize('auto', 'portrait'), null);
  assert.deepEqual(printPaperSize('legal', 'landscape'), [1008, 612]);
  assert.ok(printPaperSize('b4 (jis)', 'portrait')[0] > printPaperSize('b4 (iso)', 'portrait')[0]);
  const runs = [];
  for (const [i, size] of [[100, 200], [100, 200], [200, 100], [100, 200]].entries())
    addPrintMediaRun(runs, i + 1, ...size);
  assert.deepEqual(runs.map(r => [r.first, r.last]), [[1, 2], [3, 3], [4, 4]]);
});

test('original-size PDF output respects rotation, crop, user units and collated copies', async () => {
  const input = await pdfLib.PDFDocument.create();
  input.addPage([200, 300]).drawText('one');
  const second = input.addPage([600, 400]);
  second.drawText('two');
  second.setCropBox(20, 30, 280, 160);
  second.setRotation(pdfLib.degrees(90));
  second.node.set(pdfLib.PDFName.of('UserUnit'), pdfLib.PDFNumber.of(2));
  const bytes = await input.save();
  const renamed = await withPrintTitle(pdfLib, bytes, 'job.pdf');
  assert.equal((await pdfLib.PDFDocument.load(renamed)).getTitle(), 'job.pdf');
  assert.equal(await withPrintTitle(pdfLib, renamed, 'job.pdf'), renamed);
  const options = { paper: 'auto', orientation: 'auto', copies: 2, name: '인쇄 시험.pdf' };
  const out = await pdfLib.PDFDocument.load(await makePdfPrintCopy(pdfLib, bytes, options));
  assert.deepEqual(out.getPages().map(p => [p.getWidth(), p.getHeight()]), [[200,300],[320,560],[200,300],[320,560]]);
  assert.equal(out.getTitle(), options.name);
  const fixed = await pdfLib.PDFDocument.load(await makePdfPrintCopy(pdfLib, bytes, { ...options, paper: 'legal', orientation: 'portrait', copies: 1 }));
  assert.ok(fixed.getPages().every(p => p.getWidth() === 612 && p.getHeight() === 1008));
  await assert.rejects(makePdfPrintCopy(pdfLib, bytes, { ...options, signal: AbortSignal.abort() }), { name: 'AbortError' });
});

test('physical printers keep one feed direction across standard and custom sheets', async () => {
  const pdf = await pdfLib.PDFDocument.create();
  for (const size of [[595.32, 841.92], [842, 595], [595, 842], [1190.55, 841.89], [595.2, 841.68], [596, 842]]) {
    pdf.addPage(size).drawText('Orientation check');
  }
  pdf.getPage(2).setRotation(pdfLib.degrees(90));
  pdf.getPage(2).setCropBox(0, 0, 595, 842);
  const bytes = await pdf.save();
  const runs = [];
  for (const [i, size] of [[595.32, 841.92], [842, 595], [842, 595], [1190.55, 841.89], [595.2, 841.68], [596, 842]].entries())
    addPrintMediaRun(runs, i + 1, ...size);
  const print = await alignPrinterMedia(pdfLib, bytes, runs);
  assert.deepEqual(print.mediaRuns.map(r => [r.first, r.last]), [[1, 3], [4, 4], [5, 5], [6, 6]]);
  assert.deepEqual(print.mediaRuns.map(r => [r.width, r.height]), [printPaperSizes.A4, printPaperSizes.A3, printPaperSizes.A4, [596, 842]]);
  const printed = await pdfLib.PDFDocument.load(print.bytes);
  assert.deepEqual(printed.getPages().map(p => p.getRotation().angle), [0, 270, 0, 270, 0, 0]);
  assert.deepEqual(printed.getPage(2).getCropBox(), pdf.getPage(2).getCropBox());
  assert.equal((await pdfLib.PDFDocument.load(bytes)).getPage(2).getRotation().angle, 90);

  const reversed = await pdfLib.PDFDocument.create();
  reversed.addPage([842, 595]).drawText('Landscape first');
  reversed.addPage([595, 842]).drawText('Portrait second');
  const reversedBytes = await reversed.save();
  const landscape = await alignPrinterMedia(pdfLib, reversedBytes, [
    { first: 1, last: 1, width: 842, height: 595 }, { first: 2, last: 2, width: 595, height: 842 },
  ]);
  assert.deepEqual(landscape.mediaRuns, [{ first: 1, last: 2, width: printPaperSizes.A4[1], height: printPaperSizes.A4[0] }]);
  assert.equal((await pdfLib.PDFDocument.load(landscape.bytes)).getPage(1).getRotation().angle, 90);
  const single = await pdfLib.PDFDocument.create();
  single.addPage([595.32, 841.92]);
  const singleBytes = await single.save();
  assert.equal((await alignPrinterMedia(pdfLib, singleBytes, runs.slice(0, 1))).bytes, singleBytes);
  await assert.rejects(alignPrinterMedia(pdfLib, bytes, runs, AbortSignal.abort()), { name: 'AbortError' });
});

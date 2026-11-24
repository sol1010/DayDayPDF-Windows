import test from 'node:test';
import assert from 'node:assert/strict';
import pdfLib from 'pdf-lib';
import { addPrintMediaRun, makePdfPrintCopy, withPrintTitle, printPaperSize, printPaperSizes } from '../../src/features/print-export/pdf-print-copy.js';
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

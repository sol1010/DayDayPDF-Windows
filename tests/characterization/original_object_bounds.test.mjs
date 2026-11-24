import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { init } from '@embedpdf/pdfium';
import { PDFDocument, clip, degrees, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb } from 'pdf-lib';
import { pdfObjectBounds, transformPdfObject } from '../../src/features/original-editor/object-bounds.js';

const wasm = new URL('../../assets/windows-vendor/pdfium/2.15.0/pdfium.wasm', import.meta.url);

async function inspect(lib, bytes, callback) {
  const mod = lib.pdfium, heap = mod.wasmExports;
  const file = heap.malloc(bytes.length), buf = heap.malloc(24);
  mod.HEAPU8.set(bytes, file);
  const doc = lib.FPDF_LoadMemDocument(file, bytes.length, '');
  const page = lib.FPDF_LoadPage(doc, 0);
  try {
    const object = lib.FPDFPage_GetObject(page, 0);
    return callback(object, buf, page, doc);
  } finally {
    lib.FPDF_ClosePage(page); lib.FPDF_CloseDocument(doc);
    heap.free(buf); heap.free(file);
  }
}

function near(actual, expected) {
  assert.ok(actual?.every((value, i) => Math.abs(value - expected[i]) < .002),
    JSON.stringify({ actual, expected }));
}

test('reopened PDF regions use the visible bounds across nested forms and edits', async () => {
  const lib = await init({ thisProgram: 'bounds-test', wasmBinary: await readFile(wasm) });
  lib.PDFiumExt_Init();
  try {
    const source = await PDFDocument.create();
    source.addPage([400,500]).drawRectangle({ x:0, y:0, width:400, height:500, color:rgb(1,0,0) });
    const crop = await PDFDocument.create();
    const region = await crop.embedPage(source.getPage(0), {left:100,bottom:150,right:190,top:210}, [1,0,0,1,-100,-150]);
    crop.addPage([500,600]).drawPage(region, { x:60, y:20 });
    await crop.flush();
    const bounds = (object, buf) => pdfObjectBounds(lib, lib.pdfium, object, lib.FPDFPageObj_GetType(object), buf);
    await inspect(lib, await crop.save(), (object, buf) => near(bounds(object,buf), [60,20,150,80]));

    const rotated = await PDFDocument.create(), sheet = rotated.addPage([700,700]);
    const group = await rotated.embedPage(crop.getPage(0));
    sheet.drawPage(group, { x:300, y:100, xScale:2, yScale:.5, rotate:degrees(90) });
    await inspect(lib, await rotated.save(), (object, buf) => near(bounds(object,buf), [260,220,290,400]));

    const clipped = await PDFDocument.create(), page = clipped.addPage([500,600]);
    const outer = await clipped.embedPage(crop.getPage(0));
    page.pushOperators(pushGraphicsState(), rectangle(66,28,26,37), clip(), endPath());
    page.drawPage(outer);
    page.pushOperators(popGraphicsState());
    const saved = await inspect(lib, await clipped.save(), (object, buf, pg, doc) => {
      near(bounds(object,buf), [66,28,92,65]);
      transformPdfObject(lib, object, [1,0,0,1,12,8]);
      near(bounds(object,buf), [78,36,104,73]);
      assert.ok(lib.FPDFPage_GenerateContent(pg));
      const writer = lib.PDFiumExt_OpenFileWriter();
      try {
        assert.ok(lib.PDFiumExt_SaveAsCopy(doc,writer));
        const size=lib.PDFiumExt_GetFileWriterSize(writer), ptr=lib.pdfium.wasmExports.malloc(size);
        try { lib.PDFiumExt_GetFileWriterData(writer,ptr,size); return lib.pdfium.HEAPU8.slice(ptr,ptr+size); }
        finally { lib.pdfium.wasmExports.free(ptr); }
      } finally { lib.PDFiumExt_CloseFileWriter(writer); }
    });
    await inspect(lib, saved, (object, buf) => near(bounds(object,buf),[78,36,104,73]));
  } finally { lib.FPDF_DestroyLibrary(); }
});

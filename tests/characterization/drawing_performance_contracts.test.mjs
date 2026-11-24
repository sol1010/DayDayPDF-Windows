import test from 'node:test';
import assert from 'node:assert/strict';
import * as PDFLib from 'pdf-lib';
import { deflateSync, inflateSync } from 'node:zlib';
const { PDFDocument, StandardFonts, PDFName } = PDFLib;
import { pagePtToFrac, pageFracToPt, pageRectToDispRect } from '../../src/core/geometry.js';
import { originalPrintBytes, copyOutputPages, embedResizedOutputPages, canvasImageBytes, drawOpaquePng, drawCanvasRgb, createRasterOutputFeature } from '../../src/features/print-export/output-preparation.js';

test('RGBA output compresses bounded strips and preserves every RGB pixel on white paper', async () => {
  const width = 257, height = 300, expected = new Uint8Array(width * height * 3), reads = [];
  const canvas = { width, height, getContext: () => ({ getImageData(x, y, w, h) {
    reads.push(h); assert.equal(x, 0); assert.equal(w, width);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) {
      const at = (row * w + col) * 4, alpha = col % 3 === 0 ? 128 : 255;
      data.set([col % 256, (y + row) % 256, 60, alpha], at);
      const target = ((y + row) * w + col) * 3;
      for (let c = 0; c < 3; c++) expected[target + c] = Math.round((data[at + c] * alpha + 255 * (255 - alpha)) / 255);
    }
    return { data };
  } }) };
  const pdf = await PDFDocument.create(), page = pdf.addPage([500, 600]);
  assert.equal(await drawCanvasRgb(pdf, page, canvas, PDFLib), true);
  assert.ok(reads.length > 1 && Math.max(...reads) <= 128);
  const reopened = await PDFDocument.load(await pdf.save());
  const image = reopened.context.enumerateIndirectObjects().map(([, v]) => v)
    .find(v => v instanceof PDFLib.PDFRawStream && v.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
  assert.deepEqual(new Uint8Array(inflateSync(image.contents)), expected);
  assert.equal(image.dict.lookup(PDFName.of('Width')).asNumber(), width);
  assert.equal(await drawCanvasRgb(pdf, page, canvas, PDFLib, null), false);
});

test('raster output consumes pages in order, caps pixels and releases its only canvas on failure', async () => {
  const canvas = { width: 0, height: 0, getContext: () => ({}) }, seen = [], progress = [], intents = [];
  let prepared = -1;
  const feature = createRasterOutputFeature({ pdfLib: PDFLib, createCanvas: () => canvas,
    getViewport: async () => ({ width: 2384, height: 1684 }),
    prepareImages: async p => { prepared = p.idx; },
    paintPage: async (p, c, scale, dpr, hook, options) => {
      assert.equal(prepared, p.idx); intents.push(options.intent);
      assert.equal(c.width, 0); c.width = Math.round(2384 * scale); c.height = Math.round(1684 * scale);
    }, drawObjects: () => {}, yieldTask: async () => {},
  });
  const pages = Array.from({ length: 30 }, (_, idx) => ({ idx }));
  const result = await feature.render(pages, { scale: 300 / 72, maxEdge: 6000, maxPixels: 16e6,
    intent: 'print', onProgress: (done, total) => progress.push([done, total]),
  }, async (c, viewport, index) => { assert.ok(c.width * c.height < 16010000); seen.push(index); });
  assert.deepEqual(seen, pages.map(p => p.idx)); assert.ok(result.limited);
  assert.deepEqual(progress.at(-1), [30, 30]); assert.ok(intents.every(i => i === 'print'));
  assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
  await assert.rejects(feature.render(pages, { scale: 1 }, () => { throw Error('encode failed'); }), /encode failed/);
  assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
});

test('image printing targets paper DPI while export retains source resolution', async () => {
  const dimensions = [{ width: 2384, height: 1684 }, { width: 400, height: 600 }];
  const canvas = { width: 0, height: 0, getContext: () => ({}) }, scales = [];
  const feature = createRasterOutputFeature({ pdfLib: PDFLib, createCanvas: () => canvas,
    getViewport: async p => dimensions[p.idx], prepareImages: async () => {},
    paintPage: async (p, c, scale) => { scales.push(scale); }, drawObjects: () => {}, yieldTask: async () => {},
  });
  const result = await feature.render([{ idx: 0 }, { idx: 1 }], {
    scale: 300 / 72, fitWithin: [595.28, 841.89], maxEdge: 6000, maxPixels: 16e6,
  }, async () => {});
  assert.ok(Math.abs(dimensions[0].width * scales[0] - 595.28 * 300 / 72) < .001);
  assert.ok(Math.abs(dimensions[1].height * scales[1] - 841.89 * 300 / 72) < .001);
  assert.equal(result.limited, false, 'Fitting a drawing to paper does not reduce its requested print DPI');
  await feature.render([{ idx: 1 }], { scale: 2 }, async () => {});
  assert.equal(scales.at(-1), 2, 'Image export keeps the requested source scale');
});

test('resized and cropped paper maps edit points both ways at all rotations', () => {
  const view = [-35, 20, 565, 420];
  for (const rot of [0,90,180,270]) for (const resize of [undefined,[300,500],[900,300]]) for (const crop of [undefined,[.13,.2,.6,.55]]) {
    const p={resize,crop};
    for(const point of [[-35,20],[565,420],[150,95],[300,220]]) {
      const frac=pagePtToFrac(p,view,rot,...point), actual=pageFracToPt(p,view,rot,...frac);
      point.forEach((value,i)=>assert.ok(Math.abs(actual[i]-value)<1e-8));
    }
  }
  const page={resize:[400,400]};
  assert.deepEqual(pageRectToDispRect(page,[0,0,400,200],0,[0,0,400,200]),{l:0,t:.25,w:1,h:.5});
  assert.ok(pageFracToPt(page,[0,0,400,200],0,.5,.1)[1]>200,'margin cannot select original ink');
});

test('print identity rejects changed, reordered, partial, or locked content', () => {
  const bytes=new Uint8Array([1,2,3]), source={bytes,doc:{numPages:2}};
  const pages=[0,1].map(idx=>({src:1,idx,rot:0,texts:[]}));
  assert.equal(originalPrintBytes(pages,()=>source),bytes);
  for(const edit of [{rot:90},{resize:[500,600]},{crop:[0,0,.5,1]},{texts:[{type:'rect'}]},{blank:[1,1]},{src:2},{idx:1}])
    assert.equal(originalPrintBytes([{...pages[0],...edit},pages[1]],()=>source),null);
  assert.equal(originalPrintBytes(pages.slice(1),()=>source),null);
  assert.equal(originalPrintBytes(pages,()=>({...source,locked:true})),null);
});

test('batched output shares fonts while repeated pages have independent page dictionaries', async () => {
  const source=await PDFDocument.create(), font=await source.embedFont(StandardFonts.Helvetica);
  for(let i=0;i<3;i++)source.addPage([600,400]).drawText('Drawing '+i,{font,x:20,y:40});
  const out=await PDFDocument.create(), pages=[0,1,0,2].map(idx=>({src:1,idx}));
  const copies=await copyOutputPages(out,pages,async()=>source);
  for(let i=0;i<pages.length;i++)out.addPage(copies.get(i));
  copies.get(0).setSize(800,200);
  assert.equal(copies.get(2).getWidth(),600);
  assert.notEqual(copies.get(0).node,copies.get(2).node);
  const result=await PDFDocument.load(await out.save());
  assert.equal(result.getPageCount(),4);
  assert.equal(result.getPage(0).getWidth(),800); assert.equal(result.getPage(2).getWidth(),600);
  const firstFont=copies.get(0).node.Resources().lookup(PDFName.of('Font')).values()[0];
  const secondFont=copies.get(1).node.Resources().lookup(PDFName.of('Font')).values()[0];
  assert.equal(firstFont.toString(),secondFont.toString());
});

test('image encoding returns bytes without base64 and rejects encoder fallback', async () => {
  const raw=new Uint8Array([255,216,255,3]);
  const canvas={toBlob(callback,type){callback(new Blob([raw],{type}));},toDataURL(){throw Error('base64 must not be used');}};
  assert.deepEqual(await canvasImageBytes(canvas,'image/jpeg',.9),raw);
  await assert.rejects(canvasImageBytes({toBlob(cb){cb(new Blob([],{type:'image/png'}));}},'image/jpeg',.9));
});

test('resized output retains one shared image across 30 pages, repeated indexes and multiple sources', async () => {
  const makeSource = async () => {
    const doc = await PDFDocument.create();
    const image = doc.context.register(doc.context.flateStream(new Uint8Array([40, 80, 120]), {
      Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8,
    }));
    for (let index = 0; index < 30; index++) {
      const page = doc.addPage([600, 400]), name = page.node.newXObject('Drawing', image);
      page.pushOperators(PDFLib.drawObject(name));
    }
    return doc;
  };
  const sources = [await makeSource(), await makeSource()], output = await PDFDocument.create();
  const pages = Array.from({length: 30}, (_, idx) => ({src: 0, idx, resize: [400, 600]}));
  pages.push({src: 0, idx: 0, resize: [200, 300]}, {src: 1, idx: 0, resize: [400, 600]},
    {blank: [400, 600]}, {src: 0, idx: 1});
  const embedded = await embedResizedOutputPages(output, pages, id => sources[id]);
  assert.equal(embedded.size, 32);
  assert.ok(!embedded.has(32) && !embedded.has(33));
  for (const [index, page] of embedded) output.addPage(pages[index].resize).drawPage(page);
  const saved = await PDFDocument.load(await output.save());
  assert.equal(saved.getPageCount(), 32);
  const images = saved.context.enumerateIndirectObjects().filter(([, value]) =>
    value instanceof PDFLib.PDFRawStream && value.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
  assert.equal(images.length, 2, 'Each source shares its image across resized output pages');
});

test('opaque PNG output preserves filtered pixel bytes without recompression and rejects alpha', async () => {
  const chunk=(type,data)=>{
    const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length,0);b.write(type,4);b.set(data,8);
    let crc=0xffffffff;for(const value of b.subarray(4,-4)){crc^=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    b.writeUInt32BE((crc^0xffffffff)>>>0,b.length-4);return b;
  };
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(2,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=2;
  const pixels=Buffer.from([0,255,0,0,0,0,255]), compressed=deflateSync(pixels);
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',compressed.subarray(0,3)),chunk('IDAT',compressed.subarray(3)),chunk('IEND',Buffer.alloc(0))]);
  const doc=await PDFDocument.create(),page=doc.addPage([100,50]);
  assert.equal(drawOpaquePng(doc,page,png,PDFLib),true);
  const saved=await PDFDocument.load(await doc.save()),objects=saved.getPage(0).node.Resources().lookup(PDFName.of('XObject'));
  const image=saved.context.lookup(objects.values()[0]);
  assert.deepEqual(Buffer.from(image.contents),compressed);
  assert.deepEqual(inflateSync(image.contents),pixels);
  assert.equal(image.dict.lookup(PDFName.of('DecodeParms')).lookup(PDFName.of('Predictor')).asNumber(),15);
  const transparent=Buffer.from(png);transparent[25]=6;
  assert.equal(drawOpaquePng(doc,page,transparent,PDFLib),false);
  assert.equal(drawOpaquePng(doc,page,png.subarray(0,png.length-8),PDFLib),false);
});


test('PNG image-only copies bypass PNG encoding, keep page order and contain no original text or edit metadata', async () => {
  let pixel;
  const canvas = { width: 0, height: 0, toBlob() { throw Error('Unnecessary PNG encode'); },
    getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray([...pixel, 255]) }) }) };
  const feature = createRasterOutputFeature({ pdfLib: PDFLib, createCanvas: () => canvas,
    getViewport: async p => ({ width: 100 + p.idx, height: 200 }),
    paintPage: async (p, c) => { c.width = c.height = 1; pixel = [p.idx, 50, 100]; },
    drawObjects: (p, c, width) => assert.equal(width, 100 + p.idx), yieldTask: async () => {},
  });
  const { bytes } = await feature.buildPdf([{ idx: 2 }, { idx: 0 }, { idx: 1 }], { scale: 1 });
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getKeywords(), undefined);
  assert.deepEqual(doc.getPages().map(p => p.getWidth()), [102, 100, 101]);
  for (const [i, page] of doc.getPages().entries()) {
    assert.equal(page.node.Resources().lookup(PDFName.of('Font'))?.keys().length || 0, 0);
    const entries = page.node.Resources().lookup(PDFName.of('XObject')).entries(); assert.equal(entries.length, 1);
    const image = doc.context.lookup(entries[0][1]);
    assert.equal(image.dict.get(PDFName.of('Subtype')), PDFName.of('Image'));
    assert.deepEqual([...inflateSync(image.contents)], [[2, 50, 100], [0, 50, 100], [1, 50, 100]][i]);
  }
});

test('cancelled image output never consumes a partial page and releases its canvas', async () => {
  const abort = new AbortController(), canvas = { width: 0, height: 0, getContext: () => ({}) };
  const feature = createRasterOutputFeature({ createCanvas: () => canvas,
    getViewport: async () => ({ width: 100, height: 200 }),
    paintPage: async (_p, c) => { c.width = 100; c.height = 200; abort.abort(); },
    drawObjects: () => assert.fail('Cancelled page must not be composed'),
  });
  await assert.rejects(feature.render([{}], { scale: 1, signal: abort.signal }, () => assert.fail('Cancelled page must not be consumed')), { name: 'AbortError' });
  assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
});

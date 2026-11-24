import { analyzeOcrVisualSelection } from '../../src/features/original-editor/ocr-visual-selection.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { FONT_CATALOG, fontCss, googleFontUrls, resolveEditablePdfFont } from '../../src/core/font-catalog.js';
import { createFontRegistry } from '../../src/adapters/pdf-lib-font-adapter.js';
import { readPdfiumFontName } from '../../src/adapters/pdfium-adapter.js';
import { isInvisiblePdfText, ocrPdfItemBounds, removeTextForReplacement } from '../../src/features/original-editor/ocr-text-editing.js';
import { analyzeOcrGlyph, assertOcrFontFit, composeOcrRasterEdit, ocrEditDiff, ocrMaskDistance, ocrRasterFrame, ocrRasterPoint,
  ocrRasterTransform, ocrSymbolsForText, opaqueOcrPatchImages, refineOcrGlyphBoxes } from '../../src/features/original-editor/ocr-raster-editing.js';

test('OCR edit regions include full line metrics and rotate with the PDF text matrix', () => {
  const style = { ascent: 1.16, descent: -.32 };
  assert.deepEqual(ocrPdfItemBounds({ transform: [20, 0, 0, 10, 50, 80], width: 200 }, style),
    [50, 76.8, 250, 91.6]);
  assert.deepEqual(ocrPdfItemBounds({ transform: [0, 20, -10, 0, 50, 80], width: 200 }, style),
    [38.4, 80, 53.2, 280]);
});

test('subset fonts without a name table are matched using the PDF BaseFont entry', () => {
  const bytes = new TextEncoder().encode('ABCDEF+NotoSansKR-Regular\0');
  const module = { HEAPU8: new Uint8Array(128), wasmExports: { malloc: () => 8, free() {} } };
  const family = readPdfiumFontName({
    FPDFFont_GetFamilyName: () => 1,
    FPDFFont_GetBaseFontName: (_, ptr) => { if (ptr) module.HEAPU8.set(bytes, ptr); return bytes.length; },
  }, module, 1);
  assert.equal(resolveEditablePdfFont(family, '한글').match, 'exact');
});

test('PDF font matching distinguishes real families, style suffixes, substitutes and OCR placeholders', () => {
  for (const name of ['ABCDEF+NotoSansKR-Regular', 'Noto Sans KR', 'NotoSansKR-Bold']) {
    const found = resolveEditablePdfFont(name, '한글 수정', { invisible: true });
    assert.equal(found.key, 'notosanskr');
    assert.equal(found.match, 'exact');
  }
  assert.equal(resolveEditablePdfFont('BlackHanSans-Regular', '한글').key, 'blackhansans');
  assert.equal(resolveEditablePdfFont('NanumGothicBold', '한글').match, 'exact');
  assert.equal(resolveEditablePdfFont('Arial', 'Hello').match, 'substitute');
  assert.equal(resolveEditablePdfFont('Roboto Slab', 'Hello').match, 'exact');
  assert.equal(resolveEditablePdfFont('Roboto', '새 한글').key, 'notosanskr');
  const ocr = resolveEditablePdfFont('ABCDEF+SpoqaHanSans', '한글 OCR', { invisible: true });
  assert.equal(ocr.key, 'notosanskr');
  assert.equal(ocr.match, 'substitute');
  assert.equal(ocr.synthetic, true);
  assert.equal(resolveEditablePdfFont('GlyphLessFont', 'English', { invisible: true }).key, 'roboto');
  assert.notEqual(resolveEditablePdfFont('UnknownFont', '한글').match, 'exact');
});

test('document font loading never sends document characters to Google in private mode, and reuses full fonts', async () => {
  const urls = [];
  class Face { async load() { return this; } }
  const registry = createFontRegistry({
    gfSha: 'pinned', fontCatalog: FONT_CATALOG, fontCss, googleFontUrls,
    documentTextSubsets: false,
    fetchFn: async url => { urls.push(url); return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }; },
    windowObject: { FontFace: Face }, documentObject: { fonts: { add() {} } }, FontFaceConstructor: Face,
  });
  await registry.ensureScreenFont('notosanskr', false, { characters: '민감한 문서 내용' });
  await registry.ensureScreenFont('notosanskr', false, { characters: '새로운 글자 추가' });
  const saved = await registry.fetchPdfFontRecord('notosanskr', false, '변경된 내용');
  assert.equal(saved.kind, 'full');
  assert.equal(urls.length, 1);
  assert.match(urls[0], /google\/fonts@pinned\/ofl\/notosanskr\//);
  assert.equal(new URL(urls[0]).search, '');
});

test('only non-painting text is treated as OCR', () => {
  assert.ok(isInvisiblePdfText({ renderMode: 3, alpha: 1 }));
  assert.ok(isInvisiblePdfText({ renderMode: 0, alpha: 0 }));
  assert.equal(isInvisiblePdfText({ renderMode: 7, alpha: 1 }), false);
  assert.equal(isInvisiblePdfText({ renderMode: 2, alpha: 0 }), false);
});

test('replacement removes only the obsolete searchable object, without a background rectangle', () => {
  const calls = [];
  const F = {
    FPDFPage_GetObject: () => 10, FPDFPageObj_GetType: () => 1,
    FPDFPageObj_CreateNewRect: (...args) => { calls.push(['rect', ...args]); return 20; },
    FPDFPageObj_SetFillColor: (...args) => { calls.push(['fill', ...args]); return 1; },
    FPDFPath_SetDrawMode: (...args) => { calls.push(['mode', ...args]); return 1; },
    FPDFPage_RemoveObject: (...args) => { calls.push(['remove', ...args]); return 1; },
    FPDFPageObj_Destroy: (...args) => calls.push(['destroy', ...args]),
    FPDFPage_InsertObject: (...args) => calls.push(['insert', ...args]),
  };
  removeTextForReplacement(F, 1, 2);
  assert.deepEqual(calls, [['remove', 1, 10], ['destroy', 10]]);
  calls.length = 0;
  assert.throws(() => removeTextForReplacement({ ...F, FPDFPage_RemoveObject: () => 0 }, 1, 2), /제거 실패/);
  assert.equal(calls.some(([operation]) => operation === 'destroy'), false);
});

test('OCR diffs retain unchanged Korean syllables, spaces and Unicode characters', () => {
  const original = '주소 서울 110', edited = '주소 서울 120';
  const diff = ocrEditDiff(original, edited);
  assert.equal(diff.filter(e => !e.same).length, 1);
  assert.equal(Array.from(original)[diff.find(e => !e.same).old], '1');
  assert.equal(ocrEditDiff('가😀나', '가😀다').filter(e => !e.same).length, 1);
  assert.ok(ocrEditDiff('가 나', '가 새 나').filter(e => e.same).every(e => e.old !== null));
  assert.throws(() => ocrEditDiff('a'.repeat(1001), 'b'), /1,000/);
});

test('ambiguous OCR symbol counts are rejected before touching source pixels', () => {
  const data = { blocks: [{ paragraphs: [{ lines: [{ words: [{ symbols: [
    { text: '가', bbox: { x0: 1, y0: 1, x1: 8, y1: 8 } },
    { text: '나', bbox: { x0: 10, y0: 1, x1: 18, y1: 8 } },
  ] }] }] }] }] };
  assert.deepEqual(ocrSymbolsForText('가 나', data).map(g => g.char), ['가', ' ', '나']);
  assert.throws(() => ocrSymbolsForText('가나다', data), { code: 'OCR_EDIT_UNAVAILABLE' });
  assert.throws(() => ocrSymbolsForText('가 다', data), { code: 'OCR_EDIT_UNAVAILABLE' });
  data.blocks[0].paragraphs[0].lines[0].words[0].symbols[0].confidence = 60;
  assert.throws(() => ocrSymbolsForText('가 나', data), { code: 'OCR_EDIT_UNAVAILABLE' });
  data.blocks[0].paragraphs[0].lines.push(data.blocks[0].paragraphs[0].lines[0]);
  assert.throws(() => ocrSymbolsForText('가나가나', data), { code: 'OCR_EDIT_UNAVAILABLE' });
});

test('OCR raster coordinates remain stable for rotated text and cropped PDF viewports', () => {
  const frame = ocrRasterFrame({ transform: [0, 20, -10, 0, 50, 80], width: 200 }, { ascent: 1, descent: -.2 }, [40, 80, 52, 280]);
  const viewport = [2, 0, 0, -2, -20, 400], transform = ocrRasterTransform(frame, viewport);
  for (const [x, y] of [[0, 0], [100, 24]]) {
    const pdf = ocrRasterPoint(frame, x, y), vx = viewport[0] * pdf[0] + viewport[4], vy = viewport[3] * pdf[1] + viewport[5];
    assert.ok(Math.abs(transform[0] * vx + transform[2] * vy + transform[4] - x) < .00001);
    assert.ok(Math.abs(transform[1] * vx + transform[3] * vy + transform[5] - y) < .00001);
  }
});

function gradientGlyph() {
  const width = 30, height = 30, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    data.set([180 + y, 210 + y, 220 + y, 255], (y * width + x) * 4);
  for (let y = 10; y < 20; y++) for (let x = 10; x < 15; x++) data.set([22, 52, 112, 255], (y * width + x) * 4);
  const image = { width, height, data };
  return { image, glyph: analyzeOcrGlyph(image, { char: 'A', bbox: { x0: 10, y0: 10, x1: 15, y1: 20 } }) };
}

test('ink colour is sampled per glyph and erasure follows the local gradient', () => {
  const { glyph } = gradientGlyph();
  assert.deepEqual(glyph.color, [22, 52, 112]);
  assert.equal(glyph.mask.reduce((a, b) => a + b), 126);  
  for (let y = 0; y < glyph.h; y++) for (let x = 0; x < glyph.w; x++)
    assert.equal(glyph.paper[(y * glyph.w + x) * 4], 180 + glyph.y0 + y);
});

test('nearby ink in paper samples is rejected instead of interpolated into vertical streaks', () => {
  for (const band of ['top', 'bottom', 'both']) {
    const { image, glyph } = gradientGlyph();
    const before = image.data.slice();
    for (const y0 of band === 'top' ? [4] : band === 'bottom' ? [23] : [4, 23])
      for (let y = y0; y < y0 + 3; y++) for (const x of [10, 11, 14, 15])
        image.data.set([15, 20, 25, 255], (y * image.width + x) * 4);
    const contaminated = image.data.slice();
    assert.throws(() => analyzeOcrGlyph(image, { char: 'A', bbox: glyph.bbox }), { code: 'OCR_EDIT_UNAVAILABLE' });
    assert.deepEqual(image.data, contaminated, 'rejected analysis must not alter source pixels');
    assert.notDeepEqual(contaminated, before);
  }
});

test('touching ink, clipped sample bands and indistinguishable text remain uneditable', () => {
  const { image, glyph } = gradientGlyph();
  for (let y = 10; y < 20; y++) image.data.set([15, 20, 25, 255], (y * image.width + 7) * 4);
  assert.throws(() => analyzeOcrGlyph(image, { char: 'A', bbox: glyph.bbox }), { code: 'OCR_EDIT_UNAVAILABLE' });
  assert.throws(() => analyzeOcrGlyph(image, { char: 'A', bbox: { x0: 10, x1: 15, y0: 3, y1: 20 } }), { code: 'OCR_EDIT_UNAVAILABLE' });
  const faint = gradientGlyph().image;
  for (let y = 10; y < 20; y++) for (let x = 10; x < 15; x++)
    faint.data.set([180 + y - 10, 210 + y - 10, 220 + y - 10, 255], (y * faint.width + x) * 4);
  assert.throws(() => analyzeOcrGlyph(faint, { char: 'A', bbox: glyph.bbox }), { code: 'OCR_EDIT_UNAVAILABLE' });
});

test('a best available font is still rejected if its fit is poor or one glyph is unreliable', () => {
  assert.doesNotThrow(() => assertOcrFontFit([.1, .2, .25]));
  for (const scores of [[], [.29, .31], [.1, .1, .5], [NaN], [Infinity]])
    assert.throws(() => assertOcrFontFit(scores), { code: 'OCR_EDIT_UNAVAILABLE' });
});

test('unchanged OCR glyphs produce a fully transparent patch, deletion paints only their ink', () => {
  const { image, glyph } = gradientGlyph();
  const factory = (width, height) => {
    const canvas = { width, height, pixels: null };
    canvas.getContext = () => ({ createImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) }),
      getImageData: () => ({ data: canvas.pixels }), putImageData: data => { canvas.pixels = data.data; } });
    return canvas;
  };
  const model = { image, glyphs: [{ ...glyph, origin: 10, advance: 8 }], text: 'A',
    match: { font: { unitsPerEm: 1000 } }, size: 10, baseline: 20, tracking: 0 };
  const same = composeOcrRasterEdit(model, 'A', factory);
  assert.ok(same.canvas.pixels.every(n => n === 0));
  const removed = composeOcrRasterEdit(model, '', factory);
  let changed = 0;
  for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) {
    const alpha = removed.canvas.pixels[(y * 30 + x) * 4 + 3];
    if (alpha) { changed++; assert.ok(x >= 7 && x < 18 && y >= 7 && y < 23); }
  }
  assert.equal(changed, 176);
});

test('visual font scoring favours matching ink over a different glyph shape', () => {
  const a = new Float32Array(1600), b = new Float32Array(1600);
  for (let y = 5; y < 35; y++) for (let x = 5; x < 10; x++) a[y * 40 + x] = 1;
  for (let y = 5; y < 10; y++) for (let x = 5; x < 35; x++) b[y * 40 + x] = 1;
  assert.equal(ocrMaskDistance(a, a), 0);
  assert.ok(ocrMaskDistance(a, b) > .7);
});

test('overlapping OCR digit boxes are refined to disjoint actual ink bounds', () => {
  const width = 80, height = 30, data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const start of [10, 25, 40]) for (let y = 10; y < 20; y++) for (let x = start; x < start + 5; x++)
    data.set([20, 30, 40, 255], (y * width + x) * 4);
  const font = { unitsPerEm: 1000, glyphForCodePoint: () => ({ advanceWidth: 300, bbox: { minX: 40, maxX: 140 } }) };
  const boxes = refineOcrGlyphBoxes({ text: '111', image: { data, width, height }, recognitionWidth: 60,
    glyphs: [{ bbox: { x0: 10, x1: 40 } }, { bbox: { x0: 20, x1: 45 } }, { bbox: { x0: 38, x1: 45 } }] }, font);
  assert.deepEqual(boxes.map(g => [g.bbox.x0, g.bbox.x1]), [[10, 15], [25, 30], [40, 45]]);
});

test('saved OCR patches are opaque and exclude intervening unchanged characters', () => {
  const width = 20, height = 10, original = new Uint8ClampedArray(width * height * 4).fill(245);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (const x of [3, 4, 14, 15]) for (let y = 3; y < 7; y++) pixels.set([30, 60, 100, 255], (y * width + x) * 4);
  const factory = (w, h) => {
    const canvas = { width: w, height: h };
    canvas.getContext = () => ({ createImageData: () => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: image => { canvas.pixels = image.data; } });
    return canvas;
  };
  const parts = opaqueOcrPatchImages({ image: { width, height, data: original } },
    { pixels: { data: pixels }, protectedBounds: [{ x0: 8, x1: 11, y0: 2, y1: 8 }] }, factory);
  assert.deepEqual(parts.map(p => [p.x, p.y, p.canvas.width, p.canvas.height]), [[3, 3, 2, 4], [14, 3, 2, 4]]);
  for (const part of parts) for (let i = 3; i < part.canvas.pixels.length; i += 4) assert.equal(part.canvas.pixels[i], 255);
});


test('OCR visual moves retain coloured ink without a font and remove paper from the sprite', () => {
  const width = 120, height = 60, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    data.set([232 + Math.round(x / 20), 240, 220, 255], (y * width + x) * 4);
  for (let y = 20; y < 38; y++) for (let x = 20; x < 90; x++) {
    if (x > 40 && x < 60) continue;
    data.set(x < 60 ? [15, 25, 35, 255] : [190, 20, 45, 255], (y * width + x) * 4);
  }
  const image = { width, height, data }, region = analyzeOcrVisualSelection(image, analyzeOcrGlyph);
  for (const [x, y] of [[25, 24], [70, 24]]) {
    const index = ((y - region.y0) * region.w + x - region.x0) * 4, alpha = region.sprite[index + 3] / 255;
    for (let c = 0; c < 3; c++) {
      const rendered = region.sprite[index + c] * alpha + region.paper[index + c] * (1 - alpha);
      assert.ok(Math.abs(rendered - data[(y * width + x) * 4 + c]) < 2);
    }
  }
  assert.equal(region.sprite[((25 - region.y0) * region.w + 50 - region.x0) * 4 + 3], 0);
  data.set([0, 0, 0, 255], (2 * width + 30) * 4);
  assert.throws(() => analyzeOcrVisualSelection(image, analyzeOcrGlyph), { code: 'OCR_EDIT_UNAVAILABLE' });
});

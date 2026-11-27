import { analyzeOcrGlyph } from '../features/original-editor/ocr-raster-editing.js';
import { isInvisiblePdfText, ocrPdfItemBounds } from '../features/original-editor/ocr-text-editing.js';

const compact = value => value.replace(/\s/g, '');
function overlap(a, b) {
  return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
    Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
}
const area = b => (b.x1 - b.x0) * (b.y1 - b.y0);
function bounds(points) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
export function scanNativeRegions(content, viewport, hidden) {
  const regions = [];
  for (const item of content.items) {
    if (!item.str?.trim()) continue;
    const rect = ocrPdfItemBounds(item, content.styles[item.fontName]);
    if (!rect) continue;
    const [x0, y0, x1, y1] = rect;
    const box = { x0, y0, x1, y1 };
    if (hidden.some(h => overlap(box, h.box) > .45 * Math.min(area(box), area(h.box)) &&
        (compact(item.str).includes(compact(h.text)) || compact(h.text).includes(compact(item.str))))) continue;
    regions.push(bounds([viewport.convertToViewportPoint(x0, y0), viewport.convertToViewportPoint(x1, y1)]));
  }
  return regions;
}

export function scanTextRuns(lines, native) {
  const result = [];
  for (const line of lines) {
    const words = line.words || [];
    if (!words.length) {
      if (!native.some(box => overlap(box, line.bbox) > .2 * area(line.bbox))) result.push(line);
      continue;
    }
    const text = line.text;
    const tokens = [...text.matchAll(/\S/gu)].map(m => m.index);
    const aligned = compact(text) === words.map(w => compact(w.text)).join('');
    let at = 0, group = [];
    function finish() {
      if (!group.length) return;
      const first = group[0], last = group.at(-1);
      const value = aligned ? text.slice(tokens[first.start], tokens[last.end] ?? text.length).trim()
        : group.map(w => w.word.text).join(' ');
      const bbox = bounds(group.flatMap(({ word: { bbox: b } }) => [[b.x0, b.y0], [b.x1, b.y1]]));
      const confidence = Math.min(...group.map(w => Number(w.word.confidence ?? 0)));
      result.push({ text: value, bbox, confidence, words: group.map(w => w.word) });
      group = [];
    }
    for (const word of words) {
      const start = at;
      at += [...compact(word.text)].length;
      const b = word.bbox, previous = group.at(-1)?.word.bbox;
      if (native.some(n => overlap(b, n) > .22 * area(b))) { finish(); continue; }
      if (previous && (b.x0 - previous.x1 > 1.4 * Math.max(b.y1 - b.y0, previous.y1 - previous.y0)
          || b.x0 < previous.x0)) finish();
      group.push({ word, start, end: at });
    }
    finish();
  }
  return result;
}

export function matchPreviousOcr(lines, hidden, reuseText) {
  const replacements = new Set(), blocked = new Set();
  for (const object of hidden) {
    const hits = lines.filter(l => overlap(l.pdfBox, object.box) > .24 * Math.min(area(l.pdfBox), area(object.box)));
    const coverage = hits.reduce((sum, l) => sum + overlap(l.pdfBox, object.box), 0);
    if (hits.length && coverage >= .48 * area(object.box)) replacements.add(object.index);
    else for (const line of hits) blocked.add(line);
  }
  // Keep both sides of an ambiguous match together.
  let changed;
  do {
    changed = false;
    for (const object of hidden) {
      if (!replacements.has(object.index)) continue;
      const touches = line => overlap(line.pdfBox, object.box) > .24 * Math.min(area(line.pdfBox), area(object.box));
      if (![...blocked].some(touches)) continue;
      replacements.delete(object.index);
      for (const line of lines.filter(touches)) blocked.add(line);
      changed = true;
    }
  } while (changed);
  const accepted = lines.filter(line => !blocked.has(line));
  const owners = hidden.filter(o => replacements.has(o.index));
  function matches(line, obj) { return overlap(line.pdfBox, obj.box) > .24 * Math.min(area(line.pdfBox), area(obj.box)); }
  const corrected = reuseText ? accepted.map(line => {
    const found = owners.filter(o => matches(line, o));
    if (found.length !== 1 || accepted.some(other => other !== line && matches(other, found[0]))) return line;
    return { ...line, text: found[0].text };
  }) : accepted;
  return { lines: corrected, remove: [...replacements] };
}

export function scanAppearance(canvas, box, viewport) {
  const x = Math.max(0, Math.floor(box.x0) - 8), y = Math.max(0, Math.floor(box.y0) - 8);
  const w = Math.min(canvas.width - x, Math.ceil(box.x1) + 8 - x);
  const h = Math.min(canvas.height - y, Math.ceil(box.y1) + 8 - y);
  if (w < 4 || h < 4 || w * h > 1500000) return null;
  const image = canvas.getContext('2d').getImageData(x, y, w, h);
  let patch;
  try {
    patch = analyzeOcrGlyph(image, { bbox: { x0: box.x0 - x, y0: box.y0 - y, x1: box.x1 - x, y1: box.y1 - y } });
  } catch (e) { if (e.code === 'OCR_EDIT_UNAVAILABLE') return null; throw e; }
  let inkPixels = 0, mismatches = 0;
  let minX = patch.w, minY = patch.h, maxX = 0, maxY = 0;
  for (let row = 0; row < patch.h; row++) {
    let streak = 0;
    for (let col = 0; col < patch.w; col++) {
      const i = 4 * (row * patch.w + col), alpha = patch.sprite[i + 3] / 255;
      if (alpha < .3) { streak = 0; continue; }
      if (++streak >= Math.max(3 * patch.h, patch.w * .8)) return null;
      const src = 4 * ((patch.y0 + row) * image.width + patch.x0 + col);
      inkPixels++;
      minX = Math.min(minX, col); maxX = Math.max(maxX, col + 1);
      minY = Math.min(minY, row); maxY = row + 1;
      if (patch.color.some((v, c) => Math.abs(image.data[src + c] - (v * alpha + patch.paper[i+c] * (1-alpha))) > 32)) mismatches++;
    }
  }
  if (!inkPixels || mismatches > Math.max(4, inkPixels * .06)) return null;
  const left = x + patch.x0, top = y + patch.y0;
  const ink = {
    origin: viewport.convertToPdfPoint(left + minX, top + maxY),
    right: viewport.convertToPdfPoint(left + maxX, top + maxY),
    top: viewport.convertToPdfPoint(left + minX, top + minY),
  };
  const origin = viewport.convertToPdfPoint(left, top + patch.h);
  const right = viewport.convertToPdfPoint(left + patch.w, top + patch.h);
  const up = viewport.convertToPdfPoint(left, top);
  const matrix = [right[0] - origin[0], right[1] - origin[1], up[0] - origin[0], up[1] - origin[1], ...origin];
  const paper = [...patch.paper.slice(0, 3)];
  const flat = patch.paper.every((v, i) => i % 4 === 3 || Math.abs(v - paper[i % 4]) <= 1);
  if (flat) return { matrix, ink, color: patch.color, paper };
  const tile = document.createElement('canvas'); tile.width = patch.w; tile.height = patch.h;
  const ctx = tile.getContext('2d'), pixels = ctx.createImageData(patch.w, patch.h);
  for (let i = 0; i < patch.mask.length; i++) if (patch.mask[i]) pixels.data.set(patch.paper.subarray(i * 4, i * 4 + 4), i * 4);
  ctx.putImageData(pixels, 0, 0);
  const png = tile.toDataURL('image/png');
  tile.width = tile.height = 1;
  return { matrix, ink, color: patch.color, png };
}

export async function inspectHiddenOcr(bytes, withDocument, selection, context) {
  if (!withDocument) return [];
  return withDocument(bytes, async (F, M, doc) => {
    const result = [], ptr = M.wasmExports.malloc(16);
    try {
      for (let p = 0; p < F.FPDF_GetPageCount(doc); p++) {
        if (selection && !selection.has(p)) { result.push([]); continue; }
        if (p && p % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        context?.throwIfCancelled();
        const page = F.FPDF_LoadPage(doc, p);
        if (!page) throw new Error('OCR 페이지를 열 수 없습니다.');
        const hidden = []; let textPage = 0;
        try {
          for (let i = 0; i < F.FPDFPage_CountObjects(page); i++) {
            const obj = F.FPDFPage_GetObject(page, i);
            if (F.FPDFPageObj_GetType(obj) !== 1) continue;
            const renderMode = F.FPDFTextObj_GetTextRenderMode(obj);
            const alpha = F.FPDFPageObj_GetFillColor(obj, ptr, ptr+4, ptr+8, ptr+12) ? new Uint32Array(M.HEAPU8.buffer, ptr, 4)[3] : 255;
            if (!isInvisiblePdfText({ renderMode, alpha }) || !F.FPDFPageObj_GetBounds(obj, ptr, ptr+4, ptr+8, ptr+12)) continue;
            const [x0,y0,x1,y1] = new Float32Array(M.HEAPU8.buffer,ptr,4);
            textPage ||= F.FPDFText_LoadPage(page);
            const len = F.FPDFTextObj_GetText(obj, textPage, 0, 0);
            if (len <= 2) continue;
            const buffer = M.wasmExports.malloc(len);
            try {
              F.FPDFTextObj_GetText(obj, textPage, buffer, len);
              const text = new TextDecoder('utf-16le').decode(M.HEAPU8.slice(buffer,buffer+len)).replace(/\0+$/, '');
              if (text.trim() && x1 > x0 && y1 > y0) hidden.push({ index:i, text, box:{ x0,y0,x1,y1 } });
            } finally { M.wasmExports.free(buffer); }
          }
        } finally { if (textPage) F.FPDFText_ClosePage(textPage); F.FPDF_ClosePage(page); }
        result.push(hidden);
      }
    } finally { M.wasmExports.free(ptr); }
    return result;
  });
}

export async function removeReplacedOcr(bytes, pages, withDocument) {
  if (!pages.some(p => p.remove?.length)) return bytes;
  return withDocument(bytes, (F, M, doc) => {
    for (const p of pages.filter(p => p.remove?.length)) {
      const page = F.FPDF_LoadPage(doc, p.index);
      try {
        for (const i of [...p.remove].sort((a,b) => b-a)) {
          const obj = F.FPDFPage_GetObject(page, i);
          if (!obj || F.FPDFPageObj_GetType(obj) !== 1 || !F.FPDFPage_RemoveObject(page, obj))
            throw new Error('기존 OCR 텍스트를 교체하지 못했습니다.');
          F.FPDFPageObj_Destroy(obj);
        }
        if (p.replaceAt !== undefined) {
          const last = F.FPDFPage_CountObjects(page) - 1, replacement = F.FPDFPage_GetObject(page, last);
          if (F.FPDFPageObj_GetType(replacement) !== 1 || F.FPDFTextObj_GetTextRenderMode(replacement) !== 3)
            throw new Error('교정할 검색 글자를 확인하지 못했습니다.');
          if (last !== p.replaceAt && (!F.FPDFPage_RemoveObject(page, replacement) ||
              !F.FPDFPage_InsertObjectAtIndex(page, replacement, p.replaceAt))) throw new Error('검색 글자 순서를 유지하지 못했습니다.');
        }
        if (!F.FPDFPage_GenerateContent(page)) throw new Error('OCR 페이지를 저장하지 못했습니다.');
      } finally { F.FPDF_ClosePage(page); }
    }
    const writer = F.PDFiumExt_OpenFileWriter(); let buffer = 0;
    try {
      if (!F.PDFiumExt_SaveAsCopy(doc, writer)) throw new Error('OCR 사본을 저장하지 못했습니다.');
      const size = F.PDFiumExt_GetFileWriterSize(writer);
      buffer = M.wasmExports.malloc(size);
      F.PDFiumExt_GetFileWriterData(writer, buffer, size);
      return M.HEAPU8.slice(buffer, buffer+size);
    } finally { if (buffer) M.wasmExports.free(buffer); F.PDFiumExt_CloseFileWriter(writer); }
  });
}

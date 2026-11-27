import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream,
  beginText, decodePDFRawStream, endText, popGraphicsState, pushGraphicsState,
  setFontAndSize, setTextMatrix, setTextRenderingMode, showText, TextRenderingMode,
  concatTransformationMatrix, drawObject, fill, rectangle, setFillingRgbColor,
} from 'pdf-lib';
import { parseRange } from '../core/range.js';
import { ruledTableLayout, restoreTableLines, tableReadingOrder } from './ocr-table-layout.js';
import { inspectHiddenOcr, removeReplacedOcr, scanAppearance, scanNativeRegions, scanTextRuns, matchPreviousOcr } from './ocr-scan-layout.js';
import { getPdfJs, openPdfJs, readFileBytes } from './pdf-task-runtime.js';

export const OCR_ASSETS = Object.freeze({
  library: '/assets/ocr/tesseract.esm.min.js',
  worker: '/assets/ocr/worker.min.js',
  coreSimd: '/assets/ocr/core/tesseract-core-simd-lstm.wasm.js',
  coreBase: '/assets/ocr/core/tesseract-core-lstm.wasm.js',
  languages: '/assets/ocr/tessdata_best',
  koreanFont: '/assets/ocr/SpoqaHanSansRegular.ttf',
});

export const OCR_QUALITY = Object.freeze({
  high: Object.freeze({ dpi: 300, maxPixels: 18_000_000, imageDpi: 160, imageQuality: .9 }),
  balanced: Object.freeze({ dpi: 240, maxPixels: 12_000_000, imageDpi: 144, imageQuality: .86 }),
  fast: Object.freeze({ dpi: 180, maxPixels: 8_000_000, imageDpi: 120, imageQuality: .8 }),
});

const checkedProfile = quality => OCR_QUALITY[quality] || OCR_QUALITY.balanced;
const normalizeSpace = value => String(value || '').replace(/[\t ]+/g, ' ').trim();

export function shouldUseOcr(text, minimumCharacters = 12) {
  return String(text || '').replace(/\s/g, '').length < minimumCharacters;
}

export function groupPdfTextItems(items = []) {
  const positioned = items
    .filter(item => item?.str && Array.isArray(item.transform))
    .map(item => ({
      text: normalizeSpace(item.str),
      x: Number(item.transform[4]) || 0,
      y: Number(item.transform[5]) || 0,
      width: Math.abs(Number(item.width) || 0),
      height: Math.max(1, Math.abs(Number(item.height) || Number(item.transform[3]) || 10)),
    }))
    .filter(item => item.text);
  positioned.sort((a, b) => Math.abs(b.y - a.y) > Math.max(a.height, b.height) * .45
    ? b.y - a.y
    : a.x - b.x);
  const lines = [];
  for (const item of positioned) {
    const threshold = Math.max(3, item.height * .55);
    let line = lines.find(candidate => Math.abs(candidate.y - item.y) <= threshold);
    if (!line) {
      line = { y: item.y, height: item.height, items: [] };
      lines.push(line);
    }
    line.items.push(item);
    line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length;
    line.height = Math.max(line.height, item.height);
  }
  lines.sort((a, b) => b.y - a.y);
  return lines.map(line => {
    line.items.sort((a, b) => a.x - b.x);
    const chunks = [];
    let right = null;
    for (const item of line.items) {
      if (right !== null && item.x - right > Math.max(3, item.height * .38)) chunks.push(' ');
      chunks.push(item.text);
      right = Math.max(right ?? item.x, item.x + item.width);
    }
    return Object.freeze({ text: normalizeSpace(chunks.join('')), items: Object.freeze(line.items) });
  }).filter(line => line.text);
}

export function parseTsvWords(tsv = '') {
  const rows = String(tsv || '').split(/\r?\n/);
  const words = [];
  for (const row of rows.slice(1)) {
    const columns = row.split('\t');
    if (columns.length < 12 || columns[0] !== '5') continue;
    const text = normalizeSpace(columns.slice(11).join('\t'));
    if (!text) continue;
    const left = Number(columns[6]);
    const top = Number(columns[7]);
    const width = Number(columns[8]);
    const height = Number(columns[9]);
    const confidence = Number(columns[10]);
    if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    words.push(Object.freeze({
      text,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      lineKey: columns.slice(1, 5).join(':'),
      bbox: Object.freeze({ x0: left, y0: top, x1: left + width, y1: top + height }),
    }));
  }
  return words;
}

const validBox = box => box && ['x0', 'y0', 'x1', 'y1'].every(key => Number.isFinite(box[key]))
  && box.x1 > box.x0 && box.y1 > box.y0;

const unionBoxes = words => ({
  x0: Math.min(...words.map(word => word.bbox.x0)),
  y0: Math.min(...words.map(word => word.bbox.y0)),
  x1: Math.max(...words.map(word => word.bbox.x1)),
  y1: Math.max(...words.map(word => word.bbox.y1)),
});

export function getOcrTextLines(data = {}) {
  const blockLines = (data.blocks || []).flatMap(block => (block.paragraphs || [])
    .flatMap(paragraph => paragraph.lines || []));
  const lines = blockLines.map(line => {
    const words = (line.words || []).filter(word => word.text && validBox(word.bbox));
    return { text: normalizeSpace(line.text), bbox: validBox(line.bbox) ? line.bbox : words.length ? unionBoxes(words) : null, words };
  }).filter(line => line.text && validBox(line.bbox));
  if (lines.length) return lines;

  const groups = new Map();
  for (const word of parseTsvWords(data.tsv)) {
    if (!groups.has(word.lineKey)) groups.set(word.lineKey, []);
    groups.get(word.lineKey).push(word);
  }
  const textLines = String(data.text || '').split(/\r?\n/).map(normalizeSpace).filter(Boolean);
  const compact = text => text.replace(/\s/g, '');
  const used = new Set();
  for (const words of groups.values()) {
    const value = words.map(word => word.text).join('');
    const match = textLines.findIndex((text, index) => !used.has(index) && compact(text) === compact(value));
    if (match < 0) throw new Error('OCR 줄 구조를 확인할 수 없습니다. 원본 PDF로 다시 시도하세요.');
    used.add(match);
    lines.push({ text: textLines[match], bbox: unionBoxes(words), words });
  }
  return lines;
}

const OCR_LAYER = PDFName.of('DaydayPDFOCRText');

function isLegacyOcrStream(stream, resources) {
  if (!(stream instanceof PDFRawStream)) return false;
  let text;
  try { text = new TextDecoder().decode(decodePDFRawStream(stream).decode()); }
  catch { return false; }
  const number = '-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
  const chunk = new RegExp(`q\\s+/(GS-[0-9]+)\\s+gs\\s+BT\\s+1 1 1 rg\\s+/SpoqaHanSans-Regular-[0-9]+ ${number} Tf\\s+${number} TL\\s+1 0 0 1 ${number} ${number} Tm\\s+<[0-9A-Fa-f]+> Tj\\s+T\\*\\s+ET\\s+Q`, 'g');
  const matches = [...text.matchAll(chunk)];
  if (!matches.length || text.replace(chunk, '').trim()) return false;
  const states = resources?.lookupMaybe(PDFName.of('ExtGState'), PDFDict);
  return matches.every(match => states?.lookupMaybe(PDFName.of(match[1]), PDFDict)
    ?.lookupMaybe(PDFName.of('ca'), PDFNumber)?.asNumber() === 0);
}

export async function prepareOcrSource(sourceBytes, { forceOcr = false } = {}) {
  const document = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  const legacy = document.getProducer() === 'DaydayPDF OCR';
  let changed = false;
  for (const page of document.getPages()) {
    const contents = page.node.Contents();
    if (!(contents instanceof PDFArray)) continue;
    const ownedLayer = forceOcr ? page.node.get(OCR_LAYER) : null;
    for (let index = contents.size() - 1; index >= 0; index--) {
      const entry = contents.get(index);
      if ((ownedLayer && entry === ownedLayer)
          || (legacy && isLegacyOcrStream(document.context.lookup(entry), page.node.Resources()))) {
        contents.remove(index);
        changed = true;
      }
    }
    if (ownedLayer) page.node.delete(OCR_LAYER);
  }
  return changed ? new Uint8Array(await document.save()) : sourceBytes;
}

export function autoContrastGrayscale(canvas) {
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const histogram = new Uint32Array(256);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const level = Math.round(image.data[offset] * .2126 + image.data[offset + 1] * .7152 + image.data[offset + 2] * .0722);
    histogram[level] += 1;
  }
  const total = canvas.width * canvas.height;
  const percentile = fraction => {
    const target = total * fraction;
    let count = 0;
    for (let index = 0; index < histogram.length; index++) {
      count += histogram[index];
      if (count >= target) return index;
    }
    return 255;
  };
  const percentileLow = percentile(.01);
  const high = percentile(.99);
  const low = high - percentileLow >= 32 ? percentileLow : 0;
  const spread = high - percentileLow >= 32 ? high - low : 255;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const level = image.data[offset] * .2126 + image.data[offset + 1] * .7152 + image.data[offset + 2] * .0722;
    const adjusted = Math.max(0, Math.min(255, Math.round((level - low) * 255 / spread)));
    image.data[offset] = adjusted;
    image.data[offset + 1] = adjusted;
    image.data[offset + 2] = adjusted;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return ruledTableLayout(image);
}

async function canvasImage(canvas, quality) {
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    result => result ? resolve(result) : reject(new Error('페이지 이미지를 만들 수 없습니다')),
    'image/jpeg', quality,
  ));
  return Object.freeze({
    bytes: new Uint8Array(await blob.arrayBuffer()),
    type: 'image/jpeg',
    width: canvas.width,
    height: canvas.height,
  });
}

async function renderPageCanvas(page, dpi, maxPixels, omitAnnotations) {
  const base = page.getViewport({ scale: 1 });
  let scale = dpi / 72;
  const pixelCount = base.width * base.height * scale * scale;
  if (pixelCount > maxPixels) scale *= Math.sqrt(maxPixels / pixelCount);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) throw new Error('OCR Canvas를 만들 수 없습니다');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, ...(omitAnnotations ? { annotationMode: 0 } : {}) }).promise;
  return { canvas, viewport };
}

export function mapOcrLinesToPdf(lines, viewport) {
  return lines.map(word => {
    const corners = [
      viewport.convertToPdfPoint(word.bbox.x0, word.bbox.y0),
      viewport.convertToPdfPoint(word.bbox.x1, word.bbox.y0),
      viewport.convertToPdfPoint(word.bbox.x0, word.bbox.y1),
      viewport.convertToPdfPoint(word.bbox.x1, word.bbox.y1),
    ];
    const xs = corners.map(point => point[0]);
    const ys = corners.map(point => point[1]);
    return Object.freeze({
      ...word,
      pdfOrigin: viewport.convertToPdfPoint(word.bbox.x0, word.bbox.y1),
      pdfRight: viewport.convertToPdfPoint(word.bbox.x1, word.bbox.y1),
      pdfTop: viewport.convertToPdfPoint(word.bbox.x0, word.bbox.y0),
      pdfBox: Object.freeze({
        x0: Math.min(...xs), y0: Math.min(...ys),
        x1: Math.max(...xs), y1: Math.max(...ys),
      }),
    });
  });
}

function languageCodes(language) {
  if (language === 'kor') return ['kor'];
  if (language === 'eng') return ['eng'];
  return ['kor', 'eng'];
}

async function createOcrWorker(language, onLog, fastTable) {
  const module = await import(OCR_ASSETS.library);
  const library = module.default || module;
  let worker;
  let lastError;
  for (const corePath of [OCR_ASSETS.coreSimd, OCR_ASSETS.coreBase]) {
    try {
      worker = await library.createWorker(languageCodes(language), library.OEM.LSTM_ONLY, {
        workerPath: OCR_ASSETS.worker,
        corePath,
        langPath: fastTable ? '/assets/ocr/tessdata_fast' : OCR_ASSETS.languages,
        ...(fastTable ? { cachePath: 'tessdata_fast_v1' } : {}),
        gzip: true,
        logger: message => onLog?.(message),
      });
      break;
    } catch (error) {
      lastError = error;
      console.warn(`[DaydayPDF:ocr] ${corePath} 초기화 실패`, error);
    }
  }
  if (!worker) throw lastError || new Error('OCR 엔진을 초기화할 수 없습니다');
  await worker.setParameters({
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
    tessedit_pageseg_mode: String(library.PSM.AUTO),
  });
  return worker;
}

export async function recognizeOcrPage(worker, canvas, context = null) {
  const options = { rotateAuto: false };
  const outputs = { text: true, blocks: true, tsv: true };
  await worker.setParameters({ tessedit_pageseg_mode: '3' });
  const first = await worker.recognize(canvas, options, outputs);
  const lines = getOcrTextLines(first.data);
  const length = lines.reduce((sum, line) => sum + line.text.replace(/\s/g, '').length, 0);
  if (lines.length > 2 || length >= 120) return first;
  context?.throwIfCancelled();
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    const retry = await worker.recognize(canvas, options, outputs);
    const retryLength = getOcrTextLines(retry.data)
      .reduce((sum, line) => sum + line.text.replace(/\s/g, '').length, 0);
    const confidenceFloor = Math.max(65, (Number(first.data.confidence) || 0) - 10);
    if (retryLength >= length + 12 && Number(retry.data.confidence) >= confidenceFloor) return retry;
  } catch {
    context?.throwIfCancelled();
  }
  return first;
}

async function recognizeTable(canvas, layout, fast, getWorker, context) {
  const scale = fast ? layout.scale : 1;
  const width = Math.round(canvas.width * scale), height = Math.round(canvas.height * scale);
  const parallel = fast && layout.split && navigator.hardwareConcurrency >= 4 &&
    (navigator.deviceMemory ?? 4) >= 4 && width * height <= 4000000;
  const read = async index => {
    const worker = await getWorker(index);
    context?.throwIfCancelled();
    let input = canvas;
    if (scale !== 1 || parallel) {
      input = document.createElement('canvas');
      input.width = width;
      input.height = height;
      const ctx = input.getContext('2d');
      ctx.drawImage(canvas, 0, 0, width, height);
      if (parallel) {
        const split = Math.round(layout.split * width / canvas.width);
        const top = Math.round(layout.top * height / canvas.height);
        const bottom = Math.round(layout.bottom * height / canvas.height);
        ctx.fillStyle = '#fff';
        if (index === 0) ctx.fillRect(split, top, width - split, bottom - top);
        else {
          ctx.fillRect(0, 0, width, top);
          ctx.fillRect(0, bottom, width, height - bottom);
          ctx.fillRect(0, top, split, bottom - top);
        }
      }
    }
    try {
      await worker.setParameters({ tessedit_pageseg_mode: '11' });
      const { data } = await worker.recognize(input, { rotateAuto: false }, { text: true, blocks: true });
      const lines = restoreTableLines(getOcrTextLines(data), canvas.width / width, canvas.height / height);
      if (!lines.length && data.text?.trim()) throw new Error('인식한 글자의 위치를 확인할 수 없습니다.');
      return { lines, confidence: data.confidence };
    } finally { if (input !== canvas) input.width = input.height = 1; }
  };
  if (!parallel) return read(0);
  const results = await Promise.allSettled([read(0), read(1)]);
  const failure = results.find(r => r.status === 'rejected');
  if (failure) throw failure.reason;
  const [left, right] = results.map(r => r.value);
  const above = left.lines.filter(l => l.bbox.y1 <= layout.top);
  const below = left.lines.filter(l => l.bbox.y0 >= layout.bottom);
  const body = left.lines.filter(l => l.bbox.y1 > layout.top && l.bbox.y0 < layout.bottom);
  return { lines: [...above, ...tableReadingOrder(body.concat(right.lines)), ...below],
    confidence: Math.min(left.confidence, right.confidence) };
}

export async function analyzePdfForDocuments(file, {
  language = 'kor+eng',
  quality = 'balanced',
  forceOcr = false,
  includePageImages = false, pdfMode, pageRange = '', reviewPage, withDocument,
  report = () => {},
  context = null,
} = {}) {
  const profile = checkedProfile(quality);
  const inputBytes = await readFileBytes(file);
  const bytes = pdfMode ? inputBytes : await prepareOcrSource(inputBytes, { forceOcr });
  const pdf = await openPdfJs(bytes);
  const workers = new Map();
  let fastModel = false;
  async function releaseWorkers() {
    const pending = [...workers.values()];
    workers.clear();
    await Promise.allSettled(pending.map(async task => (await task).terminate()));
  }
  context?.addDisposer(releaseWorkers);
  const pages = [];
  let hiddenPages, skipReview = false;
  let lastWorkerRatio = 0;
  const workerLog = message => {
    if (!message || !Number.isFinite(message.progress)) return;
    lastWorkerRatio = message.progress;
  };
  try {
    const selected = pageRange.trim() ? parseRange(pageRange, pdf.numPages) : null;
    if (pageRange.trim() && !selected) throw new Error('인식할 페이지 범위를 확인하세요.');
    const selection = selected && new Set(selected);
    for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
      if (selection && !selection.has(pageIndex)) continue;
      context?.throwIfCancelled();
      const page = await pdf.getPage(pageIndex + 1);
      const baseProgress = pageIndex / pdf.numPages;
      const textContent = await page.getTextContent({ disableNormalization: false });
      const nativeLines = groupPdfTextItems(textContent.items);
      const nativeText = nativeLines.map(line => line.text).join('\n');
      let needsOcr = forceOcr || shouldUseOcr(nativeText);
      let hidden = [], remove = [];
      if (pdfMode && nativeText) {
        if (pdfMode === 'editable' || forceOcr || reviewPage) {
          hiddenPages ||= await inspectHiddenOcr(bytes, withDocument, selection, context);
          hidden = hiddenPages[pageIndex] || [];
          if (hidden.length) needsOcr = true;
        }
        if (!needsOcr && pdfMode === 'editable') {
          const { OPS } = await getPdfJs();
          const ops = await page.getOperatorList({ annotationMode: 0 });
          needsOcr = ops.fnArray.some(op => op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject);
        }
      }
      let lines = nativeLines;
      let text = nativeText;
      let words = [];
      let confidence = nativeText ? 100 : 0;
      let image = null;
      let rendered = null;
      if (needsOcr || includePageImages) {
        const renderDpi = needsOcr ? profile.dpi : profile.imageDpi;
        rendered = await renderPageCanvas(page, renderDpi, profile.maxPixels, !!pdfMode);
        if (includePageImages) image = await canvasImage(rendered.canvas, profile.imageQuality);
      }
      if (needsOcr) {
        const original = rendered.canvas;
        let recognition = original;
        if (pdfMode === 'editable' || reviewPage) {
          recognition = document.createElement('canvas');
          recognition.width = original.width; recognition.height = original.height;
          recognition.getContext('2d', { willReadFrequently: true }).drawImage(original, 0, 0);
        }
        let rawLines;
        try {
          const layout = autoContrastGrayscale(recognition);
          const fast = !!layout && quality !== 'high';
          if (fast !== fastModel) { await releaseWorkers(); fastModel = fast; }
          function getWorker(index) {
            context?.throwIfCancelled();
            if (!workers.has(index)) {
              report(baseProgress, '한국어·영어 OCR 엔진 준비 중');
              workers.set(index, createOcrWorker(language, workerLog, fast));
            }
            return workers.get(index);
          }
          lastWorkerRatio = 0;
          if (layout) {
            ({ lines: rawLines, confidence } = await recognizeTable(recognition, layout, fast, getWorker, context));
          } else {
            const worker = await getWorker(0);
            context?.throwIfCancelled();
            const { data } = await recognizeOcrPage(worker, recognition, context);
            rawLines = getOcrTextLines(data);
            if (!rawLines.length && data.text?.trim()) throw new Error('인식한 글자의 위치를 확인할 수 없습니다.');
            confidence = Number(data.confidence) || 0;
          }
        } finally { if (recognition !== original) recognition.width = recognition.height = 1; }
        const runs = pdfMode ? scanTextRuns(rawLines, scanNativeRegions(textContent, rendered.viewport, hidden)) : rawLines;
        lines = mapOcrLinesToPdf(runs, rendered.viewport);
        if (pdfMode) {
          ({ lines, remove } = matchPreviousOcr(lines, hidden, !forceOcr));
          lines = lines.map(line => ({ ...line, text: line.text.normalize('NFC'), words: [],
            appearance: pdfMode === 'editable' ? scanAppearance(original, line.bbox, rendered.viewport) : null }));
          if (reviewPage && lines.length && !skipReview) {
            const review = await reviewPage({ pageNumber: pageIndex + 1, lines, canvas: original });
            context?.throwIfCancelled();
            lines = lines.map((line, i) => ({ ...line, text: review.texts[i] }));
            skipReview = review.skipRemaining;
          }
        }
        text = lines.map(line => line.text).join('\n');
        words = lines.flatMap(line => line.words || []);
      }
      pages.push(Object.freeze({
        index: pageIndex,
        width: page.getViewport({ scale: 1 }).width,
        height: page.getViewport({ scale: 1 }).height,
        text,
        lines: Object.freeze(lines),
        words: Object.freeze(words),
        confidence,
        ocrApplied: needsOcr,
        remove,
        image,
      }));
      if (rendered) {
        rendered.canvas.width = 1;
        rendered.canvas.height = 1;
      }
      page.cleanup();
      report((pageIndex + Math.max(.15, lastWorkerRatio * .8) + .05) / pdf.numPages,
        `${pageIndex + 1}/${pdf.numPages}페이지 ${needsOcr ? '문자 인식' : '텍스트 확인'} 완료`);
    }
    const cleaned = pdfMode ? await removeReplacedOcr(bytes, pages, withDocument) : bytes;
    return Object.freeze({ bytes: cleaned, pages: Object.freeze(pages), pageCount: pdf.numPages });
  } finally {
    await releaseWorkers();
    try { await pdf.loadingTask.destroy(); } catch {}
  }
}

async function fetchBytes(path, label) {
  const response = await fetch(path, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`${label} 파일을 불러올 수 없습니다 (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

function visibleTextMatrix(face, text, origin, right, top) {
  const { glyphs } = face.layout(text);
  let left = Infinity, bottom = Infinity, r = -Infinity, upper = -Infinity, x = 0;
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i], box = g.bbox;
    if (box.maxX > box.minX && box.maxY > box.minY) {
      left = Math.min(left, x + box.minX); r = Math.max(r, x + box.maxX);
      bottom = Math.min(bottom, box.minY); upper = Math.max(upper, box.maxY);
    }
    x += g.advanceWidth;
  }
  if (!(r > left && upper > bottom)) return null;
  const ax = (right[0] - origin[0]) / (r - left), ay = (right[1] - origin[1]) / (r - left);
  const bx = (top[0] - origin[0]) / (upper - bottom), by = (top[1] - origin[1]) / (upper - bottom);
  return [ax * face.unitsPerEm, ay * face.unitsPerEm, bx * face.unitsPerEm, by * face.unitsPerEm,
    origin[0] - ax * left - bx * bottom, origin[1] - ay * left - by * bottom];
}

export async function createSearchablePdf(sourceBytes, pages, { report = () => {}, editable = false } = {}) {
  const ocrPages = pages.filter(page => page.ocrApplied && page.lines?.some(line => validBox(line.pdfBox)));
  if (!ocrPages.length) return sourceBytes.slice();
  const [{ default: fontkit }, fontBytes] = await Promise.all([
    import('@pdf-lib/fontkit'),
    fetchBytes(OCR_ASSETS.koreanFont, 'OCR 한글 글꼴'),
  ]);
  const document = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  document.registerFontkit(fontkit);
  const font = await document.embedFont(fontBytes, { subset: !editable });
  const face = editable ? fontkit.create(fontBytes) : null;
  for (let index = 0; index < ocrPages.length; index++) {
    const pageResult = ocrPages[index];
    const page = document.getPage(pageResult.index);
    const fontName = page.node.newFontDictionary('DaydayOCR', font.ref);
    const operators = [pushGraphicsState()];
    for (const line of pageResult.lines) {
      if (!validBox(line.pdfBox)) continue;
      const patch = line.appearance;
      if (patch) {
        operators.push(pushGraphicsState(), concatTransformationMatrix(...patch.matrix));
        if (patch.paper) operators.push(setFillingRgbColor(...patch.paper.map(v => v / 255)), rectangle(0, 0, 1, 1), fill());
        else {
          const background = await document.embedPng(patch.png);
          operators.push(drawObject(page.node.newXObject('OCRPaper', background.ref)));
        }
        operators.push(popGraphicsState());
      }
      if (!line.text) continue;
      const box = line.pdfBox;
      const origin = line.pdfOrigin || [box.x0, box.y0];
      const right = line.pdfRight || [box.x1, box.y0];
      const top = line.pdfTop || [box.x0, box.y1];
      const height = Math.hypot(top[0] - origin[0], top[1] - origin[1]);
      if (patch && face) {
        const matrix = visibleTextMatrix(face, line.text, patch.ink.origin, patch.ink.right, patch.ink.top);
        if (matrix) {
          const size = Math.hypot(matrix[2], matrix[3]);
          const [a,b,c,d,x,y] = matrix;
          operators.push(beginText(), setTextRenderingMode(TextRenderingMode.Fill), setFillingRgbColor(...patch.color.map(v => v / 255)),
            setFontAndSize(fontName, size), setTextMatrix(a/size,b/size,c/size,d/size,x,y), showText(font.encodeText(line.text)), endText());
          continue;
        }
      }
      const size = height / font.heightAtSize(1);
      const textWidth = font.widthOfTextAtSize(line.text, size);
      if (!Number.isFinite(textWidth) || textWidth <= 0) continue;
      const descent = font.heightAtSize(size) - font.heightAtSize(size, { descender: false });
      const upX = (top[0] - origin[0]) / height;
      const upY = (top[1] - origin[1]) / height;
      operators.push(beginText(), setTextRenderingMode(TextRenderingMode.Invisible),
        setFontAndSize(fontName, size),
        setTextMatrix((right[0] - origin[0]) / textWidth, (right[1] - origin[1]) / textWidth,
          upX, upY, origin[0] + upX * descent, origin[1] + upY * descent),
        showText(font.encodeText(line.text)), endText(),
      );
    }
    operators.push(popGraphicsState());
    const layer = document.context.register(document.context.contentStream(operators));
    page.node.normalize();
    page.node.addContentStream(layer);
    if (!editable) page.node.set(OCR_LAYER, layer);
    report((index + 1) / ocrPages.length, `${pageResult.index + 1}페이지 검색 텍스트 적용 중`);
  }
  document.setProducer('DaydayPDF OCR 2');
  return new Uint8Array(await document.save({ useObjectStreams: true }));
}

export async function correctRecognizedText(source, pageIndex, objectIndex, line, withDocument) {
  const input = await PDFDocument.load(source, { updateMetadata: false });
  const output = await PDFDocument.create();
  const [page] = await output.copyPages(input, [pageIndex]);
  output.addPage(page);
  const bytes = await output.save();
  const updated = line.text ? await createSearchablePdf(bytes, [{ index: 0, ocrApplied: true, lines: [line] }]) : bytes;
  return removeReplacedOcr(updated, [{ index: 0, remove: [objectIndex], replaceAt: line.text ? objectIndex : undefined }], withDocument);
}

export async function inspectPdfText(file) {
  const bytes = await readFileBytes(file);
  const pdf = await openPdfJs(bytes);
  try {
    const pages = [];
    for (let index = 0; index < pdf.numPages; index++) {
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent({ disableNormalization: false });
      pages.push(groupPdfTextItems(content.items).map(line => line.text).join('\n'));
      page.cleanup();
    }
    return pages;
  } finally { try { await pdf.loadingTask.destroy(); } catch {} }
}

export async function getOcrRuntimeVersions() {
  const [pdfjs, tesseractModule] = await Promise.all([getPdfJs(), import(OCR_ASSETS.library)]);
  const tesseract = tesseractModule.default || tesseractModule;
  return Object.freeze({ pdfjs: pdfjs.version, tesseract: tesseract.version || '7.0.0' });
}

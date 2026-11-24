import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import { zipSync } from 'fflate';

const PDFJS_VERSION = '6.2.108';
let pdfJsPromise = null;

export function baseName(name, fallback = 'document') {
  const clean = String(name || '').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').trim();
  return clean || fallback;
}

export function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export async function readFileBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

export function downloadBytes(bytes, type, name, {
  documentObject = document,
  urlApi = URL,
  BlobClass = Blob,
  schedule = setTimeout,
} = {}) {
  const blob = bytes instanceof BlobClass ? bytes : new BlobClass([bytes], { type });
  const anchor = documentObject.createElement('a');
  anchor.href = urlApi.createObjectURL(blob);
  anchor.download = name;
  anchor.hidden = true;
  documentObject.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  schedule(() => urlApi.revokeObjectURL(anchor.href), 10000);
}

export function downloadOutputFiles(outputs, { download = downloadBytes } = {}) {
  let count = 0;
  for (const output of outputs || []) {
    if (!output?.bytes || !output?.name) continue;
    download(output.bytes, output.type || 'application/octet-stream', output.name);
    count += 1;
  }
  return count;
}

export async function getPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import(`/assets/pdfjs/${PDFJS_VERSION}/legacy/build/pdf.min.mjs`).then(lib => {
      if (lib.version !== PDFJS_VERSION) throw new Error(`PDF.js 버전 불일치: ${lib.version}`);
      lib.GlobalWorkerOptions.workerSrc = `/assets/pdfjs/${PDFJS_VERSION}/legacy/build/pdf.worker.min.mjs`;
      return lib;
    });
    pdfJsPromise.catch(() => { pdfJsPromise = null; });
  }
  return pdfJsPromise;
}

export async function openPdfJs(bytes, password = '') {
  const lib = await getPdfJs();
  return lib.getDocument({
    data: bytes.slice(), password,
    isEvalSupported: false, enableScripting: false,
    cMapUrl: `/assets/pdfjs/${PDFJS_VERSION}/cmaps/`, cMapPacked: true,
    standardFontDataUrl: `/assets/pdfjs/${PDFJS_VERSION}/standard_fonts/`,
    wasmUrl: `/assets/pdfjs/${PDFJS_VERSION}/wasm/`,
    iccUrl: `/assets/pdfjs/${PDFJS_VERSION}/iccs/`, useWasm: true,
  }).promise;
}

export function compareRasterFrames(original, candidate, {
  changedPixelThreshold = 42,
  maxMeanDifference = 18,
  maxChangedRatio = .28,
  maxBrightnessShift = 14,
} = {}) {
  if (!original || !candidate
      || original.width !== candidate.width
      || original.height !== candidate.height
      || original.data?.length !== candidate.data?.length) {
    return Object.freeze({ safe: false, reason: 'dimension-mismatch' });
  }
  const source = original.data;
  const result = candidate.data;
  const pixelCount = original.width * original.height;
  if (!pixelCount || source.length < pixelCount * 4) {
    return Object.freeze({ safe: false, reason: 'invalid-frame' });
  }
  let totalDifference = 0;
  let changedPixels = 0;
  let sourceBrightness = 0;
  let resultBrightness = 0;
  for (let offset = 0; offset < pixelCount * 4; offset += 4) {
    const redDifference = Math.abs(source[offset] - result[offset]);
    const greenDifference = Math.abs(source[offset + 1] - result[offset + 1]);
    const blueDifference = Math.abs(source[offset + 2] - result[offset + 2]);
    const difference = (redDifference + greenDifference + blueDifference) / 3;
    totalDifference += difference;
    if (difference > changedPixelThreshold) changedPixels++;
    sourceBrightness += (source[offset] * .2126) + (source[offset + 1] * .7152) + (source[offset + 2] * .0722);
    resultBrightness += (result[offset] * .2126) + (result[offset + 1] * .7152) + (result[offset + 2] * .0722);
  }
  const meanDifference = totalDifference / pixelCount;
  const changedRatio = changedPixels / pixelCount;
  const brightnessShift = Math.abs(sourceBrightness - resultBrightness) / pixelCount;
  return Object.freeze({
    safe: meanDifference <= maxMeanDifference
      && changedRatio <= maxChangedRatio
      && brightnessShift <= maxBrightnessShift,
    reason: 'visual-difference',
    meanDifference,
    changedRatio,
    brightnessShift,
  });
}

async function renderValidationFrame(pdfDocument, pageIndex, maxDimension = 256) {
  const page = await pdfDocument.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.max(.1, maxDimension / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  try {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('PDF 안전성 확인용 Canvas를 만들 수 없습니다');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    return Object.freeze({ width: frame.width, height: frame.height, data: frame.data });
  } finally {
    canvas.width = 1;
    canvas.height = 1;
    page.cleanup();
  }
}

export async function validatePdfVisualMatch(originalBytes, candidateBytes, report = () => {}, {
  pageIndexes = null,
  openDocument = openPdfJs,
  renderFrame = renderValidationFrame,
} = {}) {
  const original = await openDocument(originalBytes);
  let candidate;
  try {
    candidate = await openDocument(candidateBytes);
    if (original.numPages !== candidate.numPages) {
      return Object.freeze({ safe: false, reason: 'page-count-mismatch', checkedPages: 0 });
    }
    const requested = pageIndexes?.length
      ? pageIndexes
      : Array.from({ length: original.numPages }, (_, index) => index);
    const indexes = [...new Set(requested)]
      .filter(index => Number.isInteger(index) && index >= 0 && index < original.numPages);
    if (!indexes.length) {
      return Object.freeze({ safe: false, reason: 'no-pages-to-check', checkedPages: 0 });
    }
    for (let checked = 0; checked < indexes.length; checked++) {
      const pageIndex = indexes[checked];
      const originalFrame = await renderFrame(original, pageIndex);
      const candidateFrame = await renderFrame(candidate, pageIndex);
      const comparison = compareRasterFrames(originalFrame, candidateFrame);
      report((checked + 1) / indexes.length, `${pageIndex + 1}페이지 압축 안전성 확인 중`);
      if (!comparison.safe) {
        return Object.freeze({
          safe: false,
          reason: comparison.reason,
          pageIndex,
          checkedPages: checked + 1,
          comparison,
        });
      }
    }
    return Object.freeze({ safe: true, checkedPages: indexes.length });
  } finally {
    try { await candidate?.destroy(); } catch {}
    try { await original.destroy(); } catch {}
  }
}

export async function renderThumbnail(pdfDocument, pageIndex, canvas, {
  maxWidth = 150, maxHeight = 190,
} = {}) {
  const page = await pdfDocument.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxWidth / base.width, maxHeight / base.height);
  const viewport = page.getViewport({ scale: Math.max(.1, scale) });
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext('2d', { alpha: false });
  context.save();
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
  await page.render({ canvasContext: context, viewport }).promise;
  page.cleanup();
}

const IMAGE_ENCODING = Object.freeze({
  jpg: Object.freeze({ mime: 'image/jpeg', extension: 'jpg', label: 'JPG' }),
  png: Object.freeze({ mime: 'image/png', extension: 'png', label: 'PNG' }),
  webp: Object.freeze({ mime: 'image/webp', extension: 'webp', label: 'WebP' }),
});

export async function renderPageImage(pdfDocument, pageIndex, {
  format = 'jpg', scale = 1.66, quality = .8,
} = {}) {
  const encoding = IMAGE_ENCODING[format];
  if (!encoding) throw new TypeError(`지원하지 않는 이미지 형식입니다: ${format}`);
  const page = await pdfDocument.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    value => value && value.type === encoding.mime
      ? resolve(value)
      : reject(new Error(`${encoding.label} 생성 실패`)), encoding.mime, quality));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  canvas.width = 1; canvas.height = 1;
  page.cleanup();
  return { bytes, pageWidth: viewport.width / scale, pageHeight: viewport.height / scale };
}

export function renderPageJpeg(pdfDocument, pageIndex, options = {}) {
  return renderPageImage(pdfDocument, pageIndex, { ...options, format: 'jpg' });
}

export async function rasterizePdfToImagePdf(sourceBytes, report = () => {}, profile = {}) {
  const source = await openPdfJs(sourceBytes);
  const output = await PDFDocument.create();
  try {
    for (let pageIndex = 0; pageIndex < source.numPages; pageIndex++) {
      const rendered = await renderPageJpeg(source, pageIndex, profile);
      const image = await output.embedJpg(rendered.bytes);
      const page = output.addPage([rendered.pageWidth, rendered.pageHeight]);
      page.drawImage(image, {
        x: 0, y: 0,
        width: rendered.pageWidth,
        height: rendered.pageHeight,
      });
      report(
        (pageIndex + 1) / source.numPages,
        `${pageIndex + 1}/${source.numPages}페이지 이미지 PDF 만드는 중`,
      );
    }
    return new Uint8Array(await output.save());
  } finally {
    try { await source.destroy(); } catch {}
  }
}

export async function loadPdfLib(bytes) {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

export async function getPdfPageCount(file) {
  const document = await loadPdfLib(await readFileBytes(file));
  return document.getPageCount();
}

export async function mergePdfFiles(files, report = () => {}) {
  const output = await PDFDocument.create();
  let totalPages = 0;
  for (let index = 0; index < files.length; index++) {
    const bytes = await readFileBytes(files[index]);
    const source = await loadPdfLib(bytes);
    const pageIndexes = source.getPageIndices();
    const pages = await output.copyPages(source, pageIndexes);
    pages.forEach(page => output.addPage(page));
    totalPages += pages.length;
    report((index + 1) / files.length, `${index + 1}/${files.length} 파일 합치는 중`);
  }
  return { bytes: new Uint8Array(await output.save()), totalPages };
}

export async function savePdfPages(sourceBytes, order, rotations = new Map()) {
  const source = await loadPdfLib(sourceBytes);
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, order);
  pages.forEach((page, outputIndex) => {
    const sourceIndex = order[outputIndex];
    const delta = rotations.get(sourceIndex) || 0;
    if (delta) page.setRotation(degrees((page.getRotation().angle + delta + 360) % 360));
    output.addPage(page);
  });
  return new Uint8Array(await output.save());
}

export const PDF_PAPER_SIZES = Object.freeze({
  a4: Object.freeze([595.28, 841.89]),
  a3: Object.freeze([841.89, 1190.55]),
  a5: Object.freeze([419.53, 595.28]),
  b4: Object.freeze([728.5, 1031.81]),
  letter: Object.freeze([612, 792]),
});

export async function resizePdfPages(sourceBytes, selectedPageIndexes, {
  paper = 'a4', orientation = 'auto',
} = {}) {
  const paperSize = PDF_PAPER_SIZES[paper];
  if (!paperSize) throw new TypeError(`지원하지 않는 용지 크기입니다: ${paper}`);
  if (!['auto', 'portrait', 'landscape'].includes(orientation)) {
    throw new TypeError(`지원하지 않는 용지 방향입니다: ${orientation}`);
  }
  const selected = new Set(selectedPageIndexes);
  const source = await loadPdfLib(sourceBytes);
  const output = await PDFDocument.create();
  for (let pageIndex = 0; pageIndex < source.getPageCount(); pageIndex++) {
    if (!selected.has(pageIndex)) {
      const [copied] = await output.copyPages(source, [pageIndex]);
      output.addPage(copied);
      continue;
    }
    const sourcePage = source.getPage(pageIndex);
    const theta = ((sourcePage.getRotation().angle || 0) % 360 + 360) % 360;
    const sourceSize = sourcePage.getSize();
    const displayedWidth = theta % 180 ? sourceSize.height : sourceSize.width;
    const displayedHeight = theta % 180 ? sourceSize.width : sourceSize.height;
    let [targetWidth, targetHeight] = paperSize;
    const landscape = orientation === 'landscape'
      || (orientation === 'auto' && displayedWidth > displayedHeight);
    if (landscape) [targetWidth, targetHeight] = [targetHeight, targetWidth];

    const outputPage = output.addPage([targetWidth, targetHeight]);
    if (!sourcePage.node.get(PDFName.of('Contents'))) continue;
    const embedded = await output.embedPage(sourcePage);
    const scale = Math.min(targetWidth / displayedWidth, targetHeight / displayedHeight);
    const centeredX = (targetWidth - displayedWidth * scale) / 2;
    const centeredY = (targetHeight - displayedHeight * scale) / 2;
    let x = centeredX;
    let y = centeredY;
    if (theta === 90) y += displayedHeight * scale;
    else if (theta === 180) {
      x += displayedWidth * scale;
      y += displayedHeight * scale;
    } else if (theta === 270) x += displayedWidth * scale;
    outputPage.drawPage(embedded, {
      x, y, xScale: scale, yScale: scale, rotate: degrees(-theta),
    });
  }
  return new Uint8Array(await output.save());
}

export async function jpgFilesToPdf(files, report = () => {}, profile = {}) {
  return imageFilesToPdf(files, report, profile);
}

async function prepareImageForPdf(file, profile = {}) {
  const bytes = await readFileBytes(file);
  const fileName = String(file.name || '').toLowerCase();
  const isJpeg = file.type === 'image/jpeg' || /\.jpe?g$/.test(fileName);
  const isPng = file.type === 'image/png' || /\.png$/.test(fileName);
  if (profile.preserveOriginal && (isJpeg || isPng)) {
    return { bytes, encoding: isJpeg ? 'jpg' : 'png' };
  }
  const sourceBlob = new Blob([bytes], { type: file.type || 'application/octet-stream' });
  let bitmap;
  try { bitmap = await createImageBitmap(sourceBlob, { imageOrientation: 'from-image' }); }
  catch { bitmap = await createImageBitmap(sourceBlob); }
  try {
    const scale = Math.min(1, (profile.maxDimension || 2800) / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const outputJpeg = isJpeg;
    const context = canvas.getContext('2d', { alpha: !outputJpeg });
    if (outputJpeg) {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const mime = outputJpeg ? 'image/jpeg' : 'image/png';
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      value => value ? resolve(value) : reject(new Error('이미지 변환 실패')),
      mime, profile.quality || .84));
    canvas.width = 1; canvas.height = 1;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), encoding: outputJpeg ? 'jpg' : 'png' };
  } finally { bitmap.close(); }
}

export async function imageFilesToPdf(files, report = () => {}, profile = {}) {
  const output = await PDFDocument.create();
  for (let index = 0; index < files.length; index++) {
    const prepared = await prepareImageForPdf(files[index], profile);
    const image = prepared.encoding === 'jpg'
      ? await output.embedJpg(prepared.bytes)
      : await output.embedPng(prepared.bytes);
    const width = image.width * .75;
    const height = image.height * .75;
    const page = output.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
    report((index + 1) / files.length, `${index + 1}/${files.length} 이미지 변환 중`);
  }
  return new Uint8Array(await output.save());
}

export async function pdfDocumentsToImageFiles(documents, format = 'jpg', report = () => {}, profile = {}) {
  const encoding = IMAGE_ENCODING[format];
  if (!encoding) throw new TypeError(`지원하지 않는 이미지 형식입니다: ${format}`);
  const files = [];
  let completed = 0;
  const totalPages = documents.reduce((sum, item) => sum + item.pageIndexes.length, 0);
  for (const { file, document, pageIndexes } of documents) {
    const folder = baseName(file.name);
    for (const pageIndex of pageIndexes) {
      const rendered = await renderPageImage(document, pageIndex, { ...profile, format });
      const pageName = `${String(pageIndex + 1).padStart(3, '0')}.${encoding.extension}`;
      files.push(Object.freeze({
        name: `${folder}-${pageName}`,
        archiveName: `${folder}/${pageName}`,
        type: encoding.mime,
        bytes: rendered.bytes,
      }));
      completed += 1;
      report(completed / totalPages, `${completed}/${totalPages} 페이지 ${encoding.label} 변환 중`);
    }
  }
  return files;
}

export function imageFilesToZip(files) {
  const archive = Object.fromEntries(files.map(file => [file.archiveName || file.name, file.bytes]));
  return zipSync(archive, { level: 0 });
}

export async function pdfDocumentsToImageZip(documents, format = 'jpg', report = () => {}, profile = {}) {
  const files = await pdfDocumentsToImageFiles(documents, format, report, profile);
  return imageFilesToZip(files);
}

export function pdfDocumentsToJpgZip(documents, report = () => {}, profile = {}) {
  return pdfDocumentsToImageZip(documents, 'jpg', report, profile);
}

export async function pdfFilesToJpgZip(files, report = () => {}, profile = {}, pageSelections = null) {
  const documents = [];
  try {
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const file = files[fileIndex];
      const document = await openPdfJs(await readFileBytes(file));
      const configured = pageSelections?.get(fileIndex);
      const pageIndexes = configured || Array.from({ length: document.numPages }, (_, index) => index);
      documents.push({ file, document, pageIndexes });
    }
    return await pdfDocumentsToJpgZip(documents, report, profile);
  } finally {
    for (const item of documents) try { await item.document.destroy(); } catch {}
  }
}

export function selectedIndexes(selected) {
  return [...selected].sort((a, b) => a - b);
}

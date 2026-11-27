export function originalPrintBytes(pages, getSource) {
  if (!pages.length) return null;
  const sourceId = pages[0].src, source = getSource(sourceId);
  if (!source?.bytes || source.locked || source.doc?.numPages !== pages.length) return null;
  return pages.every((p, index) => p.src === sourceId && p.idx === index &&
    !p.blank && !p.resize && !p.crop && !(p.rot % 360) && !p.texts?.length)
    ? source.bytes : null;
}

export async function copyOutputPages(output, pages, getLibDoc) {
  const groups = new Map(), copies = new Map();
  pages.forEach((page, position) => {
    if (page.blank || page.resize) return;
    if (!groups.has(page.src)) groups.set(page.src, []);
    groups.get(page.src).push({ page, position });
  });
  for (const [sourceId, entries] of groups) {
    const source = await getLibDoc(sourceId);
    let pending = entries;
    while (pending.length) {
      const batch = [], rest = [], seen = new Set();
      for (const entry of pending) {
        if (seen.has(entry.page.idx)) rest.push(entry);
        else { seen.add(entry.page.idx); batch.push(entry); }
      }
      const result = await output.copyPages(source, batch.map(entry => entry.page.idx));
      batch.forEach((entry, index) => copies.set(entry.position, result[index]));
      pending = rest;
    }
  }
  return copies;
}

export async function embedResizedOutputPages(output, pages, getLibDoc) {
  const groups = new Map(), embedded = new Map();
  pages.forEach((page, position) => {
    if (page.blank || !page.resize) return;
    if (!groups.has(page.src)) groups.set(page.src, []);
    groups.get(page.src).push({ page, position });
  });
  for (const [sourceId, entries] of groups) {
    const source = await getLibDoc(sourceId);
    const result = await output.embedPages(entries.map(entry => source.getPage(entry.page.idx)));
    entries.forEach((entry, index) => embedded.set(entry.position, result[index]));
  }
  return embedded;
}

export async function canvasImageBytes(canvas, type, quality) {
  const blob = await canvasImageBlob(canvas, type, quality);
  return new Uint8Array(await blob.arrayBuffer());
}

export async function canvasImageBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(value =>
    value && value.type === type ? resolve(value) : reject(new Error('이미지를 만들지 못했습니다.')), type, quality));
}

export async function drawCanvasRgb(output, page, canvas, pdfLib,
  Compression = globalThis.CompressionStream, signal) {
  if (typeof Compression !== 'function') return false;
  const stream = new Compression('deflate'), writer = stream.writable.getWriter();
  const result = new Response(stream.readable).arrayBuffer();
  result.catch(() => {});
  const context = canvas.getContext('2d'), width = canvas.width, height = canvas.height;
  const stripHeight = Math.max(1, Math.min(128, Math.floor(1048576 / width)));
  try {
    for (let y = 0; y < height; y += stripHeight) {
      signal?.throwIfAborted();
      const rows = Math.min(stripHeight, height - y);
      const rgba = context.getImageData(0, y, width, rows).data;
      const rgb = new Uint8Array(width * rows * 3);
      for (let i = 0, j = 0; i < rgba.length; i += 4) {
        const alpha = rgba[i + 3];
        if (alpha === 255) {
          rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2];
        } else {
          rgb[j++] = Math.round((rgba[i] * alpha + 255 * (255 - alpha)) / 255);
          rgb[j++] = Math.round((rgba[i + 1] * alpha + 255 * (255 - alpha)) / 255);
          rgb[j++] = Math.round((rgba[i + 2] * alpha + 255 * (255 - alpha)) / 255);
        }
      }
      await writer.write(rgb);
    }
    await writer.close();
    const data = new Uint8Array(await result);
    signal?.throwIfAborted();
    const image = output.context.stream(data, { Type: 'XObject', Subtype: 'Image',
      Width: width, Height: height, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Filter: 'FlateDecode' });
    const name = page.node.newXObject('Raster', output.context.register(image));
    page.pushOperators(pdfLib.pushGraphicsState(),
      pdfLib.concatTransformationMatrix(page.getWidth(), 0, 0, page.getHeight(), 0, 0),
      pdfLib.drawObject(name), pdfLib.popGraphicsState());
    return true;
  } catch (error) {
    await writer.abort(error).catch(() => {});
    throw error;
  }
}

export function createRasterOutputFeature({ pdfLib, getViewport, paintPage, drawObjects,
  prepareImages = async () => {}, createCanvas, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) }) {
  async function render(pages, options, consume) {
    const { scale, maxEdge = 12000, maxPixels = 6e7, onProgress = () => {},
      intent = 'display', transformCanvas, fitWithin, signal, supersample, withPage } = options;
    const check = () => { if (signal?.aborted) throw new DOMException('이미지 변환을 취소했습니다.', 'AbortError'); };
    let limited = false;
    const canvas = createCanvas();
    canvas.getContext('2d', { alpha: false });
    try {
      for (let index = 0; index < pages.length; index++) {
        check(); onProgress(index, pages.length);
        const page = pages[index], viewport = await getViewport(page, 1);
        const sheet = options.autoRotateFit && fitWithin && (fitWithin[0] > fitWithin[1]) !== (viewport.width > viewport.height)
          ? [fitWithin[1], fitWithin[0]] : fitWithin;
        const targetScale = sheet ? scale * Math.min(sheet[0] / viewport.width, sheet[1] / viewport.height) : scale;
        const safeScale = Math.min(targetScale, maxEdge / Math.max(1, viewport.width, viewport.height),
          Math.sqrt(maxPixels / Math.max(1, viewport.width * viewport.height)));
        limited ||= safeScale < targetScale * .99;
        const paint = async model => {
          check();
          await prepareImages(model);
          await paintPage(model, canvas, safeScale, 1, null, { intent, signal, supersample });
          check();
          await drawObjects(model, canvas, viewport.width);
        };
        if (withPage) await withPage(page, paint);
        else await paint(page);
        if (transformCanvas) transformCanvas(canvas);
        check(); await consume(canvas, viewport, index); check();
        canvas.width = canvas.height = 0;
        onProgress(index + 1, pages.length);
        await yieldTask();
      }
      return { limited };
    } finally { canvas.width = canvas.height = 0; }
  }
  async function buildPdf(pages, options) {
    const output = await pdfLib.PDFDocument.create();
    if (options.name) output.setTitle(options.name);
    const { type = 'image/png', quality = 1 } = options;
    const state = await render(pages, options, async (canvas, viewport) => {
      const page = output.addPage([viewport.width, viewport.height]);
      if (type === 'image/png' && await drawCanvasRgb(output, page, canvas, pdfLib, undefined, options.signal)) return;
      const bytes = await canvasImageBytes(canvas, type, quality);
      if (type === 'image/png') {
        if (drawOpaquePng(output, page, bytes, pdfLib)) return;
      }
      const image = type === 'image/png' ? await output.embedPng(bytes) : await output.embedJpg(bytes);
      page.drawImage(image, { x: 0, y: 0, width: viewport.width, height: viewport.height });
    });
    options.signal?.throwIfAborted();
    const bytes = await output.save({ useObjectStreams: false });
    options.signal?.throwIfAborted();
    return { ...state, bytes: new Uint8Array(bytes) };
  }
  return Object.freeze({ render, buildPdf });
}

export function drawOpaquePng(output, page, bytes, pdfLib) {
  const signature = [137,80,78,71,13,10,26,10];
  if (bytes.length < 33 || signature.some((value,index) => bytes[index] !== value)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), chunks = [];
  let width = 0, height = 0, colors = 0, total = 0, ended = false;
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = view.getUint32(at), start = at + 8, end = start + length;
    if (end + 4 > bytes.length) return false;
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === 'IHDR') {
      if (length !== 13 || bytes[start+8] !== 8 || ![0,2].includes(bytes[start+9]) ||
          bytes[start+10] || bytes[start+11] || bytes[start+12]) return false;
      width = view.getUint32(start); height = view.getUint32(start+4); colors = bytes[start+9] === 2 ? 3 : 1;
    } else if (type === 'tRNS' || type === 'iCCP') return false;
    else if (type === 'IDAT') { chunks.push(bytes.subarray(start,end)); total += length; }
    else if (type === 'IEND') { ended = true; break; }
    at = end + 4;
  }
  if (!ended || !width || !height || !total || !colors) return false;
  const data = new Uint8Array(total); let at = 0;
  for (const chunk of chunks) { data.set(chunk,at); at += chunk.length; }
  const image = output.context.stream(data, {
    Type: 'XObject', Subtype: 'Image', Width: width, Height: height,
    BitsPerComponent: 8, ColorSpace: colors === 3 ? 'DeviceRGB' : 'DeviceGray', Filter: 'FlateDecode',
    DecodeParms: { Predictor: 15, Colors: colors, BitsPerComponent: 8, Columns: width },
  });
  const ref = output.context.register(image), name = page.node.newXObject('Raster',ref);
  page.pushOperators(pdfLib.pushGraphicsState(),
    pdfLib.concatTransformationMatrix(page.getWidth(),0,0,page.getHeight(),0,0),
    pdfLib.drawObject(name),pdfLib.popGraphicsState());
  return true;
}

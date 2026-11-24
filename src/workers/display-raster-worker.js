let lib, heap, doc = 0, pointer = 0, page = 0, pageIndex = -1;
let openingRaster = null;
function clearOpeningRaster() {
  if (openingRaster) openingRaster.width = openingRaster.height = 0;
  openingRaster = null;
}
function closeDocument() {
  clearOpeningRaster();
  if (page) lib.FPDF_ClosePage(page);
  if (doc) lib.FPDF_CloseDocument(doc);
  if (pointer) heap.wasmExports.free(pointer);
  page = doc = pointer = 0; pageIndex = -1;
}
function outputBounds(job) {
  const count = lib.FPDFPage_CountObjects(page);
  if (count < 0 || count > 4096 || lib.FPDFPage_GetAnnotCount(page) !== 0) return null;
  const buf = heap.wasmExports.malloc(24);
  if (!buf) return null;
  try {
    const boxes = [];
    for (let i = 0; i < count; i++) {
      const obj = lib.FPDFPage_GetObject(page, i);
      if (!obj || ![1,2,3,5].includes(lib.FPDFPageObj_GetType(obj)) ||
          !lib.FPDFPageObj_GetBounds(obj, buf, buf+4, buf+8, buf+12)) return null;
      const [l,b,r,t] = heap.HEAPF32.subarray(buf/4, buf/4+4);
      if (![l,b,r,t].every(Number.isFinite) || l > r || b > t) return null;
      const corners = [];
      for (const [x,y] of [[l,b],[r,t]]) {
        if (!lib.FPDF_PageToDevice(page, job.x, job.y, job.fullWidth, job.fullHeight,
            job.rotation, x, y, buf+16, buf+20)) return null;
        corners.push(heap.HEAP32[buf/4+4], heap.HEAP32[buf/4+5]);
      }
      const [x1,y1,x2,y2] = corners, n = job.samples;
      boxes.push([Math.floor(Math.min(x1,x2)/n)-2, Math.floor(Math.min(y1,y2)/n)-2,
        Math.ceil(Math.max(x1,x2)/n)+2, Math.ceil(Math.max(y1,y2)/n)+2]);
    }
    return boxes;
  } finally { heap.wasmExports.free(buf); }
}

self.onmessage = async ({ data: job }) => {
  try {
    if (job.type === 'init') {
      const module = await import(job.cdn + 'index.browser.js');
      lib = await module.init({ wasmBinary: job.wasm });
      lib.PDFiumExt_Init();
      if (typeof configurePcFonts === 'function') configurePcFonts(lib); heap = lib.pdfium;
    } else if (job.type === 'open') {
      closeDocument();
      const bytes = new Uint8Array(job.bytes);
      pointer = heap.wasmExports.malloc(bytes.length);
      if (!pointer) throw new Error('PDFium document allocation failed');
      heap.HEAPU8.set(bytes, pointer);
      doc = lib.FPDF_LoadMemDocument(pointer, bytes.length, 0);
      if (!doc) throw new Error('PDFium document load failed');
    } else if (job.type === 'paint' || job.type === 'preview' || job.type === 'size' || job.type === 'output-bounds') {
      if (pageIndex !== job.index) {
        if (page) lib.FPDF_ClosePage(page);
        page = 0; pageIndex = -1;
        page = lib.FPDF_LoadPage(doc, job.index);
        if (!page) throw new Error('PDFium page load failed');
        pageIndex = job.index;
      }
      if (job.type === 'output-bounds') {
        postMessage({ boxes: outputBounds(job), heapBytes: heap.HEAPU8.byteLength });
        return;
      }
      if (job.type === 'size') {
        const width = lib.FPDF_GetPageWidthF(page), height = lib.FPDF_GetPageHeightF(page);
        if (!(width > 0 && height > 0 && Number.isFinite(width + height))) throw new Error('Invalid page size');
        postMessage({ width, height, heapBytes: heap.HEAPU8.byteLength });
        return;
      }
      if (job.type === 'preview') {
        job.fullWidth = job.width;
        job.fullHeight = job.height;
        job.x = job.y = job.rotation = 0;
      }
      if (openingRaster) {
        if (job.type === 'paint' && job.index === 0 && job.rotation === 0 && job.x === 0 && job.y === 0 &&
            job.width === job.fullWidth && job.height === job.fullHeight &&
            openingRaster.width === job.width && openingRaster.height === job.height) {
          const image = openingRaster.transferToImageBitmap();
          clearOpeningRaster();
          postMessage({ image, heapBytes: heap.HEAPU8.byteLength }, [image]);
          return;
        }
        clearOpeningRaster();
      }
      let bitmap = 0, canvas;
      try {
        if (job.width * job.height > 16000000) throw new Error('Display bitmap exceeds pixel budget');
        bitmap = lib.FPDFBitmap_Create(job.width, job.height, 0);
        if (!bitmap) throw new Error('PDFium bitmap allocation failed');
        lib.FPDFBitmap_FillRect(bitmap, 0, 0, job.width, job.height, 0xffffffff);
        lib.FPDF_RenderPageBitmap(bitmap, page, job.x, job.y, job.fullWidth, job.fullHeight, job.rotation, 0x11);
        const at = lib.FPDFBitmap_GetBuffer(bitmap), stride = lib.FPDFBitmap_GetStride(bitmap);
        if (!at || stride !== job.width * 4) throw new Error('Unexpected display bitmap stride');
        const samples = job.samples || 1;
        const w = job.width / samples, h = job.height / samples;
        const pixels = new Uint8ClampedArray(heap.HEAPU8.buffer, at, stride * job.height);
        const raster = samples === 1 ? new ImageData(pixels, w, h) : new ImageData(w, h);
        if (samples > 1) averageRasterPixels(pixels, raster.data, w, h, samples);
        canvas = new OffscreenCanvas(w, h);
        canvas.getContext('2d', { alpha: false }).putImageData(raster, 0, 0);
        const image = job.type === 'preview' ? await createImageBitmap(canvas) : canvas.transferToImageBitmap();
        if (job.type === 'preview') { openingRaster = canvas; canvas = null; }
        postMessage({ image, heapBytes: heap.HEAPU8.byteLength }, [image]);
      } finally {
        if (canvas) canvas.width = canvas.height = 0;
        if (bitmap) lib.FPDFBitmap_Destroy(bitmap);
      }
      return;
    }
    postMessage({ heapBytes: heap.HEAPU8.byteLength });
  } catch (error) { postMessage({ error: String(error?.message || error) }); }
};

let lib, heap, doc, pointer;
self.onmessage = async ({ data: job }) => {
  try {
    if (job.type === 'init') {
      const module = await import(job.cdn + 'index.browser.js');
      lib = await module.init({ wasmBinary: job.wasm });
      lib.PDFiumExt_Init();
      if (typeof configurePcFonts === 'function') configurePcFonts(lib); heap = lib.pdfium;
      const bytes = new Uint8Array(job.bytes);
      pointer = heap.wasmExports.malloc(bytes.length);
      if (!pointer) throw new Error('PDFium memory allocation failed');
      heap.HEAPU8.set(bytes, pointer);
      doc = lib.FPDF_LoadMemDocument(pointer, bytes.length, 0);
      if (!doc) throw new Error('PDFium document load failed');
      if (lib.FPDF_GetPageCount(doc) !== job.pages) throw new Error('Print page count mismatch');
      postMessage({ heapBytes: heap.HEAPU8.byteLength }); return;
    }
    const page = lib.FPDF_LoadPage(doc, job.index);
    if (!page) throw new Error('Print page load failed');
    let bitmap = 0, canvas;
    try {
      bitmap = lib.FPDFBitmap_Create(job.width, job.height, 0);
      if (!bitmap) throw new Error('PDFium bitmap memory allocation failed');
      lib.FPDFBitmap_FillRect(bitmap, 0, 0, job.width, job.height, 0xffffffff);
      lib.FPDF_RenderPageBitmap(bitmap, page, 0, 0, job.width, job.height, 0, 0x811);
      const at = lib.FPDFBitmap_GetBuffer(bitmap), stride = lib.FPDFBitmap_GetStride(bitmap);
      if (!at || stride !== job.width * 4) throw new Error('Unexpected print bitmap stride');
      const pixels = new Uint8ClampedArray(heap.HEAPU8.buffer, at, stride * job.height);
      if (job.monochrome) for (let i = 0; i < pixels.length; i += 4)
        pixels[i] = pixels[i + 1] = pixels[i + 2] = Math.round(.299 * pixels[i] + .587 * pixels[i + 1] + .114 * pixels[i + 2]);
      canvas = new OffscreenCanvas(job.width, job.height);
      canvas.getContext('2d', { alpha: false }).putImageData(new ImageData(pixels, job.width, job.height), 0, 0);
      const bytes = await (await canvas.convertToBlob({ type: 'image/jpeg', quality: .9 })).arrayBuffer();
      postMessage({ index: job.index, bytes, heapBytes: heap.HEAPU8.byteLength }, [bytes]);
    } finally {
      if (canvas) canvas.width = canvas.height = 0;
      if (bitmap) lib.FPDFBitmap_Destroy(bitmap);
      lib.FPDF_ClosePage(page);
    }
  } catch (error) { postMessage({ error: String(error?.message || error) }); }
};

const cancelled = new Set();
let lib = null;

self.onmessage = async event => {
  const message = event.data;
  try {
    if (message.t === 'init') {
      const module = await import(message.cdn + 'index.browser.js');
      lib = await module.init({ wasmBinary: message.wasm });
      lib.PDFiumExt_Init();
      if (typeof configurePcFonts === 'function') configurePcFonts(lib);
      postMessage({ t: 'ready' });
      return;
    }
    if (message.t === 'cancel') {
      cancelled.add(message.id);
      return;
    }
    if (message.t !== 'batch') return;
    const pdfium = lib.pdfium;
    const bytes = new Uint8Array(message.bytes);
    const pointer = pdfium.wasmExports.malloc(bytes.length);
    if (!pointer) throw new Error('wasm 메모리 부족');
    pdfium.HEAPU8.set(bytes, pointer);
    const documentHandle = lib.FPDF_LoadMemDocument(pointer, bytes.length, 0);
    if (!documentHandle) {
      pdfium.wasmExports.free(pointer);
      throw new Error('PDFium 문서 열기 실패');
    }
    try {
      for (const job of message.jobs) {
        if (cancelled.has(message.id)) break;
        const pageHandle = lib.FPDF_LoadPage(documentHandle, job.idx);
        if (!pageHandle) continue;
        try {
          const pageWidth = lib.FPDF_GetPageWidthF(pageHandle);
          const pageHeight = lib.FPDF_GetPageHeightF(pageHandle);
          if (!(pageWidth > 0) || !(pageHeight > 0)) continue;
          const swap = job.rot % 180 !== 0;
          const displayWidth = swap ? pageHeight : pageWidth;
          const displayHeight = swap ? pageWidth : pageHeight;
          const outputWidth = job.px;
          const outputHeight = Math.max(1, Math.min(1024,
            Math.round(job.px * displayHeight / displayWidth)));
          const bitmap = lib.FPDFBitmap_Create(outputWidth, outputHeight, 0);
          if (!bitmap) throw new Error('비트맵 생성 실패');
          lib.FPDFBitmap_FillRect(bitmap, 0, 0, outputWidth, outputHeight, 0xFFFFFFFF);
          lib.FPDF_RenderPageBitmap(bitmap, pageHandle, 0, 0, outputWidth, outputHeight,
            ((job.rot / 90) % 4 + 4) % 4, 1);
          const buffer = lib.FPDFBitmap_GetBuffer(bitmap);
          const stride = lib.FPDFBitmap_GetStride(bitmap);
          const output = new Uint8ClampedArray(outputWidth * outputHeight * 4);
          const heap = pdfium.HEAPU8;
          for (let y = 0; y < outputHeight; y++) {
            let sourceIndex = buffer + y * stride;
            let outputIndex = y * outputWidth * 4;
            for (let x = 0; x < outputWidth; x++) {
              output[outputIndex] = heap[sourceIndex + 2];
              output[outputIndex + 1] = heap[sourceIndex + 1];
              output[outputIndex + 2] = heap[sourceIndex];
              output[outputIndex + 3] = 255;
              sourceIndex += 4;
              outputIndex += 4;
            }
          }
          lib.FPDFBitmap_Destroy(bitmap);
          const image = await createImageBitmap(new ImageData(output, outputWidth, outputHeight));
          postMessage({
            t: 'page', id: message.id, u: job.u, bmp: image, pw: displayWidth,
          }, [image]);
        } finally {
          lib.FPDF_ClosePage(pageHandle);
        }
      }
    } finally {
      lib.FPDF_CloseDocument(documentHandle);
      pdfium.wasmExports.free(pointer);
      cancelled.delete(message.id);
    }
    postMessage({ t: 'done', id: message.id });
  } catch (error) {
    postMessage({
      t: 'err', id: message.id, msg: String(error && error.message || error),
    });
  }
};

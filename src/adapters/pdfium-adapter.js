export function readPdfiumFontName(library, module, font) {
  for (const name of ['FPDFFont_GetFamilyName', 'FPDFFont_GetBaseFontName']) {
    const read = library[name];
    if (typeof read !== 'function') continue;
    const length = read(font, 0, 0);
    if (!(length > 1)) continue;
    const ptr = module.wasmExports.malloc(length);
    try {
      read(font, ptr, length);
      const value = new TextDecoder().decode(module.HEAPU8.slice(ptr, ptr + length)).replace(/\0+$/, '').trim();
      if (value) return value;
    } finally { module.wasmExports.free(ptr); }
  }
  return '';
}

export function createPdfiumAdapter({
  cdn,
  importModule = specifier => import(specifier),
  fetchFn,
  onBusyChange,
  onEngineError,
}) {
  let enginePromise = null;
  let initializedBefore = false;
  let wasmBinary = null;
  let wasmPromise = null;

  function reset() { enginePromise = null; }

  function getWasmBinary() {
    if (!wasmPromise) {
      wasmPromise = (async () => {
        const response = await fetchFn(cdn + 'pdfium.wasm');
        if (response.ok === false) throw new Error(`PDFium load failed: ${response.status}`);
        const binary = await response.arrayBuffer();
        if (!binary.byteLength) throw new Error('PDFium binary is empty');
        wasmBinary = binary;
        return binary;
      })();
      wasmPromise.catch(() => { wasmPromise = null; });
    }
    return wasmPromise;
  }

  function get() {
    if (!enginePromise) {
      enginePromise = (async () => {
        onBusyChange(true, initializedBefore ? 'PDF 엔진 재시작 중...'
                                      : 'PDF 엔진(PDFium) 준비 중...');
        try {
          const module = await importModule(cdn + 'index.browser.js');
          const binary = await getWasmBinary();
          const library = await module.init({ wasmBinary: binary.slice(0) });
          library.PDFiumExt_Init();
          initializedBefore = true;
          return library;
        } finally { onBusyChange(false); }
      })();
      enginePromise.catch(reset);
    }
    return enginePromise;
  }

  async function decrypt(bytes, password) {
    const library = await get();
    const module = library.pdfium;
    const pointer = module.wasmExports.malloc(bytes.length);
    if (!pointer) { reset(); throw new Error('메모리 부족 — 파일이 너무 큽니다 (엔진 재시작됨)'); }
    module.HEAPU8.set(bytes, pointer);
    const documentHandle = library.FPDF_LoadMemDocument(pointer, bytes.length, String(password));
    if (!documentHandle) {
      module.wasmExports.free(pointer);
      throw new Error('암호가 올바르지 않습니다');
    }
    try {
      const writer = library.PDFiumExt_OpenFileWriter();
      try {
        const saved = typeof library.FPDF_SaveAsCopy === 'function'
          ? library.FPDF_SaveAsCopy(documentHandle, writer, 3)
          : library.PDFiumExt_SaveAsCopy(documentHandle, writer);
        if (!saved) throw new Error('해제 사본 저장 실패');
        const size = library.PDFiumExt_GetFileWriterSize(writer);
        const outputPointer = module.wasmExports.malloc(size);
        library.PDFiumExt_GetFileWriterData(writer, outputPointer, size);
        const output = module.HEAPU8.slice(outputPointer, outputPointer + size);
        module.wasmExports.free(outputPointer);
        return output;
      } finally { library.PDFiumExt_CloseFileWriter(writer); }
    } finally {
      try { library.FPDF_CloseDocument(documentHandle); module.wasmExports.free(pointer); } catch {}
    }
  }

  async function withDocument(bytes, operation) {
    const library = await get();
    const module = library.pdfium;
    const pointer = module.wasmExports.malloc(bytes.length);
    if (!pointer) { reset(); throw new Error('메모리 부족 — 파일이 너무 큽니다 (엔진 재시작됨)'); }
    module.HEAPU8.set(bytes, pointer);
    const documentHandle = library.FPDF_LoadMemDocument(pointer, bytes.length, 0);
    if (!documentHandle) {
      module.wasmExports.free(pointer);
      throw new Error('PDFium이 문서를 열지 못했습니다');
    }
    try { return await operation(library, module, documentHandle); }
    catch (error) {
      if (/out of bounds|memory|table index/i.test(error.message || '')) {
        reset();
        onEngineError(error);
      }
      throw error;
    } finally {
      try { library.FPDF_CloseDocument(documentHandle); module.wasmExports.free(pointer); } catch {}
    }
  }

  return Object.freeze({ get, getWasmBinary, decrypt, withDocument, reset });
}

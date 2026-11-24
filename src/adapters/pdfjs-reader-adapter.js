export async function createPdfJsReader({
  version,
  cdnBase,
  protocol,
  baseUri,
  importModule = specifier => import(specifier),
  warn = (...args) => console.warn(...args),
  moduleLoadTimeoutMs = 20000,
}) {
  const localBase = /^https?:$/.test(protocol)
    ? new URL(`assets/pdfjs/${version}/`, baseUri).href
    : null;
  const bases = localBase ? [localBase, cdnBase] : [cdnBase];
  let lastError = null;
  let loaded = null;
  for (const base of bases) {
    try {
      const specifier = base + 'legacy/build/pdf.min.mjs';
      let timer = null;
      const lib = await Promise.race([
        importModule(specifier),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(
            new Error(`PDF.js 모듈 로드 시간이 초과되었습니다: ${specifier}`)),
          Math.max(1000, Number(moduleLoadTimeoutMs) || 20000));
        }),
      ]).finally(() => clearTimeout(timer));
      loaded = { lib, base };
      break;
    } catch (error) {
      lastError = error;
      warn(`PDF.js ${version} 로드 실패: ${base}`, error);
    }
  }
  if (!loaded) throw lastError || new Error(`PDF.js ${version}을 불러오지 못했습니다`);
  if (loaded.lib.version !== version)
    throw new Error(`PDF.js 버전 불일치: ${loaded.lib.version || '알 수 없음'} (필요 ${version})`);

  loaded.lib.GlobalWorkerOptions.workerSrc = loaded.base + 'legacy/build/pdf.worker.min.mjs';
  const options = Object.freeze({
    isEvalSupported: false,
    enableScripting: false,
    cMapUrl: loaded.base + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: loaded.base + 'standard_fonts/',
    wasmUrl: loaded.base + 'wasm/',
    iccUrl: loaded.base + 'iccs/',
    useWasm: true,
  });
  return Object.freeze({
    lib: loaded.lib,
    base: loaded.base,
    openDocument(data) { return loaded.lib.getDocument({ data, ...options }); },
  });
}

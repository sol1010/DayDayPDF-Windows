export function createBrowserFileAdapter({
  windowObject,
  documentObject,
  urlApi,
  BlobConstructor,
  schedule = setTimeout,
  timeoutSchedule = setTimeout,
  cancelTimeout = clearTimeout,
}) {
  const supportsFileSystemAccess = 'showOpenFilePicker' in windowObject;
  const pdfTypes = [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }];

  async function pickOpenPdfFiles() {
    const handles = await windowObject.showOpenFilePicker({ multiple: true, types: pdfTypes });
    const files = [];
    for (const handle of handles) {
      const file = await handle.getFile();
      file._handle = handle;
      files.push(file);
    }
    return files;
  }

  function pickSavePdfHandle(options) {
    return windowObject.showSaveFilePicker(options);
  }

  function timeoutError(step) {
    const error = new Error(`${step} 작업이 응답하지 않아 중단했습니다.`);
    error.name = 'TimeoutError';
    return error;
  }

  async function withTimeout(promise, timeoutMs, step) {
    let timer = 0;
    try {
      return await Promise.race([
        Promise.resolve(promise),
        new Promise((_, reject) => {
          timer = timeoutSchedule(() => reject(timeoutError(step)), timeoutMs);
        }),
      ]);
    } finally {
      cancelTimeout(timer);
    }
  }

  async function writeFile(handle, bytes, options = {}) {
    let writable = null;
    try {
      const byteLength = Number(bytes?.byteLength ?? bytes?.size ?? 0);
      const createTimeoutMs = options.createTimeoutMs ?? 10000;
      const writeTimeoutMs = options.writeTimeoutMs ?? Math.max(
        30000,
        Math.ceil(byteLength / (5 * 1024 * 1024)) * 1000 + 15000,
      );
      const closeTimeoutMs = options.closeTimeoutMs ?? 15000;
      const verifyTimeoutMs = options.verifyTimeoutMs ?? 10000;
      const abortTimeoutMs = options.abortTimeoutMs ?? 1000;

      writable = await withTimeout(handle.createWritable(), createTimeoutMs, '파일 열기');
      await withTimeout(writable.write(bytes), writeTimeoutMs, '파일 쓰기');
      await withTimeout(writable.close(), closeTimeoutMs, '파일 저장 완료');
      writable = null;

      if (typeof handle.getFile === 'function' && Number.isFinite(byteLength)) {
        const savedFile = await withTimeout(handle.getFile(), verifyTimeoutMs, '저장 결과 확인');
        if (savedFile.size !== byteLength) {
          throw new Error(`저장 결과 확인 실패 (예상 ${byteLength}바이트, 실제 ${savedFile.size}바이트)`);
        }
      }
    } catch (error) {
      try {
        if (writable?.abort) await withTimeout(writable.abort(), abortTimeoutMs, '파일 쓰기 정리');
      } catch {}
      throw error;
    }
  }

  function downloadPdf(bytes, name) {
    const blob = new BlobConstructor([bytes], { type: 'application/pdf' });
    const anchor = documentObject.createElement('a');
    anchor.href = urlApi.createObjectURL(blob);
    anchor.download = name;
    anchor.click();
    schedule(() => urlApi.revokeObjectURL(anchor.href), 10000);
  }

  function captureDroppedFiles(items) {
    return [...items]
      .filter(item => item.kind === 'file')
      .map(item => ({
        file: item.getAsFile(),
        handlePromise: item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : null,
      }));
  }

  async function resolveDroppedFiles(entries) {
    const files = [];
    for (const entry of entries) {
      if (!entry.file) continue;
      try {
        const handle = await entry.handlePromise;
        if (handle && handle.kind === 'file') entry.file._handle = handle;
      } catch {}
      files.push(entry.file);
    }
    return files;
  }

  return Object.freeze({
    supportsFileSystemAccess,
    pickOpenPdfFiles,
    pickSavePdfHandle,
    writeFile,
    downloadPdf,
    captureDroppedFiles,
    resolveDroppedFiles,
  });
}

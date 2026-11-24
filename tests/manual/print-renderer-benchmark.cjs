const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..'), input = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]); fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><script src="/assets/windows-vendor/pdf-lib/1.17.1/pdf-lib.min.js"></script>'); return; }
  const file = name === '/fixture.pdf' ? input : path.resolve(root, '.' + name);
  if (name !== '/fixture.pdf' && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' }[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH });
  try {
    const page = await browser.newPage();
    await page.exposeFunction('saveResult', (name, encoded) => fs.writeFileSync(path.join(output, name), Buffer.from(encoded, 'base64')));
    await page.exposeFunction('report', result => console.log(JSON.stringify(result)));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const results = await page.evaluate(async () => {
      const { createRasterOutputFeature } = await import('/src/features/print-export/output-preparation.js');
      const pdfjs = await import('/assets/pdfjs/6.2.108/legacy/build/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/assets/pdfjs/6.2.108/legacy/build/pdf.worker.min.mjs';
      const bytes = new Uint8Array(await (await fetch('/fixture.pdf')).arrayBuffer());
      const loadingTask = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true });
      const doc = await loadingTask.promise;
      const module = await import('/assets/windows-vendor/pdfium/2.15.0/index.browser.js');
      const lib = await module.init({ wasmBinary: await (await fetch('/assets/windows-vendor/pdfium/2.15.0/pdfium.wasm')).arrayBuffer() });
      lib.PDFiumExt_Init();
      const heap = lib.pdfium, pointer = heap.wasmExports.malloc(bytes.length); heap.HEAPU8.set(bytes, pointer);
      const documentHandle = lib.FPDF_LoadMemDocument(pointer, bytes.length, 0);
      const pages = Array.from({ length: doc.numPages }, (_, idx) => ({ idx })), results = [];
      try {
        for (const engine of ['pdfjs', 'pdfium']) {
          let paintMs = 0, encodeMs = 0;
          const feature = createRasterOutputFeature({ pdfLib: PDFLib,
            getViewport: async p => (await doc.getPage(p.idx + 1)).getViewport({ scale: 1 }),
            createCanvas: () => {
              const canvas = document.createElement('canvas'), toBlob = canvas.toBlob.bind(canvas);
              canvas.toBlob = (callback, ...args) => { const start = performance.now(); toBlob(blob => { encodeMs += performance.now() - start; callback(blob); }, ...args); };
              return canvas;
            }, drawObjects: () => {},
            paintPage: async (p, canvas, scale) => {
              const started = performance.now(), source = await doc.getPage(p.idx + 1);
              const viewport = source.getViewport({ scale });
              canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
              if (engine === 'pdfjs') await source.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
              else {
                const nativePage = lib.FPDF_LoadPage(documentHandle, p.idx);
                const bitmap = lib.FPDFBitmap_Create(canvas.width, canvas.height, 0);
                try {
                  lib.FPDFBitmap_FillRect(bitmap, 0, 0, canvas.width, canvas.height, 0xffffffff);
                  lib.FPDF_RenderPageBitmap(bitmap, nativePage, 0, 0, canvas.width, canvas.height, 0, 0x811);
                  const at = lib.FPDFBitmap_GetBuffer(bitmap), stride = lib.FPDFBitmap_GetStride(bitmap);
                  if (stride !== canvas.width * 4) throw Error('Unexpected bitmap stride');
                  const rgba = new Uint8ClampedArray(heap.HEAPU8.slice(at, at + stride * canvas.height));
                  canvas.getContext('2d').putImageData(new ImageData(rgba, canvas.width, canvas.height), 0, 0);
                } finally { lib.FPDFBitmap_Destroy(bitmap); lib.FPDF_ClosePage(nativePage); }
              }
              paintMs += performance.now() - started;
            },
          });
          const started = performance.now();
          const { bytes: result } = await feature.buildPdf(pages, { scale: 300 / 72, fitWithin: [595.28, 841.89],
            type: 'image/jpeg', quality: .9, maxEdge: 6000, maxPixels: 16e6 });
          const entry = { engine, totalMs: performance.now() - started, paintMs, encodeMs, bytes: result.byteLength, pages: pages.length };
          results.push(entry); await report(entry);
          const encoded = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(new Blob([result])); });
          await saveResult(engine + '.pdf', encoded);
        }
        return results;
      } finally { lib.FPDF_CloseDocument(documentHandle); heap.wasmExports.free(pointer); await loadingTask.destroy(); }
    });
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());

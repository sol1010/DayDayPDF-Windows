const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const pdf = process.env.DRAWING_PDF;
if (!pdf) throw Error('Set DRAWING_PDF to a local drawing');
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.pdf': 'application/pdf' };
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), name = decodeURIComponent(url.pathname);
    if (name === '/') { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><div id="viewer" style="position:relative;width:100%;height:850px;overflow:auto"><div id="pg" style="position:relative"><canvas></canvas></div></div>'); }
    let body;
    if (name === '/drawing.pdf') body = fs.readFileSync(pdf);
    else {
      const baseline = name.startsWith('/baseline/');
      const relative = baseline ? name.slice('/baseline/'.length) : name.slice(1);
      const target = path.resolve(root, relative);
      if (!target.startsWith(root + path.sep)) throw Error('Invalid path');
      body = baseline ? execFileSync('git', ['show', 'HEAD:' + relative], { cwd: root, maxBuffer: 4e6 }) : fs.readFileSync(target);
    }
    res.setHeader('Content-Type', types[path.extname(name)] || 'application/octet-stream'); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH });
  try {
    const results = [];
    for (const baseline of [true, false]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const result = await page.evaluate(async ({ baseline, index }) => {
        const prefix = baseline ? '/baseline' : '';
        const { createTiledPageRenderer } = await import(prefix + '/src/rendering/tiled-page-renderer.js');
        const { createPagePainter } = await import(prefix + '/src/rendering/page-painter.js');
        const { createRenderCoordinator } = await import(prefix + '/src/rendering/render-coordinator.js');
        const { createPdfJsReader } = await import('/src/adapters/pdfjs-reader-adapter.js');
        const reader = await createPdfJsReader({ version: '6.2.108', cdnBase: '',
          protocol: location.protocol, baseUri: document.baseURI });
        const begin = performance.now();
        const bytes = new Uint8Array(await (await fetch('/drawing.pdf')).arrayBuffer());
        const loading = reader.openDocument(bytes);
        const doc = await loading.promise;
        const openMs = performance.now() - begin;
        const model = { src: 1, idx: Math.min(index, doc.numPages - 1), rot: 0, texts: [] };
        const getSource = () => ({ doc }), createCanvas = () => document.createElement('canvas');
        const painter = createPagePainter({ getSource, createCanvas });
        const coordinator = createRenderCoordinator({ createObserver: () => ({}), now: () => performance.now(), maxCacheBytes: 128 * 1024 * 1024 });
        const wrap = document.getElementById('pg'), viewer = document.getElementById('viewer');
        wrap.dataset.k = '0'; let paints = 0, previewMs = 0, started;
        const renderer = createTiledPageRenderer({ getPageAt: () => model, getZoom: () => 3, getSource,
          getViewport: painter.getViewport, getViewerRect: () => viewer.getBoundingClientRect(), createCanvas,
          paintPage: async (...args) => { paints++; await painter.paintPage(...args); previewMs = performance.now() - started; },
          paintRegion: async (...args) => { paints++; return painter.paintRegion(...args); },
          getDevicePixelRatio: () => 1, positionMarks() {}, buildLinkLayer() {}, repositionSearchHits() {}, enqueue() {},
          reportError: e => { throw e; }, cacheGet: coordinator.cacheGetReady || coordinator.cacheGet,
          cacheCanvas: coordinator.cacheCanvas, createBitmap: blob => createImageBitmap(blob),
        });
        const hash = async () => {
          const canvases = [...wrap.querySelectorAll('canvas')], parts = [];
          for (const c of canvases) {
            const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            const digest = await crypto.subtle.digest('SHA-256', pixels);
            parts.push(c.width + 'x' + c.height + ':' + [...new Uint8Array(digest)].join(','));
          }
          return parts.join('|');
        };
        started = performance.now(); await renderer.render(wrap, model, 3);
        const firstMs = performance.now() - started, firstPreviewMs = previewMs, firstPaints = paints, firstHash = await hash();
        renderer.releaseTiles(wrap, true); wrap._renderGen = (wrap._renderGen || 0) + 1;
        delete wrap.dataset.rendered; delete wrap.dataset.pageId;
        wrap.querySelector('canvas').width = wrap.querySelector('canvas').height = 0;
        (await doc.getPage(model.idx + 1)).cleanup();
        started = performance.now(); await renderer.render(wrap, model, 3);
        const revisitMs = performance.now() - started, secondHash = await hash();
        await loading.destroy();
        return { baseline, pages: doc.numPages, page: model.idx + 1, openMs, firstMs, previewMs: firstPreviewMs, revisitMs, firstPaints,
          revisitPaints: paints - firstPaints, identicalPixels: firstHash === secondHash, cacheBytes: coordinator.cacheBytes };
      }, { baseline, index: Number(process.env.DRAWING_PAGE_INDEX || 0) });
      console.log(JSON.stringify(result)); results.push(result); await page.close();
    }
    assert.equal(results[1].revisitPaints, 0, 'revisit must not replay PDF drawing operations');
    assert.ok(results[1].identicalPixels, 'cache must preserve every pixel');
    const output = path.join(root, 'tmp', 'drawing-cache-results.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(results, null, 2));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });

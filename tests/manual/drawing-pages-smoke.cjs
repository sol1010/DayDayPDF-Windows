const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createPrintResourceMonitor } = require("./print-resource-monitor.cjs");
const root = path.resolve(__dirname, "../.."), input = path.resolve(process.argv[2]), html = path.resolve(process.argv[3]), out = path.resolve(process.argv[4]);
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => {
  const route = decodeURIComponent(new URL(req.url, "http://localhost").pathname).slice(1);
  let f = route === "view.html" ? html : null;
  if (!f) for (const base of [path.join(root, "windows/PdfEditor.Preview/WebApp"), root]) {
    const c = path.resolve(base, route);
    if (c.startsWith(base + path.sep) && fs.existsSync(c) && fs.statSync(c).isFile()) {
      f = c;
      break;
    }
  }
  if (!f) {
    res.writeHead(404);
    return res.end();
  }
  res.setHeader("Content-Type", { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2" }[path.extname(f)] || "application/octet-stream");
  if (f === html) {
    let s = fs.readFileSync(f, "utf8").replaceAll("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js", "/assets/windows-vendor/pdf-lib/1.17.1/pdf-lib.min.js").replaceAll("https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js", "/assets/windows-vendor/fontkit/1.1.1/fontkit.umd.min.js").replaceAll("https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@2.15.0/dist/", "http://" + req.headers.host + "/assets/windows-vendor/pdfium/2.15.0/");
    s = s.replace("mountEditorControllers();", "window.drawingProbe={gotoPage, zoom:()=>editorStore.zoom, count:()=>editorStore.pages.length}; mountEditorControllers();");
    return res.end(s);
  }
  fs.createReadStream(f).pipe(res);
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH });
  let monitor;
  try {
    if (process.env.DRAWING_RESOURCES) monitor = await createPrintResourceMonitor(browser, path.join(root, "windows/PdfEditor.Output.Tests/bin/Release/net10.0-windows/PdfEditor.Output.Tests.dll"));
    const mobile = process.env.DRAWING_MOBILE === "1";
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 950 }, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile, bypassCSP: true });
    page.setDefaultTimeout(12e4);
    const errors = [], fallbacks = [];
    let wasmReads = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/pdfium.wasm")) wasmReads++;
    });
    page.on("console", (m) => {
      if (m.text().includes("Display worker fallback:")) fallbacks.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((hosted) => {
      localStorage.setItem("pdfEditor.startupMode", "blank");
      localStorage.setItem("pdfEditor.tutorialSeen", "1");
      const h = [];
      if (hosted) Object.defineProperty(window.chrome, "webview", { value: { addEventListener(t, f) {
        if (t === "message") h.push(f);
      }, removeEventListener() {
      }, releaseBuffer() {
      }, postMessage(m) {
        if (m.type === "view-ready") queueMicrotask(() => h.forEach((f) => f({ data: { cmd: "dismiss-boot-splash" } })));
      } } });
      window.longGaps = [];
      let last = performance.now();
      setInterval(() => {
        const n = performance.now();
        longGaps.push(n - last);
        last = n;
      }, 50);
      window.viewerPaints = [];
      window.displayWorkers = { alive: 0, peak: 0 };
      const W = Worker;
      window.Worker = class extends W {
        postMessage(m, ...rest) {
          if (m.type === "open" && !this.displayWorker) {
            this.displayWorker = true;
            displayWorkers.alive++;
            displayWorkers.peak = Math.max(displayWorkers.peak, displayWorkers.alive);
          }
          if (m.type === "paint") viewerPaints.push({ index: m.index, width: m.width, height: m.height });
          return super.postMessage(m, ...rest);
        }
        terminate() {
          if (this.displayWorker) {
            this.displayWorker = false;
            displayWorkers.alive--;
          }
          return super.terminate();
        }
      };
    }, !process.env.DRAWING_WEB);
    await page.goto("http://127.0.0.1:" + server.address().port + "/view.html");
    await page.locator("#appBootSplash").waitFor({ state: "hidden" });
    await page.locator("#fileInput").setInputFiles(input);
    await page.waitForFunction(() => drawingProbe.count() > 0);
    await page.waitForFunction(() => document.querySelector("#pg0")?.dataset.rendered);
    const results = [];
    if (monitor) await monitor.begin();
    await page.evaluate(() => {
      longGaps = [];
      viewerPaints = [];
    });
    for (const n of (process.env.DRAWING_PAGES || "28,29,30,31,28,29,30,31").split(",").map(Number)) {
      const started = Date.now();
      await page.evaluate((n2) => drawingProbe.gotoPage(n2), n);
      await page.waitForFunction((n2) => {
        const w = document.getElementById("pg" + (n2 - 1));
        return w?.dataset.rendered && !w._task && (!w._tiles || !w._tiles.cancelled);
      }, n);
      const elapsedMs = Date.now() - started;
      const pixels = await page.locator("#pg" + (n - 1) + " > canvas").evaluate(async (c) => {
        const b = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        return { width: c.width, height: c.height, hash: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b))).map((n2) => n2.toString(16).padStart(2, "0")).join("") };
      });
      const old = results.find((r) => r.page === n);
      if (old) assert.deepEqual(pixels, old.pixels, "revisit pixels page " + n);
      const entry = { page: n, elapsedMs, revisit: !!old, pixels };
      results.push(entry);
      console.log(JSON.stringify(entry));
      await page.screenshot({ path: path.join(out, "page-" + n + (old ? "-revisit" : "") + ".png") });
    }
    if (process.env.DRAWING_ZOOM) {
      await page.evaluate(() => {
        const z = document.getElementById("zoomInput");
        z.value = "400";
        z.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      const idx = results.at(-1).page - 1;
      await page.waitForFunction((idx2) => {
        const w = document.getElementById("pg" + idx2);
        return w?._tiles && !w._tiles.cancelled && w.dataset.rendered === w._tiles.key;
      }, idx);
      await page.screenshot({ path: path.join(out, "zoom-400.png") });
    }
    const resources = monitor ? await monitor.end() : null;
    if (process.env.DRAWING_IDLE) {
      await page.waitForFunction(() => document.querySelector(".thumb.current")?.dataset.rendered);
      await page.screenshot({ path: path.join(out, "thumbnails-ready.png") });
      await page.waitForFunction(() => displayWorkers.alive === 0, null, { timeout: 45e3 });
      assert.equal(wasmReads, 1, "PDFium engine bytes loaded only once");
    }
    const diagnostic = await page.evaluate(() => ({ maxUiGapMs: Math.max(...longGaps), viewerPaints, displayWorkers, zoom: drawingProbe.zoom() }));
    assert.deepEqual(errors, []);
    assert.deepEqual(fallbacks, []);
    assert.ok(diagnostic.displayWorkers.peak <= 1);
    diagnostic.wasmReads = wasmReads;
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ results, resources, diagnostic, errors }, null, 2));
    console.log(JSON.stringify({ resources: resources && { ...resources, samples: resources.samples.length }, diagnostic: { ...diagnostic, viewerPaints: diagnostic.viewerPaints.length } }));
  } finally {
    await monitor?.close();
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exitCode = 1;
});

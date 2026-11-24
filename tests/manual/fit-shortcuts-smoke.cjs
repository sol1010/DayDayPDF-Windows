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
    s = s.replace("mountEditorControllers();", "window.drawingProbe={gotoPage, setViewMode, state:()=>({current:editorStore.currentPage+1,zoom:editorStore.zoom,mode:viewMode}), count:()=>editorStore.pages.length}; mountEditorControllers();");
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
    const state = () => page.evaluate(() => {
      const view = document.getElementById("viewer"), vr = view.getBoundingClientRect();
      let visible = 0, best = -1, point = null;
      for (const w of view.querySelectorAll(".pageWrap")) {
        if (w.style.display === "none") continue;
        const r = w.getBoundingClientRect(), seen = Math.min(r.bottom, vr.bottom) - Math.max(r.top, vr.top);
        if (seen > best) {
          best = seen;
          visible = +w.dataset.k + 1;
          point = { x: (vr.left + view.clientWidth / 2 - r.left) / r.width, y: (vr.top + view.clientHeight / 2 - r.top) / r.height };
        }
      }
      return { ...drawingProbe.state(), visible, point, scrollTop: view.scrollTop };
    });
    const settle = async () => {
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.waitForTimeout(250);
    };
    for (const mode of (process.env.FIT_MODES || "scroll,single,double").split(",")) {
      await page.evaluate((mode2) => drawingProbe.setViewMode(mode2), mode);
      for (const n of (process.env.FIT_PAGES || "28,29,30,31").split(",").map(Number)) {
        for (const action of ["4", "3-4", "screen-width", "rapid"]) {
          await page.evaluate((n2) => drawingProbe.gotoPage(n2), n);
          if (mobile && mode === 'scroll') await page.locator('#pg' + (n - 1)).evaluate(w => w.scrollIntoView({ block: 'center' }));
          await settle();
          await page.keyboard.press("1");
          await settle();
          await page.locator("#btnFitPage").click();
          await settle();
          if (action === "3-4" || action === "rapid") {
            await page.keyboard.press("4");
            await settle();
          }
          const before = await state();
          assert.equal(before.current, n, "setup retained the target page");
          if (action === "screen-width") {
            await page.locator("#btnFitPage").click();
            await settle();
            await page.locator("#btnFit").click();
          } else if (action === "rapid") {
            for (let i = 0; i < 6; i++) {
              await page.keyboard.press("3");
              await page.keyboard.press("4");
            }
          } else {
            for (const key of action.split("-")) {
              await page.keyboard.press(key);
              await settle();
            }
          }
          await settle();
          const after = await state();
          const passed = before.current === after.current && (mode !== "scroll" || before.visible === after.visible);
          const result = { mode, page: n, action, before, after, passed };
          results.push(result);
          console.log(JSON.stringify({ mode, page: n, action, before: before.current, after: after.current, visible: after.visible, passed }));
          if (!passed && !process.env.FIT_BASELINE) throw Error("Fit changed page: " + JSON.stringify(result));
        }
      }
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ results, errors }, null, 2));
    await page.screenshot({ path: path.join(out, "settled.png") });
    console.log("Fit cases: " + results.length + ", failures: " + results.filter((r) => !r.passed).length);
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

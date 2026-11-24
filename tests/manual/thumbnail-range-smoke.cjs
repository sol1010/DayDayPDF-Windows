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
    s = s.replace("mountEditorControllers();", "window.drawingProbe={gotoPage, setViewMode, state:()=>({selected:[...editorStore.selectedPages].sort((a,b)=>a-b).map(k=>k+1),anchor:editorStore.lastSelected+1,dirty:editorStore.activeDocument.dirty,undo:editorStore.undoStack.length}), count:()=>editorStore.pages.length}; mountEditorControllers();");
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
    await page.evaluate(()=>{
      window.firstThumbnailRange = new Promise(resolve=>{
        const sidebar=document.querySelector('#sidebar');
        const observer=new MutationObserver(()=>{
          const target=sidebar.querySelector('.thumb[data-k="4"]');
          if (!target) return;
          observer.disconnect();
          const pending=!target.dataset.rendered;
          target.dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));
          resolve({pending,...drawingProbe.state()});
        });
        observer.observe(sidebar,{childList:true,subtree:true});
      });
    });
    await page.locator("#fileInput").setInputFiles(input);
    const first=await page.evaluate(()=>window.firstThumbnailRange);
    assert.equal(first.pending,true);
    assert.deepEqual(first.selected,[1,2,3,4,5],'Shift as first click while thumbnails load');
    assert.equal(first.anchor,1);
    await page.waitForFunction(() => drawingProbe.count() > 0);
    await page.waitForFunction(() => document.querySelector("#pg0")?.dataset.rendered);
    const results=[];
    const state=()=>page.evaluate(()=>drawingProbe.state());
    if (mobile) await page.locator('#btnThumbs').click();
    async function click(n,modifier) {
      const target=page.locator('.thumb[data-k="'+(n-1)+'"]');
      await target.scrollIntoViewIfNeeded();
      if (modifier) await page.keyboard.down(modifier);
      await target.click();
      if (modifier) await page.keyboard.up(modifier);
    }
    async function expect(label,expected) {
      const actual=await state();
      assert.deepEqual(actual.selected,expected,label);
      assert.equal(actual.dirty,false); assert.equal(actual.undo,0);
      results.push({label,expected,actual,passed:true}); console.log('PASS '+label);
    }
    await click(3,'Shift'); await expect('opening range shrinks after rendering',[1,2,3]);
    await page.keyboard.press('Shift+ArrowDown'); await expect('keyboard continues from clicked end',[1,2,3,4]);
    await page.keyboard.press('Shift+ArrowDown'); await expect('keyboard extends again',[1,2,3,4,5]);
    await page.keyboard.press('Shift+ArrowUp'); await expect('keyboard shrinks',[1,2,3,4]);
    for(const mode of ['scroll','single','double']) {
      await page.evaluate(m=>drawingProbe.setViewMode(m),mode);
      await click(3); await click(8,'Shift'); await expect(mode+' extend',[3,4,5,6,7,8]);
      await click(5,'Shift'); await expect(mode+' shrink',[3,4,5]);
      await click(1,'Shift'); await expect(mode+' reverse',[1,2,3]);
      await click(3,'Shift'); await expect(mode+' anchor only',[3]);
      await click(10,'Control'); await expect(mode+' Ctrl adds individual',[3,10]);
      await click(10,'Control'); await expect(mode+' Ctrl removes individual',[3]);
      await click(7,'Shift'); await expect(mode+' new anchor',[7,8,9,10]);
      await click(9,'Shift'); await expect(mode+' reverse shrink',[9,10]);
      assert.equal((await state()).anchor,10);
    }
    await page.reload(); await page.locator('#appBootSplash').waitFor({state:'hidden'});
    await page.locator('#fileInput').setInputFiles(input);
    await page.waitForFunction(()=>drawingProbe.count()>=10 && document.querySelector('#pg0')?.dataset.rendered);
    await page.evaluate(()=>{drawingProbe.setViewMode('single');drawingProbe.gotoPage(6);});
    if (mobile) await page.locator('#btnThumbs').click();
    await expect('freshly opened document before thumbnail selection',[]);
    await click(3,'Shift'); await expect('first Shift click from current page',[3,4,5,6]);
    await page.keyboard.press('Shift+ArrowUp'); await expect('reverse keyboard extension',[2,3,4,5,6]);
    await page.keyboard.press('Shift+Home'); await expect('keyboard to start',[1,2,3,4,5,6]);
    const total=await page.evaluate(()=>drawingProbe.count());
    await page.keyboard.press('Shift+End'); await expect('keyboard across anchor',Array.from({length:total-5},(_,i)=>i+6));
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ results, errors }, null, 2));
    await page.screenshot({ path: path.join(out, "settled.png") });
    console.log("Selection cases: " + results.length + ", failures: " + results.filter((r) => !r.passed).length);
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

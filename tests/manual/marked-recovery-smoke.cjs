const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createPrintResourceMonitor } = require("./print-resource-monitor.cjs");
const root = path.resolve(__dirname, "../.."), input = path.resolve(process.argv[2]), html = path.resolve(process.argv[3]), out = path.resolve(process.argv[4]);
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => {
  if(req.method==='POST' && req.url==='/roundtrip.pdf') {
    const stream=fs.createWriteStream(path.join(out,'roundtrip.pdf'));req.pipe(stream);
    stream.on('finish',()=>{res.writeHead(200);res.end('ok');});return;
  }
  const route = decodeURIComponent(new URL(req.url, "http://localhost").pathname).slice(1);
  let f = route === "view.html" ? html : route === "input.pdf" ? input : route === "roundtrip.pdf" ? path.join(out,"roundtrip.pdf") : null;
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
    s = s.replace("mountEditorControllers();", "window.drawingProbe={gotoPage, setViewMode, recovery:()=>editorStore.pages.map((p,i)=>({page:i+1,objects:p.texts})).filter(x=>x.objects.length), export:async()=>{const bytes=await buildPdf(editorStore.pages);await fetch('/roundtrip.pdf',{method:'POST',body:bytes});return bytes.length;}, pixels:async(url,index)=>{const bytes=new Uint8Array(await (await fetch(url)).arrayBuffer());return withPdfiumDoc(bytes,async(F,M,doc)=>{const pg=F.FPDF_LoadPage(doc,index);let bitmap=0;try{const w=Math.round(F.FPDF_GetPageWidth(pg)),h=Math.round(F.FPDF_GetPageHeight(pg));bitmap=F.FPDFBitmap_Create(w,h,0);F.FPDFBitmap_FillRect(bitmap,0,0,w,h,0xffffffff);F.FPDF_RenderPageBitmap(bitmap,pg,0,0,w,h,0,0x11);const ptr=F.FPDFBitmap_GetBuffer(bitmap),stride=F.FPDFBitmap_GetStride(bitmap);const data=M.HEAPU8.slice(ptr,ptr+stride*h);return {w,h,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(n=>n.toString(16).padStart(2,'0')).join('')};}finally{if(bitmap)F.FPDFBitmap_Destroy(bitmap);if(pg)F.FPDF_ClosePage(pg);}});}, count:()=>editorStore.pages.length, engine:async()=>{const t=performance.now();await getPdfium();return performance.now()-t;}, metadata:async()=>sources.values().next().value.doc.getMetadata(), scan:async(n)=>{const p=editorStore.pages[n-1],t=performance.now();const x=await origScanPage(p);return {ms:performance.now()-t,objects:x.objs.length,annots:x.annots.length}}, decorate:async(n)=>{origMode=true;const t=performance.now();await origDecorate(document.getElementById('pg'+(n-1)));return {ms:performance.now()-t,ghosts:document.querySelectorAll('.origGhost').length};}}; mountEditorControllers();");
    s=s.replace("const np = F.FPDF_GetPageCount(doc);", "const np = F.FPDF_GetPageCount(doc); console.log('PROBE marked pages '+np);");
    s=s.replace("const pg = F.FPDF_LoadPage(doc, pi);", "console.log('PROBE marked load '+pi); const pg = F.FPDF_LoadPage(doc, pi); console.log('PROBE marked loaded '+pi);");
    s=s.replace("const n = F.FPDFPage_CountObjects(pg);", "const n = F.FPDFPage_CountObjects(pg); console.log('PROBE objects '+n);");
    return res.end(s);
  }
  fs.createReadStream(f).pipe(res);
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH });
  const watchdog=setTimeout(()=>{console.error("PROBE overall timeout");browser.close().catch(()=>{});},75000);
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
    page.on("pageerror", (e) => {errors.push(e.message); console.log("Page error: "+e.message);});
    page.on("console", m=>{if(m.text().startsWith("PROBE")) console.log(m.text());});
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
    const openedAt=Date.now();
    await page.evaluate(()=>{
      const spinner=document.getElementById('spinner');
      new MutationObserver(()=>console.log('PROBE spinner '+spinner.className+' '+spinner.textContent)).observe(spinner,{attributes:true,childList:true,subtree:true});
    });
    await page.locator("#fileInput").setInputFiles(input,{timeout:30000});
    await page.waitForFunction(() => drawingProbe.count() > 0, null, {timeout:30000}).catch(async error=>{await page.screenshot({path:path.join(out,"blocked.png")});console.log("PROBE body "+await page.locator("body").innerText());throw error;});
    console.log("PROBE pages available after "+(Date.now()-openedAt)+" ms");
    await page.waitForFunction(() => document.querySelector("#pg0")?.dataset.rendered, null, {timeout:30000}).catch(async error=>{await page.screenshot({path:path.join(out,"render-blocked.png")});throw error;});
    const results=[{openMs:Date.now()-openedAt,metadata:await page.evaluate(()=>drawingProbe.metadata())}];
    console.log(JSON.stringify(results[0]));
    const restored=await page.evaluate(()=>drawingProbe.recovery());
    assert.equal(restored.length,1);assert.equal(restored[0].page,35);assert.equal(restored[0].objects.length,1);assert.equal(restored[0].objects[0].type,'rect');
    const savedBytes=await page.evaluate(()=>drawingProbe.export());
    const pixels=[];
    for(const n of [1,25,33,35,46]) {
      const original=await page.evaluate(n=>drawingProbe.pixels('/input.pdf',n-1),n);
      const saved=await page.evaluate(n=>drawingProbe.pixels('/roundtrip.pdf',n-1),n);
      assert.deepEqual(saved,original,'round-trip pixels page '+n);pixels.push({page:n,...saved});console.log('PASS pixels page '+n);
    }
    results.push({restored,savedBytes,pixels});
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ results, errors }, null, 2));
    await page.screenshot({ path: path.join(out, "settled.png") });
    console.log("Probe stages: " + results.length + ", failures: " + 0);
  } finally {
    clearTimeout(watchdog);
    await monitor?.close();
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exitCode = 1;
});

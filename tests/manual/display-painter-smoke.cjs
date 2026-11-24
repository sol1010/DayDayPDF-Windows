var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { PDFDocument, rgb, degrees } = require("pdf-lib");
const root = path.resolve(__dirname, "../.."), out = path.join(root, "tmp/drawing-0009-probe/geometry");
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => {
  const n = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (n === "/") {
    res.setHeader("Content-Type", "text/html");
    return res.end("<!doctype html>");
  }
  const f = path.resolve(root, "." + n);
  if (!f.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  res.setHeader("Content-Type", { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm" }[path.extname(f)] || "application/octet-stream");
  fs.createReadStream(f).on("error", () => res.end()).pipe(res);
});
(async () => {
  const doc = await PDFDocument.create();
  for (const rot of [0, 90, 180, 270]) {
    const p = doc.addPage([400, 300]);
    p.drawRectangle({ x: 0, y: 0, width: 200, height: 150, color: rgb(1, 0, 0) });
    p.drawRectangle({ x: 200, y: 0, width: 200, height: 150, color: rgb(0, 1, 0) });
    p.drawRectangle({ x: 0, y: 150, width: 200, height: 150, color: rgb(0, 0, 1) });
    p.drawRectangle({ x: 200, y: 150, width: 200, height: 150, color: rgb(1, 1, 0) });
    p.drawText("Top left", { x: 45, y: 245, size: 24, color: rgb(1, 1, 1) });
    p.drawCircle({ x: 275, y: 95, size: 35, color: rgb(0.3, 0.4, 0.5) });
    p.setCropBox(40, 30, 320, 240);
    p.setRotation(degrees(rot));
  }
  const bytes = await doc.save();
  fs.writeFileSync(path.join(out, "geometry.pdf"), bytes);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH });
  try {
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:" + server.address().port);
    const results = await page.evaluate(async (outputTiles) => {
      const { createPdfJsReader } = await import("/src/adapters/pdfjs-reader-adapter.js"), { createPagePainter } = await import("/src/rendering/page-painter.js"), { createDisplayPainter } = await import("/src/rendering/display-painter.js");
      const reader = await createPdfJsReader({ version: "6.2.108", cdnBase: "", protocol: location.protocol, baseUri: document.baseURI });
      const bytes2 = new Uint8Array(await (await fetch("/tmp/drawing-0009-probe/geometry/geometry.pdf")).arrayBuffer()), loading = reader.openDocument(bytes2.slice()), doc2 = await loading.promise, source = { bytes: bytes2, doc: doc2 }, createCanvas = () => document.createElement("canvas");
      const painter = createPagePainter({ getSource: () => source, createCanvas }), fast = createDisplayPainter({ painter, getSource: () => source, getWasmBinary: async () => await (await fetch("/assets/windows-vendor/pdfium/2.15.0/pdfium.wasm")).arrayBuffer(), pdfiumCdn: location.origin + "/assets/windows-vendor/pdfium/2.15.0/", createWorker: () => new Worker("/src/workers/display-raster-worker.js", { type: "module" }), warn: () => {
        throw Error("Unexpected fallback");
      } });
      const results2 = [];
      try {
        for (let idx = 0; idx < 4; idx++) for (const rot of [0, 90, 180, 270]) for (const transform of (outputTiles ? [{}, { crop: [.1,.15,.7,.6] }] : [{}, { crop: [0.1, 0.15, 0.7, 0.6] }, { resize: [450, 500] }, { resize: [450, 500], crop: [0.1, 0.15, 0.7, 0.6] }])) for (const tiled of (outputTiles ? [false] : [false, true])) {
          const model = { src: 1, idx, rot, ...transform }, vp = await painter.getViewport(model, 1), region = tiled ? { x: vp.width * 0.13, y: vp.height * 0.21, width: vp.width * 0.55, height: vp.height * 0.44 } : null, a = createCanvas(), b = createCanvas();
          const scale = outputTiles ? Math.sqrt(1e7 / vp.width / vp.height) : 1.73;
          await painter.paintRegion(model, a, scale, 1, region);
          if (outputTiles) await fast.paintOutputPage(model, b, scale);
          else await fast.paintRegion(model, b, scale, 1, region);
          if (a.width !== b.width || a.height !== b.height) throw Error("dimension mismatch");
          const aa = a.getContext("2d").getImageData(0, 0, a.width, a.height).data, bb = b.getContext("2d").getImageData(0, 0, b.width, b.height).data;
          let sum = 0, bad = 0;
          for (let i = 0; i < aa.length; i += 4) {
            let d = 0;
            for (let c = 0; c < 3; c++) {
              const e = Math.abs(aa[i + c] - bb[i + c]);
              sum += e;
              d = Math.max(d, e);
            }
            if (d > 80) bad++;
          }
          results2.push({ idx, rot, ...transform, tiled, mean: sum / (a.width * a.height * 3), badFraction: bad / (a.width * a.height) });
          a.width = b.width = a.height = b.height = 0;
        }
      } finally {
        fast.shutdown();
        await loading.destroy();
      }
      return results2;
    }, !!process.env.OUTPUT_TILES);
    fs.writeFileSync(path.join(out, process.env.OUTPUT_TILES ? "output-tiles-results.json" : "results.json"), JSON.stringify(results, null, 2));
    for (const r of results) assert.ok(r.badFraction < 0.025, JSON.stringify(r));
    console.log(JSON.stringify({ cases: results.length, acceleratedCases: results.filter((r) => !r.resize).length, worstMean: Math.max(...results.map((r) => r.mean)), worstMismatchFraction: Math.max(...results.map((r) => r.badFraction)) }));
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exitCode = 1;
});

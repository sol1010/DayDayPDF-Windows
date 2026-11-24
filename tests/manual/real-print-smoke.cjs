const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { createPrintResourceMonitor } = require('./print-resource-monitor.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { PDFDocument, PDFRawStream, PDFName } = require('pdf-lib');
const root = path.resolve(__dirname, '../..');
const input = path.resolve(process.argv[2]), html = path.resolve(process.argv[3]);
const output = path.resolve(process.argv[4]);
fs.mkdirSync(output, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const route = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1);
  let file = route === 'view.html' ? html : route === 'fixture.pdf' ? input : null;
  if (!file) for (const base of [path.join(root, 'windows/PdfEditor.Preview/WebApp'), root]) {
    const candidate = path.resolve(base, route);
    if (candidate.startsWith(base + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) { file = candidate; break; }
  }
  if (!file) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  if (path.extname(file) === '.html') {
    res.end(fs.readFileSync(file, 'utf8')
      .replaceAll('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js', '/assets/windows-vendor/pdf-lib/1.17.1/pdf-lib.min.js')
      .replaceAll('https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js', '/assets/windows-vendor/fontkit/1.1.1/fontkit.umd.min.js')
      .replaceAll('https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@2.15.0/dist/', '/assets/windows-vendor/pdfium/2.15.0/'));
    return;
  }
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH });
  let monitor;
  try {
    if (process.env.PRINT_RESOURCES) monitor = await createPrintResourceMonitor(browser, path.join(root, 'windows/PdfEditor.Output.Tests/bin/Release/net10.0-windows/PdfEditor.Output.Tests.dll'));
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    page.setDefaultTimeout(300000);
    const errors = [], results = [], diagnostics = [];
    page.on('console', message => { const text = message.text(); if (text.startsWith('[DaydayPDF print] ')) diagnostics.push(JSON.parse(text.slice('[DaydayPDF print] '.length))); });
    await page.exposeFunction('readPrintResources', () => monitor?.memory || { availablePhysicalBytes: require('node:os').freemem(), availableCommitBytes: require('node:os').freemem(), memoryLoadPercent: 50 });
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('capturePrint', async (encoded, options) => {
      const data = Buffer.from(encoded, 'base64');
      fs.writeFileSync(path.join(output, options.mode + '.pdf'), data);
    });
    await page.addInitScript(() => {
      localStorage.setItem('pdfEditor.startupMode', 'blank');
      localStorage.setItem('pdfEditor.tutorialSeen', '1');
      const handlers = new Map(), buffers = new Map();
      window.testMessages = []; window.testOutputs = [];
      window.testPressure = 'normal'; window.testResourceCalls = 0;
      window.testWorkerStats = { alive: 0, peak: 0 };
      const OriginalWorker = Worker;
      window.Worker = class extends OriginalWorker {
        postMessage(message, ...rest) {
          if (message.type === 'init' && message.pages) { this.printWorker = true; testWorkerStats.alive++; testWorkerStats.peak = Math.max(testWorkerStats.peak, testWorkerStats.alive); }
          return super.postMessage(message, ...rest);
        }
        terminate() { if (this.printWorker) { this.printWorker = false; testWorkerStats.alive--; } return super.terminate(); }
      };
      window.testDispatch = (type, event) => (handlers.get(type) || []).forEach(fn => fn(event));
      const reply = data => queueMicrotask(() => testDispatch('message', { data }));
      Object.defineProperty(window.chrome, 'webview', { value: {
        addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); },
        removeEventListener() {}, releaseBuffer() {},
        postMessage(message) {
          testMessages.push(message);
          if (message.type === 'view-ready') reply({ cmd: 'dismiss-boot-splash' });
          if (message.type === 'output-printers') reply({ cmd: 'output-result', requestId: message.requestId, ok: true,
            printers: [{ name: 'Local test sink', isDefault: true, isPdf: false }] });
          if (message.type === 'output-resources') {
            if (message.action === 'sample') testResourceCalls++;
            readPrintResources().then(memory => {
              if (testPressure === 'low' || testPressure === 'downgrade' && testResourceCalls >= 6)
                memory = { ...memory, availablePhysicalBytes: 1024 ** 3, memoryLoadPercent: 90 };
              reply({ cmd: 'output-result', requestId: message.requestId, ok: true, memory });
            });
          }
          if (message.type === 'output-put') {
            const buffer = new ArrayBuffer(message.size); buffers.set(message.requestId, { buffer, options: message });
            queueMicrotask(() => testDispatch('sharedbufferreceived', { additionalData: { cmd: 'output-buffer', requestId: message.requestId }, getBuffer: () => buffer }));
          }
          if (message.type === 'output-put-done') {
            const item = buffers.get(message.requestId); buffers.delete(message.requestId);
            const reader = new FileReader();
            reader.onload = async () => {
              await capturePrint(reader.result.split(',')[1], { ...item.options, mode: window.testPrintMode });
              testOutputs.push({ size: item.buffer.byteLength, options: item.options });
              reply({ cmd: 'output-result', requestId: message.requestId, ok: true });
            };
            reader.readAsDataURL(new Blob([item.buffer]));
          }
        },
      } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/view.html?tab=print-fixture`);
    await page.locator('#appBootSplash').waitFor({ state: 'hidden' });
    if (process.env.PRINT_UI_ONLY) {
      await page.locator('#fileInput').setInputFiles(input);
      await page.waitForFunction(() => document.querySelector('#pg0 canvas')?.width > 100);
      const modes = await page.locator('#btnReaderMode').count() ? ['editor', 'viewer'] : ['editor'];
      for (const mode of modes) {
        if (mode === 'viewer') await page.locator('#btnReaderMode').click();
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 950 });
          await page.keyboard.press('Control+p');
          await page.locator('#prMode').selectOption('image');
          assert.match(await page.locator('#prInfo').textContent(), /^\d+ 개 페이지 인쇄$/);
          await page.locator('#prInfo').scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(output, `${mode}-${width}.png`) });
          await page.locator('#prCancel').click();
        }
      }
      assert.deepEqual(errors, []);
      console.log('PASS shared web print dialog: ' + modes.join(', ') + ', desktop/mobile image hint and reachable cancel');
      return;
    }
    await page.evaluate(async () => {
      const buffer = await (await fetch('/fixture.pdf')).arrayBuffer();
      testDispatch('sharedbufferreceived', { additionalData: { cmd: 'open-document', name: 'print-fixture.pdf', requestId: 'fixture' }, getBuffer: () => buffer });
    });
    await page.waitForFunction(() => testMessages.some(m => m.type === 'document-ready' && m.ok));
    if (process.env.PRINT_EDIT_TEST) await page.locator('#btnRotR').click();
    const cases = process.env.PRINT_SCENARIOS
      ? process.env.PRINT_SCENARIOS.split(',').map(name => ({ mode: 'image', name }))
      : (process.env.PRINT_MODES || 'pdf,image').split(',').map(mode => ({ mode, name: mode }));
    for (const { mode, name } of cases) {
      await page.keyboard.press('Control+p');
      await page.locator('#prPrinter').selectOption('Local test sink');
      await page.locator('#prMode').selectOption(mode);
      await page.locator('#prOrient').selectOption('auto');
      await page.locator('#prPaper').selectOption('a4');
      await page.locator('#prColor').selectOption('color');
      await page.locator('#prCopies').fill('1');
      await page.evaluate(name => { window.testPrintMode = name; window.testPressure = name; window.testResourceCalls = 0; window.testWorkerStats = { alive: 0, peak: 0 }; }, name);
      if (monitor) await monitor.begin();
      const count = results.length, started = Date.now();
      await page.locator('#prOk').click();
      await page.waitForFunction(count => testOutputs.length > count, count);
      const elapsedMs = Date.now() - started, resources = monitor ? await monitor.end() : null, data = fs.readFileSync(path.join(output, name + '.pdf'));
      const document = await PDFDocument.load(data);
      const images = document.context.enumerateIndirectObjects().filter(([, value]) => value instanceof PDFRawStream && value.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
      assert.equal(document.getPageCount(), 52);
      if (mode === 'pdf' && !process.env.PRINT_EDIT_TEST) assert.deepEqual(data, fs.readFileSync(input), 'Unedited PDF mode must preserve exact bytes');
      else if (mode === 'pdf') assert.equal(document.getPage(0).getRotation().angle, 90);
      else assert.equal(images.length, 52);
      const workerStats = await page.evaluate(() => testWorkerStats);
      if (mode === 'image') { assert.equal(workerStats.alive, 0); assert.ok(workerStats.peak <= 2); }
      const diagnostic = mode === 'image' ? diagnostics.at(-1) : null;
      if (name === 'low') assert.equal(diagnostic.maxWorkers, 1);
      if (name === 'downgrade') { assert.equal(diagnostic.maxWorkers, 2); assert.equal(diagnostic.finalWorkers, 1); }
      const result = { mode, scenario: name, elapsedMs, resources, workerStats, diagnostic, pages: document.getPageCount(), bytes: data.length,
        imagePixels: images.reduce((sum, [, value]) => sum + value.dict.lookup(PDFName.of('Width')).asNumber() * value.dict.lookup(PDFName.of('Height')).asNumber(), 0) };
      results.push(result); console.log(JSON.stringify({ ...result, resources: resources && { ...resources, samples: resources.samples.length } }));
    }
    assert.deepEqual(errors, []);
    await page.keyboard.press('Control+p');
    await page.locator('#prMode').selectOption('image');
    await page.screenshot({ path: path.join(output, 'dialog-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'dialog-mobile.png') });
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  } finally { if (monitor) await monitor.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());

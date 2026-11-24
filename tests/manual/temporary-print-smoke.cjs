const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { PDFDocument } = require('../../node_modules/pdf-lib');
const repo = path.resolve(__dirname, '../..');
const output = path.resolve(repo, 'tmp/temporary-print-qa');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1);
  for (const root of [path.join(repo, 'windows/PdfEditor.Preview/WebApp'), repo]) {
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res); return;
  }
  res.writeHead(404); res.end();
});
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const handlers = new Map(), buffers = new Map();
      window.testMessages = []; window.testSaved = [];
      window.testSaveOutcome = 'cancel';
      window.testDispatch = (name, event) => (handlers.get(name) || []).forEach(handler => handler(event));
      const reply = data => queueMicrotask(() => testDispatch('message', { data }));
      Object.defineProperty(window.chrome, 'webview', { value: {
        addEventListener(name, handler) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(handler); },
        removeEventListener() {}, releaseBuffer() {}, postMessage(message) {
          testMessages.push(message);
          if (message.type === 'view-ready') reply({ cmd: 'dismiss-boot-splash' });
          if (message.type === 'save-put') {
            const buffer = new ArrayBuffer(message.size); buffers.set(message.requestId, { buffer, name: message.name });
            queueMicrotask(() => testDispatch('sharedbufferreceived', { additionalData: { cmd: 'save-buffer', requestId: message.requestId }, getBuffer: () => buffer }));
          }
          if (message.type === 'save-put-done') {
            const transfer = buffers.get(message.requestId); buffers.delete(message.requestId);
            if (testSaveOutcome === 'ok') {
              testSaved.push(Array.from(new Uint8Array(transfer.buffer)));
              reply({ cmd: 'save-result', requestId: message.requestId, ok: true, name: transfer.name, docPath: 'C:\\Saved\\' + transfer.name });
            } else reply({ cmd: 'save-result', requestId: message.requestId, ok: false,
              canceled: testSaveOutcome === 'cancel', error: 'QA simulated write failure' });
          }
        },
      } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/view.html?tab=temporary-print-qa`);
    await page.waitForFunction(() => testMessages.some(m => m.type === 'view-ready'));
    await page.locator('#appBootSplash').waitFor({ state: 'hidden' });
    const pdf = await PDFDocument.create(); pdf.addPage([595, 842]).drawText('Temporary print test');
    await page.evaluate(bytes => {
      const buffer = new Uint8Array(bytes).buffer;
      testDispatch('sharedbufferreceived', { additionalData: { cmd: 'open-document', name: '인쇄 문서.pdf', docPath: null, requestId: 'open' }, getBuffer: () => buffer });
    }, Array.from(await pdf.save()));
    await page.waitForFunction(() => testMessages.some(m => m.type === 'document-ready' && m.ok));
    if (await page.locator('.tutorialClose').isVisible()) await page.locator('.tutorialClose').click();
    const command = data => page.evaluate(data => testDispatch('message', { data }), data);
    const prompt = async (id, temporaryPrint = true) => {
      await command({ cmd: 'confirm-close', requestId: id, title: 'QA', temporaryPrint });
      await page.locator('#closeDocOverlay').waitFor({ state: 'visible' });
      for (const button of ['closeDocSave', 'closeDocSaveAs', 'closeDocOk', 'closeDocCancel'])
        assert.ok(await page.locator('#' + button).isVisible());
    };
    const result = async (type, id) => {
      await page.waitForFunction(({ type, id }) => testMessages.some(m => m.type === type && m.requestId === id), { type, id });
      return page.evaluate(({ type, id }) => testMessages.find(m => m.type === type && m.requestId === id), { type, id });
    };
    await prompt('cancel');
    await page.screenshot({ path: path.join(output, 'unsaved-print-close.png') });
    await page.keyboard.press('Escape');
    assert.equal((await result('close-confirmed', 'cancel')).choice, 'cancel');
    await prompt('discard'); await page.locator('#closeDocOk').click();
    assert.equal((await result('close-confirmed', 'discard')).choice, 'discard');
    await prompt('save'); await page.locator('#closeDocSave').click();
    assert.equal((await result('close-confirmed', 'save')).choice, 'save');
    for (const [key, choice] of [['y','save'], ['a','save-as'], ['n','discard'], ['x','cancel'], ['Escape','cancel']]) {
      await prompt('ordinary-' + key, false);
      await page.keyboard.press(key);
      assert.equal((await result('close-confirmed', 'ordinary-' + key)).choice, choice);
    }
    await prompt('hangul', false);
    await page.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown',
      { bubbles: true, cancelable: true, key: 'Process', code: 'KeyA' })));
    assert.equal((await result('close-confirmed', 'hangul')).choice, 'save-as');
    await page.setViewportSize({ width: 390, height: 844 });
    await prompt('mobile-save-as', false);
    await page.locator('#closeDocSaveAs').click();
    assert.equal((await result('close-confirmed', 'mobile-save-as')).choice, 'save-as');
    for (const saveAs of [false,true]) {
      for (const outcome of ['cancel', 'error', 'ok']) {
        const id = String(saveAs) + '-' + outcome;
        await page.evaluate(value => { testSaveOutcome = value; }, outcome);
        await command({ cmd: 'save-for-close', requestId: id, saveAs });
        assert.equal((await result('save-for-close-result', id)).ok, outcome === 'ok');
        assert.equal(await page.evaluate(() => testMessages.filter(m => m.type === 'save-put').at(-1).saveAs), saveAs);
        if (outcome === 'error') await page.locator('#saveErrorOk').click();
      }
    }
    const saved = await page.evaluate(() => testSaved);
    assert.equal(saved.length, 2);
    for (const bytes of saved) assert.equal((await PDFDocument.load(new Uint8Array(bytes))).getPageCount(), 1);
    assert.equal(await page.evaluate(() => testMessages.filter(m => m.type === 'save-put').length), 6);
    assert.deepEqual(errors, []);
    console.log('Desktop print UI: save/discard/cancel, canceled/failed/successful save completion, valid PDF bytes, ordinary close regression passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());

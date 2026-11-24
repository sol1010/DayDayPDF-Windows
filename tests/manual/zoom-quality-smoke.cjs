const fs = require('node:fs'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.ZOOM_TEST_ORIGIN || 'http://127.0.0.1:9976';
const output = process.env.ZOOM_TEST_OUTPUT || '../output/zoom-quality';
const pdf = process.env.ZOOM_QUALITY_PDF;
const pcHtml = process.env.ZOOM_TEST_HTML;
if (!pdf) throw Error('Set ZOOM_QUALITY_PDF to the local drawing');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH });
  const results = [];
  try {
    for (const profile of [{ name: 'desktop', width: 1440, height: 950, dpr: 1.5 },
      { name: 'mobile', width: 390, height: 844, dpr: 3 }]) {
      const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height },
        deviceScaleFactor: profile.dpr, isMobile: profile.name === 'mobile', hasTouch: true, bypassCSP: !!pcHtml });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(30000);
      if (pcHtml) await page.route(origin + '/editor/', route => route.fulfill({ contentType: 'text/html',
        body: fs.readFileSync(pcHtml, 'utf8').replaceAll('__APP_VER__', 'local-zoom-test')
          .replace(/(?<!\/)assets\/fontawesome\//g, '/assets/fontawesome/').replace(/(?<!\/)assets\/pdfjs\//g, '/assets/pdfjs/') }));
      await page.addInitScript(hosted => {
        localStorage.setItem('pdfEditor.startupMode', 'blank');
        localStorage.setItem('pdfEditor.tutorialSeen', '1'); localStorage.setItem('pdfEditor.readerTutorialSeen', '1');
        if (hosted) {
          const handlers = new Map();
          Object.defineProperty(window.chrome, 'webview', { value: {
            addEventListener(name, handler) {
              if (!handlers.has(name)) handlers.set(name, []);
              handlers.get(name).push(handler);
            },
            removeEventListener() {}, releaseBuffer() {},
            postMessage(message) {
              if (message.type === 'view-ready') queueMicrotask(() => {
                for (const handler of handlers.get('message') || [])
                  handler({ data: { cmd: 'dismiss-boot-splash' } });
              });
            },
          } });
        }
      }, !!pcHtml);
      await page.goto(origin + '/editor/');
      await page.locator('#appBootSplash').waitFor({ state: 'hidden' });
      await page.locator('#fileInput').setInputFiles(pdf);
      await page.waitForFunction(() => document.querySelector('#pg0 canvas')?.width > 100);
      const changeZoom = async value => page.evaluate(value => {
        const wrap = document.getElementById('pg0');
        const previous = [...wrap.querySelectorAll('.pageTiles canvas')].filter(c => c.width > 0);
        const input = document.getElementById('zoomInput'); input.value = String(value);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return { previous: previous.length, retained: previous.filter(c => c.isConnected && c.width > 0).length };
      }, value);
      const settled = async value => {
        await page.waitForFunction(value => {
          const w = document.getElementById('pg0');
          if (!w || w._task) return false;
          if (w._tiles) return !w._tiles.cancelled && !w._tileFallback && w.dataset.rendered === w._tiles.key &&
            w._tiles.key.includes(':' + value / 100 + ':');
          return w.dataset.rendered?.startsWith(value / 100 + ':');
        }, value);
      };
      const hashRaster = () => page.evaluate(async () => {
        const c = document.querySelector('#pg0 > canvas');
        const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        return { width: c.width, height: c.height, hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)))
          .map(x => x.toString(16).padStart(2, '0')).join('') };
      });
      const hasReaderMode = !pcHtml && await page.locator('#btnReaderMode').count() > 0;
      for (const mode of hasReaderMode ? ['editor', 'viewer'] : ['editor']) {
        if (mode === 'viewer') await page.locator('#btnReaderMode').click();
        await changeZoom(200); await settled(200);
        const retention = await changeZoom(400);
        assert.ok(retention.previous > 0, 'drawing uses visible tiles at 200%');
        assert.equal(retention.retained, retention.previous, `${profile.name}/${mode}: sharp pixels vanished on zoom`);
        await page.screenshot({ path: `${output}/${profile.name}-${mode}-during.png` });
        await settled(400);
        for (const value of [350, 500, 250, 800, 400]) {
          const current = await changeZoom(value);
          assert.equal(current.retained, current.previous);
          await page.waitForTimeout(20);
        }
        await settled(400);
        const state = await page.evaluate(() => {
          const w = document.getElementById('pg0');
          return { tiles: w._tiles.tiles.size, retained: !!w._tileFallback,
            pixels: [...w._tiles.tiles.values()].reduce((sum, c) => sum + c.width * c.height, 0),
            key: w._tiles.key, tabs: document.querySelectorAll('#tabStrip .dtab').length };
        });
        assert.ok(state.pixels <= 12000000); assert.equal(state.retained, false);
        await page.screenshot({ path: `${output}/${profile.name}-${mode}-settled.png` });
        await changeZoom(25); await settled(25);
        const fresh = await hashRaster(); await page.waitForTimeout(350);
        await changeZoom(100); await settled(100);
        await changeZoom(25); await settled(25);
        const cached = await hashRaster(); assert.deepEqual(cached, fresh, 'cache must restore identical RGBA pixels');
        if (mode === 'viewer') {
          assert.equal(await page.locator('#btnText').isVisible(), false);
          await page.locator('#btnReaderMode').click();
          assert.equal(await page.locator('#zoomInput').inputValue(), '25');
          assert.equal(await page.locator('#tabStrip .dtab').count(), state.tabs);
        }
        results.push({ profile: profile.name, mode, retention, state, losslessCache: fresh });
        console.log('PASS', profile.name, mode, JSON.stringify({ retention, pixels: state.pixels, key: state.key }));
      }
      assert.deepEqual(errors, []); await context.close();
    }
    fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

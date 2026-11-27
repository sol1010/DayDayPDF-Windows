const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, channel: process.env.BROWSER_PATH ? undefined : 'msedge' });
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="viewer" style="width:800px;height:600px"></main>');
    const source = fs.readFileSync(path.join(__dirname, '../../src/ui/editor/opening-reader.js'), 'utf8');
    await page.addScriptTag({ type: 'module', content: source + '\nwindow.startOpeningReader = startOpeningReader;' });
    await page.evaluate(() => {
      const bitmap = new OffscreenCanvas(32, 48);
      bitmap.getContext('2d').fillRect(0, 0, 32, 48);
      let release;
      const waitForPageTwo = new Promise(resolve => { release = resolve; });
      const pdf = {
        numPages: 3,
        getFieldObjects: async () => null,
        async getPage(number) {
          if (number === 2) await waitForPageTwo;
          return {
            getViewport: ({scale}) => ({ width: 32 * scale, height: 48 * scale }),
            render({canvasContext}) {
              canvasContext.fillStyle = '#ff0000';
              canvasContext.fillRect(0, 0, 8, 8);
              return {promise: Promise.resolve(), cancel() {}};
            },
          };
        },
      };
      window.reader = startOpeningReader(document.querySelector('main'), pdf, Promise.resolve(bitmap), text => text);
      window.releasePageTwo = release;
    });
    const first = page.locator('.firstRead[data-painted="1"] canvas');
    await first.waitFor();
    assert.deepEqual(await first.evaluate(c => [...c.getContext('2d').getImageData(0, 0, 1, 1).data]), [0,0,0,255]);
    await page.locator('.firstRead').focus();
    await page.keyboard.press('PageDown');
    await page.keyboard.press('PageDown');
    await page.locator('.firstRead[data-painted="3"] canvas').waitFor();
    const state = await page.evaluate(async () => {
      releasePageTwo();
      await new Promise(resolve => requestAnimationFrame(resolve));
      const { number, canvas } = reader.finish();
      return { number, red: canvas.getContext('2d').getImageData(0, 0, 1, 1).data[0], closed: !document.querySelector('.firstRead') };
    });
    assert.deepEqual(state, {number: 3, red: 255, closed: true});
    console.log('PASS opening bitmap, keyboard navigation, stale page cancellation and handoff');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

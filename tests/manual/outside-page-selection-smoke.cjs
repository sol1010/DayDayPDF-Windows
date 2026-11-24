const fs = require('node:fs'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const origin = process.env.CONTROLS_TEST_ORIGIN || 'http://127.0.0.1:9958';
const pc = process.env.CONTROLS_TEST_PC === '1', out = '../output/outside-selection-qa';
fs.mkdirSync(out, { recursive: true });
let html = fs.readFileSync('PDF편집기.html', 'utf8').replaceAll('__APP_VER__', 'selection-test')
  .replaceAll('assets/fontawesome/', '/assets/fontawesome/').replaceAll('assets/pdfjs/', '/assets/pdfjs/');
html = html.replace('mountEditorControllers();', `window.marqueeTest = {
  seed(native = false) {
    origClearSel(); deselectText();
    for (const [k, p] of editorStore.pages.entries()) {
      p.texts = native ? [] : [.15, .6].map(fx => ({ type:'rect', fx, fy:.35, fw:.2, fh:.2,
        stroke:'#2462af', fill:'#cfe5ff', sw:2 }));
      const wrap = document.getElementById('pg' + k); if (wrap) positionMarks(wrap, p);
    }
    focusViewer();
  },
  state() { return { added:selectedObjectEntries().length, original:origSels.length,
    page:selText?.k ?? origSels[0]?.k, undo:editorStore.undoStack.length, dirty:editorStore.activeDocument.dirty }; }
}; mountEditorControllers();`);
(async () => {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let k = 0; k < 2; k++) {
    const p = pdf.addPage([400, 450]);
    p.drawText('Original text', { x:60, y:240, size:16, font });
    p.drawRectangle({ x:240, y:210, width:80, height:60, color:rgb(.5,.7,.9) });
  }
  const buffer = Buffer.from(await pdf.save());
  const browser = await chromium.launch({ headless:true, executablePath:process.env.BROWSER_PATH });
  try { for (const width of [1280, 390]) {
    const mobile = width < 769, name = (pc ? 'pc' : 'web') + '-' + width;
    const context = await browser.newContext({ viewport:{width,height:1000}, hasTouch:mobile, isMobile:mobile, bypassCSP:true });
    await context.addInitScript(() => {
      localStorage.setItem('pdfEditor.startupMode', 'blank');
      for (const key of ['tutorialSeen', 'readerTutorialSeen']) localStorage.setItem('pdfEditor.' + key, '1');
    });
    await context.route('https://cdn.jsdelivr.net/npm/**', async route => {
      const url = route.request().url(); let file;
      if (url.endsWith('/pdf-lib.min.js')) file = 'node_modules/pdf-lib/dist/pdf-lib.min.js';
      else if (url.endsWith('/fontkit.umd.min.js')) file = 'node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js';
      else if (url.includes('/@embedpdf/pdfium@2.15.0/dist/')) file = 'assets/windows-vendor/pdfium/2.15.0/' + url.split('/').at(-1);
      if (file) return route.fulfill({ body:fs.readFileSync(file), contentType:file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', headers:{'access-control-allow-origin':'*'} });
      return route.continue();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(origin + '/editor/?selection-test', route => route.fulfill({body:html,contentType:'text/html'}));
    await page.goto(origin + '/editor/?selection-test');
    await page.waitForFunction(() => !!window.marqueeTest);
    await page.locator('#fileInput').setInputFiles({name:'Selection.pdf',mimeType:'application/pdf',buffer});
    await page.waitForFunction(() => document.querySelector('#pg0 canvas')?.width > 100);
    await page.locator('#zoomInput').fill(mobile ? '75' : '100'); await page.keyboard.press('Enter');
    await page.waitForFunction(w => Math.abs(document.querySelector('#pg0').getBoundingClientRect().width - w) < 1, mobile ? 300 : 400);
    const state = () => page.evaluate(() => marqueeTest.state());
    async function bounds(k = 0) {
      await page.locator('#pg' + k).evaluate(el => el.scrollIntoView({block:'center'}));
      return page.locator('#pg' + k).boundingBox();
    }
    async function activate() {
      await page.locator('#zoomInput').blur();
      if (!await page.locator('body').evaluate(el => el.classList.contains('multiPick'))) await page.keyboard.press('m');
    }
    async function drag(start, end, screenshot = false) {
      assert.equal(await page.evaluate(p => document.elementFromPoint(p.x,p.y)?.closest('.pageWrap') === null, start), true, 'gesture starts outside a page');
      const dimensions = await page.locator('#viewer').evaluate(el => [el.scrollWidth,el.scrollHeight]);
      await page.mouse.move(start.x,start.y); await page.mouse.down();
      await page.mouse.move(end.x,end.y,{steps:12});
      assert.equal(await page.locator('.origMarq').count(),1,'marquee is visible from the margin');
      assert.deepEqual(await page.locator('#viewer').evaluate(el => [el.scrollWidth,el.scrollHeight]),dimensions,'selection does not change scrollable size');
      if (screenshot) await page.screenshot({path:out+'/'+name+'.png'});
      await page.mouse.up();
      assert.equal(await page.locator('.origMarq').count(),0);
    }
    for (const side of ['left','right','top','bottom']) {
      await page.evaluate(() => marqueeTest.seed()); await activate();
      const r = await bounds(), before = await state();
      const start = {x:r.x-.0,y:r.y+r.height*.3}, end = {x:r.x+r.width*.85,y:r.y+r.height*.6};
      if (side === 'left') start.x = r.x-8;
      if (side === 'right') { start.x = r.x+r.width+8; end.x = r.x+r.width*.1; }
      if (side === 'top') { start.x = r.x+r.width*.1; start.y = r.y-8; }
      if (side === 'bottom') { start.x = r.x+r.width*.1; start.y = r.y+r.height+8; end.y = r.y+r.height*.3; }
      await drag(start,end,side === 'left');
      assert.equal((await state()).added,2,side+' margin selects both added objects');
      assert.equal((await state()).undo,before.undo); assert.equal((await state()).dirty,before.dirty);
    }
    await page.evaluate(() => marqueeTest.seed()); await activate();
    const second = await bounds(1);
    await drag({x:second.x+second.width*.1,y:second.y-8},{x:second.x+second.width*.85,y:second.y+second.height*.6});
    assert.equal((await state()).added,2); assert.equal((await state()).page,1);
    await page.evaluate(() => marqueeTest.seed()); await activate(); const r = await bounds();
    await page.mouse.move(r.x-8,r.y+r.height*.3); await page.mouse.down();
    await page.mouse.move(r.x+r.width*.85,r.y+r.height*.6,{steps:8});
    await page.keyboard.press('Escape'); assert.equal(await page.locator('.origMarq').count(),0);
    await page.mouse.up(); assert.equal((await state()).added,0);
    await activate(); await page.keyboard.down('Space');
    await page.mouse.move(r.x-8,r.y+r.height*.3); await page.mouse.down(); await page.mouse.move(r.x+12,r.y+r.height*.35);
    assert.equal(await page.locator('.origMarq').count(),0,'space panning takes priority');
    await page.mouse.up(); await page.keyboard.up('Space'); await page.keyboard.press('Escape');
    await page.evaluate(() => marqueeTest.seed(true)); await page.locator('#btnOrig').click();
    await page.waitForFunction(() => document.querySelectorAll('#pg0 .origGhost').length >= 2);
    await page.locator('#spinner.show').waitFor({state:'hidden'});
    const native = await bounds();
    await drag({x:native.x-8,y:native.y+native.height*.3},{x:native.x+native.width*.85,y:native.y+native.height*.6});
    await page.waitForFunction(() => marqueeTest.state().original === 2);
    await page.keyboard.press('Escape');
    if (!pc) {
      await page.locator('#btnReaderMode').click();
      await page.keyboard.press('m');
      const view = await bounds();
      await page.mouse.move(view.x-8,view.y+view.height*.3); await page.mouse.down();
      await page.mouse.move(view.x+view.width*.85,view.y+view.height*.6,{steps:8});
      assert.equal(await page.locator('.origMarq').count(),0,'viewer remains read-only'); await page.mouse.up();
    }
    assert.deepEqual(errors,[]); console.log('PASS '+name+' four margins, page gap, cancel, pan and original PDF objects');
    await context.close();
  }} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

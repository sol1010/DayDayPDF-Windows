const fs = require('node:fs'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { PDFDocument } = require('pdf-lib');
const origin = process.env.ARROW_TEST_ORIGIN || 'http://127.0.0.1:9947';
const pc = process.env.ARROW_TEST_PC === '1', out = '../output/arrow-head-touch-qa';
let html = fs.readFileSync('PDF편집기.html', 'utf8').replaceAll('__APP_VER__', 'arrow-head-test')
  .replaceAll('assets/fontawesome/', '/assets/fontawesome/').replaceAll('assets/pdfjs/', '/assets/pdfjs/');
html = html.replace('mountEditorControllers();', `window.arrowHeadTest = {
  seed(kind='arrow-filled', rotation=0) {
    editorStore.pages[0].texts = [
      {type:'rect', fx:.14, fy:.36, fw:.16, fh:.14, stroke:'#2462af', fill:'#cfe5ff', fillOp:1, sw:2, linkId:'anchor'},
      {type:'arrow', x1:.3, y1:.43, x2:.62, y2:.43, stroke:'#2462af', strokeOp:1, sw:2,
        attachTo:'anchor', attachPoint:'start', connectorAnchor:'side-midpoints', connectorStyle:'straight',
        arrowEndType:kind, arrowHeadSize:10, arrowHeadRotation:rotation}
    ];
    positionMarks(document.getElementById('pg0'),editorStore.pages[0]);
    selectOverlayObject(0,editorStore.pages[0].texts[1]);
  },
  snapshot() { return JSON.parse(JSON.stringify({objects:editorStore.pages[0].texts, undo:editorStore.undoStack.length})); }
}; mountEditorControllers();`);
const withoutSize = state => state.objects.map(object => { const copy = {...object}; delete copy.arrowHeadSize; return copy; });
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const pdf = await PDFDocument.create(); pdf.addPage([595, 842]); const buffer = Buffer.from(await pdf.save());
  const browser = await chromium.launch({headless:true, executablePath:process.env.BROWSER_PATH});
  try {
    for (const width of [390, 320, 1280]) {
      const mobile = width < 769, name = (pc ? 'pc' : 'web') + '-' + width;
      const context = await browser.newContext({viewport:{width,height:844},isMobile:mobile,hasTouch:mobile,bypassCSP:true});
      await context.addInitScript(() => {
        for (const key of ['tutorialSeen','readerTutorialSeen']) localStorage.setItem('pdfEditor.'+key,'1');
        localStorage.setItem('pdfEditor.startupMode','blank');
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route(origin+'/editor/?arrow-head-test', route => route.fulfill({contentType:'text/html',body:html}));
      await page.goto(origin+'/editor/?arrow-head-test');
      await page.waitForFunction(() => typeof arrowHeadTest !== 'undefined');
      await page.locator('#fileInput').setInputFiles({name:'Arrow.pdf',mimeType:'application/pdf',buffer});
      await page.waitForFunction(() => document.querySelector('#pg0 canvas')?.width > 100);
      await page.waitForTimeout(350);
      const cdp = await context.newCDPSession(page);
      async function drag(from, to) {
        if (!mobile) { await page.mouse.move(from.x,from.y); await page.mouse.down(); await page.mouse.move(to.x,to.y,{steps:10}); await page.mouse.up(); return; }
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
        for (let i=1;i<=10;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/10,y:from.y+(to.y-from.y)*i/10}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      }
      for (const kind of ['arrow-filled','arrow-open','circle-filled','circle-open','square']) {
        const rotation = mobile && kind === 'square' ? 90 : 0;
        await page.evaluate(({kind,rotation}) => arrowHeadTest.seed(kind,rotation),{kind,rotation});
        const handles = page.locator('.arrowHeadResize'); assert.equal(await handles.count(),2);
        const handle = handles.nth(1); assert.equal(await handle.isVisible(),true);
        const r = await handle.boundingBox(), from = {x:r.x+r.width/2,y:r.y+r.height/2};
        const hit = await page.evaluate(p=>{const e=document.elementFromPoint(p.x,p.y);return {head:e?.classList.contains('arrowHeadResize'),tag:e?.tagName,id:e?.id,cls:e?.className};},from);
        assert.equal(hit.head,true,JSON.stringify({name,kind,from,hit}));
        const before = await page.evaluate(() => arrowHeadTest.snapshot());
        const delta = rotation ? {x:-16,y:-32} : {x:-32,y:16};
        await drag(from,{x:from.x+delta.x,y:from.y+delta.y});
        const after = await page.evaluate(() => arrowHeadTest.snapshot());
        assert.ok(after.objects[1].arrowHeadSize > before.objects[1].arrowHeadSize,name+' '+kind+' did not resize');
        assert.deepEqual(withoutSize(after),withoutSize(before),'resizing must preserve positions and attachment');
        assert.equal(after.undo,before.undo+1,'one drag creates one undo step');
        if (kind === 'arrow-filled') await page.screenshot({path:out+'/'+name+'.png'});
        await page.locator('#btnUndo').click();
        assert.equal((await page.evaluate(()=>arrowHeadTest.snapshot())).objects[1].arrowHeadSize,10);
      }
      await page.evaluate(() => arrowHeadTest.seed());
      const input = page.locator('#tbArrowHead'); await input.evaluate(el=>el.scrollIntoView({block:'nearest',inline:'center'}));
      await input[mobile?'tap':'click'](); if (!mobile) await page.keyboard.press('Control+a');
      await page.keyboard.insertText('24'); await page.keyboard.press('Tab');
      assert.equal((await page.evaluate(()=>arrowHeadTest.snapshot())).objects[1].arrowHeadSize,24,'numeric input should replace the selected value');
      await page.evaluate(() => arrowHeadTest.seed('none'));
      assert.equal(await page.locator('.arrowHeadResize').count(),0); assert.equal(await input.isVisible(),false);
      if (!pc) { await page.evaluate(() => arrowHeadTest.seed()); await page.locator('#btnReaderMode').click(); assert.equal(await page.locator('.arrowHeadResize').count(),0); }
      assert.deepEqual(errors,[]); console.log('PASS '+name+': five head types, '+(mobile?'rotated touch drag, ':'mouse drag, ')+'fixed endpoints/attachment, single undo, numeric entry and no-head/viewer');
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode=1;});

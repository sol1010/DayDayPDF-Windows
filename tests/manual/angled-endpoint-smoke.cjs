const fs = require('node:fs'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { PDFDocument } = require('pdf-lib');
const origin = process.env.ARROW_ENDPOINT_TEST_ORIGIN || 'http://127.0.0.1:9958';
const pc = process.env.ARROW_ENDPOINT_TEST_PC === '1';
const out = '../output/angled-endpoint-qa';
let html = fs.readFileSync('PDF편집기.html', 'utf8').replaceAll('__APP_VER__', 'angled-endpoint-test')
  .replaceAll('assets/fontawesome/', '/assets/fontawesome/').replaceAll('assets/pdfjs/', '/assets/pdfjs/');
html = html.replace('mountEditorControllers();', `window.angledEndpointTest = {
  seed(kind) {
    if (typeof clearMobileResizeHandle === 'function') clearMobileResizeHandle();
    const arrow = {type:'arrow',x1:.3,y1:.42,x2:.65,y2:.42,stroke:'#2462af',strokeOp:1,sw:2,
      connectorStyle:'angled',arrowEndType:'arrow-filled',arrowHeadSize:10};
    if (kind === 'vertical') Object.assign(arrow,{x1:.5,y1:.3,x2:.5,y2:.6});
    if (kind === 'reverse') Object.assign(arrow,{x1:.65,x2:.3});
    if (kind === 'near-straight') arrow.y2 += .004;
    if (kind === 'tail-overlap') arrow.connectorAxis = 'y';
    if (kind === 'locked-overlap') Object.assign(arrow,{connectorBendX:arrow.x2,connectorBendY:arrow.y2});
    const objects = [];
    if (kind === 'attached') {
      objects.push({type:'rect',fx:.14,fy:.35,fw:.16,fh:.14,stroke:'#2462af',fill:'#cfe5ff',fillOp:1,sw:2,linkId:'anchor'});
      Object.assign(arrow,{attachTo:'anchor',attachPoint:'start',connectorAnchor:'side-midpoints'});
    }
    objects.push(arrow);
    editorStore.pages[0].texts = objects;
    positionMarks(document.getElementById('pg0'),editorStore.pages[0]);
    selectOverlayObject(0,arrow);
  },
  snapshot() {
    const arrow = editorStore.pages[0].texts.find(object=>object.type==='arrow');
    return JSON.parse(JSON.stringify({arrow,points:connectorPolyline(arrow),undo:editorStore.undoStack.length},
      (key,value)=>key==='_id'?undefined:typeof value==='number'?Math.round(value*1e12)/1e12:value));
  },
  select() { selectOverlayObject(0,editorStore.pages[0].texts.find(object=>object.type==='arrow')); }
}; mountEditorControllers();`);
function near(actual, expected, message) { assert.ok(Math.abs(actual-expected)<.0001, message+': '+actual+' != '+expected); }
(async () => {
  fs.mkdirSync(out,{recursive:true});
  const pdf = await PDFDocument.create(); pdf.addPage([595,842]); const buffer = Buffer.from(await pdf.save());
  const browser = await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
  try {
    for (const width of [1280,390,320]) {
      const mobile = width<769, name = (pc?'pc':'web')+'-'+width;
      const context = await browser.newContext({viewport:{width,height:950},isMobile:mobile,hasTouch:mobile,bypassCSP:true});
      await context.addInitScript(()=>{
        for(const key of ['tutorialSeen','readerTutorialSeen']) localStorage.setItem('pdfEditor.'+key,'1');
        localStorage.setItem('pdfEditor.startupMode','blank');
        localStorage.setItem('pdfEditor.barPin','0');
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route(origin+'/editor/?angled-endpoint-test',route=>route.fulfill({contentType:'text/html',body:html}));
      await page.goto(origin+'/editor/?angled-endpoint-test');
      await page.waitForFunction(()=>typeof angledEndpointTest!=='undefined');
      await page.locator('#fileInput').setInputFiles({name:'Angled arrow.pdf',mimeType:'application/pdf',buffer});
      await page.waitForFunction(()=>document.querySelector('#pg0 canvas')?.width>100);
      await page.waitForTimeout(350);
      const cdp = await context.newCDPSession(page);
      async function center(locator) {
        const r = await locator.boundingBox(); assert.ok(r,'missing handle');
        return {x:r.x+r.width/2,y:r.y+r.height/2};
      }
      async function drag(from,to) {
        if (!mobile) {
          await page.mouse.move(from.x,from.y); await page.mouse.down();
          await page.mouse.move(to.x,to.y,{steps:12}); await page.mouse.up(); return;
        }
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
        for(let i=1;i<=12;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{
          x:from.x+(to.x-from.x)*i/12,y:from.y+(to.y-from.y)*i/12}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      }
      for (const kind of ['horizontal','vertical','reverse','near-straight','locked-overlap','attached','tail-overlap']) {
        await page.evaluate(kind=>angledEndpointTest.seed(kind),kind);
        const key = kind==='tail-overlap'?'p1':'p2';
        const endpoint = page.locator('.connectorMark.sel .'+key);
        let from = await center(endpoint);
        const hit = await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.className,from);
        assert.ok(hit?.split(' ').includes(key),name+' '+kind+': endpoint intercepted by '+hit);
        const before = await page.evaluate(()=>angledEndpointTest.snapshot());
        if (mobile && await endpoint.getAttribute('data-mobile-handle')) {
          await endpoint.tap();
          assert.equal(await endpoint.evaluate(e=>e.classList.contains('mobile-active')),true);
          from = await center(endpoint);
        }
        const rect = await page.locator('#pg0').boundingBox();
        const delta = {x:kind==='reverse'?-40:40,y:55};
        await drag(from,{x:from.x+delta.x,y:from.y+delta.y});
        const after = await page.evaluate(()=>angledEndpointTest.snapshot());
        const moving = key==='p1'?'1':'2', fixed = key==='p1'?'2':'1';
        near(after.arrow['x'+moving],before.arrow['x'+moving]+delta.x/rect.width,name+' '+kind+' moving x');
        near(after.arrow['y'+moving],before.arrow['y'+moving]+delta.y/rect.height,name+' '+kind+' moving y');
        near(after.arrow['x'+fixed],before.arrow['x'+fixed],name+' '+kind+' fixed x');
        near(after.arrow['y'+fixed],before.arrow['y'+fixed],name+' '+kind+' fixed y');
        assert.equal(after.arrow.attachTo,before.arrow.attachTo,'attachment changed');
        if (key==='p2') assert.deepEqual(after.points[1],before.points[1],'head drag moved the elbow');
        assert.equal(after.undo,before.undo+1,'drag must create one undo step');
        if (kind==='horizontal') {
          const joint = page.locator('.connectorMark.sel .connectorBody.angled');
          assert.equal(await joint.count(),1,'separated joint should be available');
          from = await center(joint);
          const jointHit = await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.className,from);
          assert.ok(jointHit?.includes('connectorBody'),'separated joint not selectable');
          await drag(from,{x:from.x-35,y:from.y-25});
          const bent = await page.evaluate(()=>angledEndpointTest.snapshot());
          near(bent.arrow.x2,after.arrow.x2,'joint drag moved the head');
          near(bent.arrow.y2,after.arrow.y2,'joint drag moved the head');
          near(bent.arrow.connectorBendX,after.arrow.connectorBendX-35/rect.width,'joint x');
          near(bent.arrow.connectorBendY,after.arrow.connectorBendY-25/rect.height,'joint y');
          await page.locator('#btnUndo').click();
          assert.deepEqual((await page.evaluate(()=>angledEndpointTest.snapshot())).arrow,after.arrow,'undo joint');
          await page.screenshot({path:out+'/'+name+'.png'});
        }
        await page.locator('#btnUndo').click();
        assert.deepEqual((await page.evaluate(()=>angledEndpointTest.snapshot())).arrow,before.arrow,'undo endpoint');
        await page.locator('#btnRedo').click();
        assert.deepEqual((await page.evaluate(()=>angledEndpointTest.snapshot())).arrow,after.arrow,'redo endpoint');
      }
      if (!pc) {
        const before = await page.evaluate(()=>angledEndpointTest.snapshot());
        await page.locator('#btnReaderMode').click();
        assert.equal(await page.locator('.objHandle').count(),0,'viewer exposes editing handles');
        await page.locator('#btnReaderMode').click();
        await page.evaluate(()=>angledEndpointTest.select());
        assert.deepEqual(await page.evaluate(()=>angledEndpointTest.snapshot()),before,'mode switch changed arrow');
      }
      assert.deepEqual(errors,[]);
      console.log('PASS '+name+': seven endpoint overlap cases, separate joint drag, undo/redo, attachment and viewer');
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});

const fs = require('node:fs'), assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {PDFDocument, StandardFonts} = require('pdf-lib');
const origin = process.env.TUTORIAL_TEST_ORIGIN || 'http://127.0.0.1:9930';
const output = process.env.TUTORIAL_TEST_OUTPUT || '../output/tutorial-qa';
const source = process.env.TUTORIAL_TEST_HTML;

(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let i=0;i<8;i++)pdf.addPage([595,842]).drawText('Tutorial document '+(i+1),{x:75,y:640,size:24,font});
  const bytes=Buffer.from(await pdf.save());
  const browser=await chromium.launch({headless:true,
    ...(process.env.BROWSER_PATH ? {executablePath:process.env.BROWSER_PATH} : {channel:'chrome'})});
  try {
    for(const mobile of [false,true])for(const mode of (source?['editor']:['editor','viewer'])) {
      const label=(mobile?'mobile':'desktop')+'-'+mode;
      const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:960},
        isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1,bypassCSP:!!source});
      const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(()=>localStorage.setItem('pdfEditor.startupMode','blank'));
      if(source) {
        const html=fs.readFileSync(source,'utf8').replaceAll('__APP_VER__','tutorial-test')
          .replaceAll('assets/fontawesome/','/assets/fontawesome/').replaceAll('assets/pdfjs/','/assets/pdfjs/');
        await page.route(origin+'/editor/',r=>r.fulfill({contentType:'text/html',body:html}));
      }
      const root=page.locator('#editorTutorial'),card=root.locator('.tutorialCard');
      await page.goto(origin+'/'+mode+'/');
      await page.locator('#editorTutorial[data-step="intro"]').waitFor();
      const total=mode==='viewer'?4:5;
      assert.ok((await root.locator('h2').textContent()).includes(String(total)));
      await page.screenshot({path:`${output}/${label}-intro.png`});
      await root.locator('.tutorialPrevious').click();
      await root.waitFor({state:'detached'});
      await page.reload();await page.waitForFunction(()=>!document.getElementById('appBootSplash'));
      assert.equal(await root.count(),0,'Skip must suppress automatic replay');
      await page.locator('#fileInput').setInputFiles({name:'tutorial.pdf',mimeType:'application/pdf',buffer:bytes});
      await page.waitForFunction(()=>document.querySelector('#pg0 canvas')?.width>100);
      await page.locator('#zoomInput').fill('110');await page.locator('#zoomInput').press('Enter');
      await page.locator('#pageJump').fill('4');await page.locator('#pageJump').press('Enter');
      await page.waitForTimeout(350);
      const snapshot=()=>page.evaluate(()=>({
        zoom:document.getElementById('zoomInput').value,
        pages:document.querySelectorAll('.pageWrap').length,
        tabs:document.getElementById('tabStrip').textContent,
        sidebar:document.getElementById('sidebar').classList.contains('hidden'),
        top:document.getElementById('viewer').scrollTop,left:document.getElementById('viewer').scrollLeft,
        text:document.getElementById('pagesBox').textContent
      }));
      async function start() {
        await page.locator('#btnSettings').click();await page.locator('#setTutorialStart').click();
        await root.waitFor();assert.equal(await page.locator('#setOverlay').isVisible(),false);
      }
      async function bounds() {
        const box=await card.boundingBox(),v=page.viewportSize();
        assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=v.width+1&&box.y+box.height<=v.height+1,label+': card outside viewport');
        for(const c of ['.tutorialClose','.tutorialPrevious','.tutorialNext']) {
          assert.equal(await root.locator(c).isVisible(),true);
          const b=await root.locator(c).boundingBox();assert.ok(b.height>=36);
        }
        const ring=await root.locator('.tutorialSpotlight').boundingBox();assert.ok(ring&&ring.width>10&&ring.height>10);
      }
      const before=await snapshot();
      await start();assert.equal(await root.getAttribute('data-step'),'1');
      assert.equal(await root.locator('.tutorialPrevious').isDisabled(),true);
      for(let n=1;n<=total;n++) {
        assert.equal(await root.getAttribute('data-step'),String(n));await bounds();
        assert.equal(await root.locator('.tutorialProgress').textContent(),`${n} / ${total}`);
        if(n===2)await page.screenshot({path:`${output}/${label}-pages.png`});
        if(n===3) {
          await page.keyboard.press('ArrowLeft');assert.equal(await root.getAttribute('data-step'),'2');
          await root.locator('.tutorialNext').click();
          await page.keyboard.press('Control+f');assert.equal(await page.locator('#searchBar').isVisible(),false);
          if(mobile){await page.setViewportSize({width:320,height:568});await page.waitForTimeout(60);await bounds();
            await page.setViewportSize({width:844,height:390});await page.waitForTimeout(60);await bounds();
            await page.setViewportSize({width:390,height:844});await page.waitForTimeout(80);}
        }
        if(n===4)await page.screenshot({path:`${output}/${label}-tools.png`});
        await root.locator('.tutorialNext').click();
      }
      await root.waitFor({state:'detached'});
      const after=await snapshot();
      assert.equal(after.zoom,before.zoom);assert.equal(after.pages,before.pages);assert.equal(after.tabs,before.tabs);
      assert.equal(after.sidebar,before.sidebar);assert.equal(after.text,before.text);
      if(!mobile){assert.ok(Math.abs(after.top-before.top)<1);assert.ok(Math.abs(after.left-before.left)<1);}
      assert.equal(await page.locator('body > [inert]').count(),0,'Tour left the app disabled');
      const exits=source&&!mobile?['button','escape','outside']:['button','escape','outside','back'];
      for(const exit of exits) {
        await start();await root.locator('.tutorialNext').click();
        if(exit==='button')await root.locator('.tutorialClose').click();
        if(exit==='escape')await page.keyboard.press('Escape');
        if(exit==='outside')await page.mouse.click(2,2);
        const originalUrl=page.url();
        if(exit==='back')await page.evaluate(()=>history.back());
        await root.waitFor({state:'detached'});
        assert.equal(page.url(),originalUrl,'Closing a tutorial must not navigate away');
        assert.equal(await page.locator('body > [inert]').count(),0);
      }
      await page.reload();await page.waitForFunction(()=>!document.getElementById('appBootSplash'));
      assert.equal(await root.count(),0,'Completed tutorial must not replay on startup');
      if(!source) {
        await page.goto(origin+'/en/'+mode+'/');await page.waitForFunction(()=>!document.getElementById('appBootSplash'));
        await start();assert.equal(await root.locator('h2').textContent(),'Open a PDF');
        assert.equal(await root.locator('.tutorialClose').textContent(),'Exit ×');
        await root.locator('.tutorialClose').click();
      }
      assert.deepEqual(errors,[]);console.log('PASS '+label+': first-run skip, settings replay, '+total+' steps, navigation, '+exits.length+' exits, focus/UI restore, responsive bounds, language');
      await context.close();
    }
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
    await page.addInitScript(()=>localStorage.setItem('pdfEditor.startupMode','blank'));
    await page.goto(origin+'/editor/');await page.locator('#editorTutorial[data-step="intro"]').waitFor();
    await page.locator('#editorTutorial .tutorialNext').click();
    assert.equal(await page.locator('#editorTutorial').getAttribute('data-step'),'1');
    await page.keyboard.press('Escape');await context.close();
  } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});

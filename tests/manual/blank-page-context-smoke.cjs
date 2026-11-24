const fs = require('node:fs'), assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {PDFDocument} = require('pdf-lib');
const origin = process.env.CONTEXT_TEST_ORIGIN || 'http://127.0.0.1:9930';
const output = process.env.CONTEXT_TEST_OUTPUT || '../output/blank-context-qa';
const pc = process.env.CONTEXT_TEST_PC === '1';
const rounded = value => JSON.parse(JSON.stringify(value, (key, item) =>
  typeof item === 'number' ? Math.round(item * 1e9) / 1e9 : item));
let html = fs.readFileSync(process.env.CONTEXT_TEST_HTML || 'PDF편집기.html', 'utf8')
  .replaceAll('__APP_VER__', 'blank-context-test')
  .replaceAll('assets/fontawesome/', '/assets/fontawesome/').replaceAll('assets/pdfjs/', '/assets/pdfjs/');
const hook = `window.contextTest = {
  async seed() {
    const page = editorStore.pages[0];
    page.texts = [
      {type:'rect',fx:.12,fy:.16,fw:.18,fh:.12,stroke:'#cc2222',fill:'#ffcccc',sw:2,linkId:'test-shape'},
      {type:'arrow',x1:.3,y1:.22,x2:.46,y2:.3,stroke:'#2060c0',sw:2,attachTo:'test-shape',connectorAnchorX:1,connectorAnchorY:0}
    ];
    positionMarks(document.getElementById('pg0'),page);
    await doFitPage(true);
  },
  snapshot() { return { pages:editorStore.pages.map(p=>JSON.parse(JSON.stringify(p.texts))),
    undo:editorStore.undoStack.length, selected:selText?.k, zoom:editorStore.zoom }; },
  async copyKind(kind) {
    let value;
    if(kind==='text') value={fx:.12,fy:.1,text:'PASTE',size:16,font:'arial',color:'#123456'};
    else if(kind==='polyline') value={type:'polyline',points:[[.1,.1],[.2,.2],[.3,.1]],stroke:'#123456',sw:2};
    else {const canvas=document.createElement('canvas');canvas.width=20;canvas.height=20;
      value={type:'img',fx:.1,fy:.1,fw:.1,fh:.1,data:canvas.toDataURL()};}
    await commitWebObjectClipboard(value); objClip=value;
  },
  copied:()=>!!objClip,
  settled:waitForClipboardCopy,
  pageState:()=>editorStore.pages.map(p=>({rot:p.rot,blank:p.blank})),
  selectPages:indices=>{editorStore.selectedPages=new Set(indices);refreshThumbSelection();},
  selectedPages:()=>[...editorStore.selectedPages],
  goto:k=>gotoPage(k+1),
  debug:()=>({press:mobileContextPress&&{fired:mobileContextPress.fired,target:mobileContextPress.target.outerHTML.slice(0,200)},
    policy:typeof windowsAccess==='undefined'?null:windowsAccess.current}),
  fit:()=>doFitPage(true),
  deselect:deselectText,
  zoom:z=>viewportZoom.to(z),
  undo,
  async stalePaste() {
    const target=captureObjectPasteTarget(0,{x:.6,y:.6});
    const previous=editorStore.pages[0]; editorStore.pages[0]={...previous,texts:[...previous.texts]};
    const result=await pasteObjectFromAvailable(0,target); editorStore.pages[0]=previous; return result;
  }
};\nmountEditorControllers();`;
assert.ok(html.includes('mountEditorControllers();'));
html=html.replace('mountEditorControllers();',hook);
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const pdf=await PDFDocument.create();pdf.addPage([595,842]);pdf.addPage([595,842]);
  const bytes=Buffer.from(await pdf.save());
  const browser=await chromium.launch({headless:true,
    ...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:'chrome'})});
  try {
    for(const [label,viewport,mobile] of [
      ['mobile',{width:390,height:844},true],
      ['tablet',{width:820,height:900},true],
      ['desktop',{width:1280,height:960},false]
    ]) {
      const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,bypassCSP:true});
      const page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
      await page.addInitScript(()=>{localStorage.setItem('pdfEditor.startupMode','blank');localStorage.setItem('pdfEditor.tutorialSeen','1')});
      await page.route(origin+'/editor/?blank-context-test',r=>r.fulfill({contentType:'text/html',body:html}));
      await page.goto(origin+'/editor/?blank-context-test');
      await page.waitForFunction(()=>!document.getElementById('appBootSplash'));
      await page.locator('#fileInput').setInputFiles({name:'blank-context.pdf',mimeType:'application/pdf',buffer:bytes});
      await page.waitForFunction(()=>document.querySelector('#pg0 canvas')?.width>100);
      await page.evaluate(()=>contextTest.seed());await page.waitForTimeout(200);
      const cdp=await context.newCDPSession(page);
      const send=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
      async function openAt(x,y,menuId='#objMenu') {
        if(mobile) {await send('touchStart',[{id:1,x,y}]);await page.waitForTimeout(610);await send('touchEnd',[]);}
        else await page.mouse.click(x,y,{button:'right'});
        try {await page.locator(menuId).waitFor({state:'visible'});}
        catch(error) {
          console.log('menu failure',label,x,y,await page.evaluate(([x,y])=>({state:contextTest.debug(),
            hit:document.elementFromPoint(x,y)?.outerHTML.slice(0,250)}),[x,y]),errors);
          await page.screenshot({path:`${output}/${pc?'pc':'web'}-${label}-failure.png`});throw error;
        }
        await page.waitForTimeout(80);
        assert.equal(await page.locator(menuId).isVisible(),true,'release must keep the menu open');
      }
      async function point(k=0,x=.6,y=.62) {
        await page.locator('#pg'+k).scrollIntoViewIfNeeded();await page.waitForTimeout(100);
        const r=await page.locator('#pg'+k).boundingBox();return {x:r.x+r.width*x,y:r.y+r.height*y};
      }
      async function openBlank(k=0,x=.6,y=.62) {
        const p=await point(k,x,y);await openAt(p.x,p.y,'#ctxMenu');
        assert.ok(await page.locator('#ctxMenu .mi:visible').count()>8);
        assert.equal(await page.locator('#ctxMenu [data-cmd=blank]').isVisible(),true);
        const r=await page.locator('#ctxMenu').boundingBox();
        assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=viewport.width+1&&r.y+r.height<=viewport.height+1);
      }
      async function clickMenu(selector) {if(mobile)await page.locator(selector).tap();else await page.locator(selector).click();}
      await openBlank();
      assert.equal(await page.locator('#ctxMenu [data-cmd=paste]').getAttribute('aria-disabled'),'true');
      assert.ok(Number(await page.locator('#ctxMenu [data-cmd=paste]').evaluate(e=>getComputedStyle(e).opacity))<.6);
      await clickMenu('#ctxMenu [data-cmd=rotR]');
      assert.deepEqual((await page.evaluate(()=>contextTest.pageState())).map(p=>p.rot),[90,0]);
      await page.evaluate(()=>contextTest.undo());await page.evaluate(()=>contextTest.fit());
      await openBlank(1);await clickMenu('#ctxMenu [data-cmd=blank]');
      await page.waitForFunction(()=>contextTest.pageState().length===3);
      assert.ok((await page.evaluate(()=>contextTest.pageState()))[2].blank);
      await page.evaluate(()=>contextTest.undo());
      if(await page.locator('#sidebar').evaluate(e=>e.classList.contains('hidden')))await page.locator('#btnThumbs').click();
      await page.locator('.thumb[data-k="0"]').waitFor({state:'visible'});
      await page.evaluate(()=>contextTest.selectPages([0,1]));
      const thumb=await page.locator('.thumb[data-k="0"]').boundingBox();
      await page.mouse.click(thumb.x+thumb.width/2,thumb.y+thumb.height/2,{button:'right'});
      assert.deepEqual(await page.evaluate(()=>contextTest.selectedPages()),[0,1]);
      assert.equal(await page.locator('#ctxMenu [data-cmd=paste]').getAttribute('aria-disabled'),'true');
      await clickMenu('#ctxMenu [data-cmd=rotL]');
      assert.deepEqual((await page.evaluate(()=>contextTest.pageState())).map(p=>p.rot),[270,270]);
      await page.evaluate(()=>contextTest.undo());
      await page.locator('.thumb[data-k="0"]').dispatchEvent('contextmenu',{clientX:thumb.x+20,clientY:thumb.y+20});
      await clickMenu('#ctxMenu [data-cmd=blank]');
      await page.waitForFunction(()=>contextTest.pageState().length===3);
      assert.ok((await page.evaluate(()=>contextTest.pageState()))[2].blank);
      await page.evaluate(()=>contextTest.undo());
      await page.evaluate(()=>contextTest.selectPages([0,1]));
      await page.locator('.thumb[data-k="0"]').dispatchEvent('contextmenu',{clientX:thumb.x+20,clientY:thumb.y+20});
      await clickMenu('#ctxMenu [data-cmd=copy]');await page.evaluate(()=>contextTest.settled());
      await page.locator('.thumb[data-k="0"]').dispatchEvent('contextmenu',{clientX:thumb.x+20,clientY:thumb.y+20});
      await page.waitForFunction(()=>document.querySelector('#ctxMenu [data-cmd=paste]').getAttribute('aria-disabled')==='false');
      await clickMenu('#ctxMenu [data-cmd=paste]');
      await page.waitForFunction(()=>contextTest.pageState().length===4);
      await page.evaluate(()=>contextTest.undo());
      if(mobile)await page.locator('#btnThumbs').click();
      await page.evaluate(()=>contextTest.goto(0));await page.evaluate(()=>contextTest.fit());await page.waitForTimeout(150);
      await page.locator('#pg0 .shapeMark').first().scrollIntoViewIfNeeded();await page.waitForTimeout(100);
      const source=await page.locator('#pg0 .shapeMark').first().boundingBox();
      await openAt(source.x+source.width/2,source.y+source.height/2);
      assert.ok(await page.locator('#objMenu .mi:visible').count()>1,'object menu retained');
      await clickMenu('#objMenu [data-cmd="copy"]');
      await page.waitForFunction(()=>contextTest.copied());
      const before=await page.evaluate(()=>contextTest.snapshot());
      await openBlank();await page.screenshot({path:`${output}/${pc?'pc':'web'}-${label}.png`});
      await clickMenu('#ctxMenu [data-cmd=paste]');await page.waitForFunction(()=>contextTest.snapshot().pages[0].length===4);
      const after=await page.evaluate(()=>contextTest.snapshot());
      assert.deepEqual(after.pages[0].slice(0,2),before.pages[0],'copy source must stay unchanged');
      assert.equal(after.undo,before.undo+1,'one paste is one undo');
      assert.ok(Math.abs(after.pages[0][2].fx-.6)<.005&&Math.abs(after.pages[0][2].fy-.62)<.005);
      assert.equal(after.pages[0][3].attachTo,after.pages[0][2].linkId,'connection stays attached');
      assert.notEqual(after.pages[0][2].linkId,before.pages[0][0].linkId);
      await page.evaluate(()=>contextTest.undo());
      assert.equal((await page.evaluate(()=>contextTest.snapshot())).pages[0].length,2);
      await page.evaluate(()=>contextTest.goto(1));await page.waitForTimeout(180);await page.evaluate(()=>contextTest.fit());
      await openBlank(1,.55,.5);await clickMenu('#ctxMenu [data-cmd=paste]');
      await page.waitForFunction(()=>contextTest.snapshot().pages[1].length===2);
      assert.equal((await page.evaluate(()=>contextTest.snapshot())).selected,1,'destination is the pressed page');
      for(const kind of ['text','img','polyline']) {
        const count=(await page.evaluate(()=>contextTest.snapshot())).pages[1].length;
        await page.evaluate(kind=>contextTest.copyKind(kind),kind);
        await openBlank(1,.45,.7);await clickMenu('#ctxMenu [data-cmd=paste]');
        await page.waitForFunction(count=>contextTest.snapshot().pages[1].length===count+1,count);
        const value=(await page.evaluate(()=>contextTest.snapshot())).pages[1].at(-1);
        assert.ok(Math.abs((value.fx??value.points[0][0])-.45)<.005);
        assert.ok(Math.abs((value.fy??value.points[0][1])-.7)<.005);
        await page.evaluate(()=>contextTest.undo());
      }
      const staleBefore=await page.evaluate(()=>contextTest.snapshot());await page.evaluate(()=>contextTest.stalePaste());
      assert.deepEqual(await page.evaluate(()=>contextTest.snapshot()),staleBefore,'stale async target must not edit another page');
      if(mobile) {
        const quick=await point(1,.8,.2);
        await send('touchStart',[{id:1,...quick}]);await page.waitForTimeout(80);await send('touchEnd',[]);
        await page.waitForTimeout(520);
        assert.equal(await page.locator('#ctxMenu').isVisible()||await page.locator('#objMenu').isVisible(),false,'short tap must not open menu');
        await send('touchStart',[{id:1,...quick}]);await page.waitForTimeout(100);await send('touchCancel',[]);
        await page.waitForTimeout(520);
        assert.equal(await page.locator('#ctxMenu').isVisible()||await page.locator('#objMenu').isVisible(),false,'cancelled touch must not open menu');
        await page.evaluate(()=>{contextTest.deselect();contextTest.goto(0);contextTest.zoom(1)});await page.waitForTimeout(200);
        await page.locator('#viewer').evaluate(e=>{e.scrollTop=200;e.scrollLeft=0});await page.waitForTimeout(100);
        const v=await page.locator('#viewer').boundingBox(), x=v.x+v.width*.7,y=v.y+v.height*.55;
        const scrollBefore=await page.locator('#viewer').evaluate(e=>e.scrollTop);
        await send('touchStart',[{id:1,x,y}]);
        for(let i=1;i<=7;i++){await send('touchMove',[{id:1,x,y:y-i*14}]);await page.waitForTimeout(25);}
        await page.waitForTimeout(520);await send('touchEnd',[]);
        assert.equal(await page.locator('#ctxMenu').isVisible()||await page.locator('#objMenu').isVisible(),false,'scroll must cancel long press');
        const scrollAfter=await page.locator('#viewer').evaluate(e=>e.scrollTop);
        if(scrollAfter<=scrollBefore+10)console.log('scroll failure',label,{x,y,scrollBefore,scrollAfter},
          await page.evaluate(([x,y])=>({hit:document.elementFromPoint(x,y)?.outerHTML.slice(0,300),state:contextTest.debug()}),[x,y]));
        assert.ok(scrollAfter>scrollBefore+10,'native scroll retained');
        await page.evaluate(()=>contextTest.fit());await page.waitForTimeout(200);
        const p=await point(0,.6,.65),snapshot=await page.evaluate(()=>contextTest.snapshot());
        await send('touchStart',[{id:1,x:p.x-30,y:p.y}]);await page.waitForTimeout(180);
        await send('touchStart',[{id:1,x:p.x-30,y:p.y},{id:2,x:p.x+30,y:p.y}]);
        await page.waitForTimeout(550);
        assert.equal(await page.locator('#ctxMenu').isVisible()||await page.locator('#objMenu').isVisible(),false,'stationary two fingers must cancel long press');
        await send('touchMove',[{id:1,x:p.x-50,y:p.y},{id:2,x:p.x+50,y:p.y}]);
        await send('touchEnd',[]);await page.waitForTimeout(180);
        const pinched=await page.evaluate(()=>contextTest.snapshot());
        assert.ok(pinched.zoom>snapshot.zoom*1.2,'pinch must still zoom');
        assert.deepEqual(rounded(pinched.pages),rounded(snapshot.pages),'pinch must not move objects');
        assert.equal(pinched.undo,snapshot.undo);
      }
      if(!pc) {
        await page.locator('#btnReaderMode').click();await page.waitForTimeout(150);
        await page.evaluate(()=>contextTest.fit());await page.waitForTimeout(150);
        const p=await point(0,.6,.65),snapshot=await page.evaluate(()=>contextTest.snapshot());
        if(mobile){await send('touchStart',[{id:1,...p}]);await page.waitForTimeout(610);await send('touchEnd',[]);}
        else await page.mouse.click(p.x,p.y,{button:'right'});
        assert.equal(await page.locator('#ctxMenu').isVisible()||await page.locator('#objMenu').isVisible(),false,'viewer stays read-only');
        assert.deepEqual(await page.evaluate(()=>contextTest.snapshot()),snapshot);
        await page.locator('#btnReaderMode').click();await page.evaluate(()=>contextTest.fit());
        await openBlank();
      }
      assert.deepEqual(errors,[]);console.log('PASS '+(pc?'pc/':'web/')+label+': context menu, anchored paste, clipboard kinds, undo, gestures, mode guards');
      await context.close();
    }
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

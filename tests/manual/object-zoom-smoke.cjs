const fs = require('node:fs'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const origin = process.env.OBJECT_ZOOM_TEST_ORIGIN || 'http://127.0.0.1:9930';
const output = process.env.OBJECT_ZOOM_TEST_OUTPUT || '../output/object-zoom-qa';
const modes = (process.env.OBJECT_ZOOM_TEST_MODES || 'editor').split(',');
let html = fs.readFileSync(process.env.OBJECT_ZOOM_TEST_HTML || 'PDF편집기.html', 'utf8')
  .replaceAll('__APP_VER__', 'object-zoom-test')
  .replaceAll('assets/fontawesome/', '/assets/fontawesome/').replaceAll('assets/pdfjs/', '/assets/pdfjs/');
const hook = `
window.objectZoomTest = {
  seed() {
    const image = document.createElement('canvas'); image.width = 80; image.height = 40;
    const ctx = image.getContext('2d'); ctx.fillStyle = '#2060c0'; ctx.fillRect(0,0,80,40);
    for (const page of editorStore.pages) page.texts = [
      {type:'rect',fx:.3,fy:.3,fw:.2,fh:.15,stroke:'#cc2222',fill:'#ffcccc',sw:2},
      {fx:.6,fy:.3,fw:.2,text:'ZOOM',font:'arial',size:20,color:'#111111'},
      {type:'img',fx:.3,fy:.55,fw:.2,fh:.1,data:image.toDataURL()},
      {type:'arrow',x1:.3,y1:.7,x2:.6,y2:.8,stroke:'#2060c0',sw:2,arrowHeadSize:12}
    ];
    viewer.querySelectorAll('.pageWrap').forEach(w=>positionMarks(w,editorStore.pages[+w.dataset.k]));
  },
  remember() {
    this.nodes = [...viewer.querySelectorAll('.obj')];
    this.image = viewer.querySelector('.obj image');
    this.text = viewer.querySelector('.textMark').firstChild;
    this.snapshot = JSON.stringify(editorStore.pages.map(p=>p.texts));
    this.undo = editorStore.undoStack.length;
    this.samples = []; this.running = true;
    const frame = () => { if(!this.running)return; this.samples.push(this.measure()); requestAnimationFrame(frame); }; frame();
  },
  measure() {
    let error = 0;
    const nodes = [...viewer.querySelectorAll('.obj')];
    for(const mark of nodes) {
      const object = mark._ctx.obj, wrap = mark.parentElement;
      if(wrap.style.display==='none' || object.type==='arrow')continue;
      const page = wrap.getBoundingClientRect(), box = mark.getBoundingClientRect();
      error = Math.max(error,Math.hypot(box.left-page.left-object.fx*page.width,box.top-page.top-object.fy*page.height));
    }
    return { error, stable:nodes.length===this.nodes.length && nodes.every((n,i)=>n===this.nodes[i]),
      image:viewer.querySelector('.obj image')===this.image,
      text:viewer.querySelector('.textMark').firstChild===this.text,
      state:JSON.stringify(editorStore.pages.map(p=>p.texts))===this.snapshot,
      undo:editorStore.undoStack.length===this.undo,
      selection:!selText || selText.mark.isConnected && selText.mark.classList.contains('sel') };
  },
  stop() { this.running=false; return [...this.samples,this.measure()]; },
  zoom:z=>viewportZoom.to(z),
  select() { const mark=viewer.querySelector('.shapeMark');selectMark(0,mark._ctx.obj,mark); },
};
mountEditorControllers();`;
assert.ok(html.includes('mountEditorControllers();'), 'test hook anchor missing');
html = html.replace('mountEditorControllers();', hook);

(async () => {
  fs.mkdirSync(output, {recursive:true});
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  for(let i=0;i<6;i++) pdf.addPage([595,842]).drawText('PDF reference', {font,size:18,x:175,y:610});
  const bytes = Buffer.from(await pdf.save());
  const browser = await chromium.launch({headless:true,
    ...(process.env.BROWSER_PATH ? {executablePath:process.env.BROWSER_PATH} : {channel:'chrome'})});
  try {
    for(const mobile of [false,true]) {
      const context = await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:960},
        isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1,bypassCSP:true});
      const page = await context.newPage(), errors=[];
      page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(()=>{localStorage.setItem('pdfEditor.startupMode','blank');localStorage.setItem('pdfEditor.barPin','0')});
      await page.route(origin+'/editor/?object-zoom-test', route=>route.fulfill({contentType:'text/html',body:html}));
      await page.goto(origin+'/editor/?object-zoom-test');
      await page.waitForFunction(()=>document.getElementById('appBootSplash')?.classList.contains('fadeOut'));
      await page.locator('#fileInput').setInputFiles({name:'objects.pdf',mimeType:'application/pdf',buffer:bytes});
      await page.waitForFunction(()=>document.querySelector('#pg0 canvas')?.width>100);
      await page.waitForTimeout(250);await page.evaluate(()=>objectZoomTest.seed());
      async function check(label) {
        const samples = await page.evaluate(()=>objectZoomTest.stop());
        assert.ok(samples.length>3,label+': missing frame samples');
        if(samples.some(s=>!s.state))console.log(label+' changed object data',samples.find(s=>!s.state));
        for(const key of ['stable','image','text','state','undo','selection'])
          assert.ok(samples.every(s=>s[key]), label+': '+key+' changed during zoom');
        const max = Math.max(...samples.map(s=>s.error));
        assert.ok(max<1,label+': object offset '+max.toFixed(2)+'px');
        console.log('PASS '+label+': stable objects, image/text nodes, selection, data and undo; max '+max.toFixed(2)+'px');
      }
      for(const mode of modes) {
        if(mode==='viewer')await page.locator('#btnReaderMode').click();
        else await page.evaluate(()=>objectZoomTest.select());
        await page.evaluate(()=>objectZoomTest.remember());
        for(const z of [75,125,60,150,100]) {
          await page.locator('#zoomInput').fill(String(z));await page.locator('#zoomInput').press('Enter');
          await page.waitForTimeout(90);
        }
        for(const id of ['btnZoomIn','btnZoomOut'])await page.locator('#'+id).click();
        if(!mobile) {
          await page.mouse.move(750,430);await page.keyboard.down('Control');
          await page.mouse.wheel(0,-120);await page.waitForTimeout(100);
          await page.mouse.wheel(0,120);await page.keyboard.up('Control');
        }
        await page.waitForTimeout(450);await check(`${mobile?'mobile':'desktop'}/${mode}`);
        if(mobile) {
          await page.evaluate(()=>{objectZoomTest.zoom(.7);document.getElementById('viewer').scrollTop=0;document.getElementById('viewer').scrollLeft=0});
          await page.waitForTimeout(200);
          if(mode==='editor')await page.evaluate(()=>objectZoomTest.select());
          const rect = await page.locator('#pg0 .shapeMark').first().boundingBox();
          const x = rect.x+8, y = rect.y+rect.height-8;
          const cdp=await context.newCDPSession(page);
          const send=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
          await page.evaluate(()=>objectZoomTest.remember());
          await send('touchStart',[{id:1,x,y}]);
          await send('touchStart',[{id:1,x,y},{id:2,x:x+100,y:y+80}]);
          for(let i=1;i<=10;i++) {
            await send('touchMove',[{id:1,x:x-i*3,y:y-i*2},{id:2,x:x+100+i*3,y:y+80+i*2}]);
            await page.waitForTimeout(20);
          }
          await send('touchEnd',[]);await page.waitForTimeout(450);
          await check(`mobile/${mode}/pinch starting on object`);
        }
      }
      if(modes.at(-1)==='viewer')await page.locator('#btnReaderMode').click();
      assert.equal(await page.locator('#btnText').isVisible(),true);
      await page.screenshot({path:`${output}/${mobile?'mobile':'desktop'}.png`});
      assert.deepEqual(errors,[]);
      await context.close();
    }
  } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});

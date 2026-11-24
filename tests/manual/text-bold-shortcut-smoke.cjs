const fs=require('node:fs'), assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {PDFDocument, StandardFonts, rgb}=require('pdf-lib');
const origin=process.env.CONTROLS_TEST_ORIGIN || 'http://127.0.0.1:9950';
const pc=process.env.CONTROLS_TEST_PC==='1', out='../output/object-controls-qa';
let html=fs.readFileSync('PDF편집기.html','utf8').replaceAll('__APP_VER__','controls-test')
  .replaceAll('assets/fontawesome/','/assets/fontawesome/').replaceAll('assets/pdfjs/','/assets/pdfjs/');
html=html.replace('mountEditorControllers();',`window.controlsTest={
  async seed(kind='arrow-filled', style='angled') {
    origClearSel(); deselectText(); objClip=null;
    editorStore.pages[0].texts=[
      {type:'rect',fx:.16,fy:.55,fw:.14,fh:.08,stroke:'#2462af',fill:'#cfe5ff',sw:2,linkId:'anchor'},
      {type:'arrow',x1:.30,y1:.59,x2:.65,y2:.70,stroke:'#2462af',sw:2,strokeOp:1,
        attachTo:'anchor',attachPoint:'start',connectorAnchor:'edge',connectorStyle:style,
        arrowEndType:kind,arrowHeadSize:10,arrowHeadRotation:0}
    ];
    positionMarks(document.getElementById('pg0'),editorStore.pages[0]);
    selectOverlayObject(0,editorStore.pages[0].texts[1]);
  },
  async seedTypes() {
    origClearSel(); deselectText(); objClip=null;
    const image=document.createElement('canvas'); image.width=8; image.height=8;
    image.getContext('2d').fillRect(0,0,8,8);
    editorStore.pages[0].texts=[
      {type:'rect',fx:.15,fy:.55,fw:.12,fh:.07,stroke:'#2462af',fill:'#cfe5ff',sw:2},
      {text:'Added text',font:'roboto',size:18,color:'#2462af',fx:.36,fy:.55,fw:.15,fh:.07},
      {type:'img',data:image.toDataURL(),fx:.61,fy:.55,fw:.12,fh:.07}
    ];
    positionMarks(document.getElementById('pg0'),editorStore.pages[0]); focusViewer();
  },
  async native(on=true) { setOrigMode(on); return origObjects(editorStore.pages[0]); },
  async exportPdf() { return Array.from(await buildPdf(editorStore.pages)); },
  status() {return {selected:origSels.length, overlays:selectedObjectEntries().length,mixed:hasMixedSelection(),
    undo:editorStore.undoStack.length,pending:mixedOperationPending,clip:objClip,objects:editorStore.pages[0].texts.length};},
  async state() {
    return JSON.parse(JSON.stringify({objects:editorStore.pages[0].texts,native:await origObjects(editorStore.pages[0]),
      selected:origSels,overlayCount:selectedObjectEntries().length,mixed:hasMixedSelection(),undo:editorStore.undoStack.length,
      pending:mixedOperationPending,clip:objClip,polyline:connectorPolyline(editorStore.pages[0].texts.find(t=>t.type==='arrow')||{})}));
  },
  async nativePoints() {
    const p=editorStore.pages[0], {view,rT}=await origView(p), r=document.getElementById('pg0').getBoundingClientRect();
    return (await origObjects(p)).map(o=>{const b=pageRectToDispRect(p,view,rT,o.b);
      return {i:o.i,type:o.type,x:r.left+(b.l+b.w/2)*r.width,y:r.top+(b.t+b.h/2)*r.height};});
  }
}; mountEditorControllers();`);

html=html.replace('window.controlsTest={', 'window.controlsTest={'+
  "async seedText(kind='text') { origClearSel(); deselectText(); const t={text:'Bold test',font:'spoqa',size:20,bold:false,color:'#243d51',fx:.2,fy:.5,fw:.35,fh:.09}; if(kind==='shape') Object.assign(t,{type:'rect',stroke:'#243d51',fill:'#eeeeee',sw:2}); editorStore.pages[0].texts=[t]; positionMarks(document.getElementById('pg0'),editorStore.pages[0]); selectOverlayObject(0,t); },"+
  "textState() { return {objects:JSON.parse(JSON.stringify(editorStore.pages[0].texts)), undo:editorStore.undoStack.length, editing:!!selText?.mark?.isContentEditable}; },");
(async()=>{
const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage([595,842]).drawText('Original text',{x:110,y:570,size:23,font});
const buffer=Buffer.from(await pdf.save());
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
try{
const context=await browser.newContext({viewport:{width:1280,height:1000},bypassCSP:true});
await context.route('https://**/*',async route=>{
 const u=route.request().url(); let f;
 if(u.endsWith('/pdf-lib.min.js'))f='node_modules/pdf-lib/dist/pdf-lib.min.js';
 else if(u.endsWith('/fontkit.umd.min.js'))f='node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js';
 else if(u.includes('/@embedpdf/pdfium@2.15.0/dist/'))f='assets/windows-vendor/pdfium/2.15.0/'+u.split('/').at(-1);
 else if(u.endsWith('SpoqaHanSansRegular.ttf'))f='assets/windows-vendor/fonts/SpoqaHanSansRegular.ttf';
 else if(u.endsWith('SpoqaHanSansBold.ttf'))f='assets/windows-vendor/fonts/SpoqaHanSansBold.ttf';
 else if(u.includes('/roboto/Roboto'))f='assets/windows-vendor/fonts/Roboto-wdth-wght.ttf';
 if(f&&fs.existsSync(f))return route.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.wasm')?'application/wasm':f.endsWith('.ttf')?'font/ttf':'text/javascript',headers:{'access-control-allow-origin':'*'}});
 return route.continue();
});
await context.addInitScript(()=>{for(const key of ['tutorialSeen','readerTutorialSeen'])localStorage.setItem('pdfEditor.'+key,'1');localStorage.setItem('pdfEditor.startupMode','blank');});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route(origin+'/editor/?bold-test',r=>r.fulfill({contentType:'text/html',body:html}));
await page.goto(origin+'/editor/?bold-test');await page.waitForFunction(()=>typeof controlsTest!=='undefined');
await page.locator('#fileInput').setInputFiles({name:'Bold.pdf',mimeType:'application/pdf',buffer});
await page.waitForFunction(()=>document.querySelector('#pg0 canvas')?.width>100);
const state=()=>page.evaluate(()=>controlsTest.textState());
const bold=async expected=>assert.equal((await state()).objects[0].bold,expected);
await page.evaluate(()=>controlsTest.seedText());
const initial=(await state()).undo;
await page.keyboard.press('Control+b');await bold(true);
assert.equal(await page.locator('#tbBold').evaluate(el=>el.classList.contains('active')),true);
await page.keyboard.press('Control+b');await bold(false);
assert.equal((await state()).undo,initial+2);
await page.locator('#btnUndo').click();await bold(true);
await page.locator('#btnUndo').click();await bold(false);
await page.locator('.textMark').click();await page.locator('#tbSize').focus();await page.keyboard.press('Control+b');await bold(true);
assert.equal(await page.locator('#tbSize').evaluate(el=>el===document.activeElement),true);
await page.evaluate(()=>controlsTest.seedText());
await page.locator('.textMark').dblclick();
const beforeEdit=(await state()).undo;
await page.keyboard.press('Control+b');await bold(true);
assert.equal(await page.locator('.textMark').evaluate(el=>el===document.activeElement&&el.isContentEditable),true);
assert.equal(await page.locator('.textMark b,.textMark strong').count(),0,'native rich-text markup is not inserted');
await page.keyboard.press('Escape');assert.equal((await state()).undo,beforeEdit+1,'style-only edit has an undo entry');
await page.locator('#btnUndo').click();await bold(false);
await page.locator('.textMark').dblclick();
await page.keyboard.press('Control+b');await page.keyboard.type('!');
await page.keyboard.press('Escape');
assert.equal((await state()).objects[0].text,'Bold test!');await bold(true);
await page.locator('#btnUndo').click();assert.equal((await state()).objects[0].text,'Bold test');await bold(false);
console.log('PASS '+(pc?'PC':'web')+' Ctrl+B toggle, toolbar input focus, live typing/caret and style-only undo');
await page.evaluate(()=>controlsTest.seedText('shape'));
await page.keyboard.press('Control+b');await bold(true);
assert.equal(await page.locator('#stBold').evaluate(el=>el.classList.contains('active')),true);
await page.keyboard.press('Control+b');await bold(false);
await page.locator('.obj').dblclick();await page.keyboard.press('Control+b');await bold(true);
assert.equal(await page.locator('.shapeTextContent').evaluate(el=>el===document.activeElement),true);
await page.keyboard.press('Escape');
await page.evaluate(()=>controlsTest.seedText());
let consumed=await page.evaluate(()=>{const e=new KeyboardEvent('keydown',{key:'ㅠ',code:'KeyB',ctrlKey:true,bubbles:true,cancelable:true});document.activeElement.dispatchEvent(e);return e.defaultPrevented;});
assert.equal(consumed,true);await bold(true);
consumed=await page.evaluate(()=>{const e=new KeyboardEvent('keydown',{key:'b',code:'KeyB',ctrlKey:true,repeat:true,bubbles:true,cancelable:true});document.activeElement.dispatchEvent(e);return e.defaultPrevented;});
assert.equal(consumed,true);await bold(true);
await page.evaluate(()=>document.getElementById('setOverlay').classList.add('show'));
consumed=await page.evaluate(()=>{const e=new KeyboardEvent('keydown',{key:'b',code:'KeyB',ctrlKey:true,bubbles:true,cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;});
assert.equal(consumed,false);await bold(true);
await page.evaluate(()=>document.getElementById('setOverlay').classList.remove('show'));
await page.keyboard.press('Escape');
consumed=await page.evaluate(()=>{const e=new KeyboardEvent('keydown',{key:'b',code:'KeyB',ctrlKey:true,bubbles:true,cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;});assert.equal(consumed,false);
console.log('PASS '+(pc?'PC':'web')+' shape text, Korean physical key, repeat suppression, modal and hidden toolbar guards');
await page.evaluate(()=>controlsTest.native());
const points=await page.evaluate(()=>controlsTest.nativePoints());await page.mouse.click(points[0].x,points[0].y);
await page.waitForFunction(()=>document.querySelector('#textBar.origText #tbBold')?.getClientRects().length);
await page.keyboard.press('Control+b');
await page.waitForFunction(()=>controlsTest.textState().objects.some(o=>o.text==='Original text'&&o.bold));
console.log('PASS '+(pc?'PC':'web')+' selected original PDF text uses the existing Bold action');
if(!pc){await page.locator('#btnReaderMode').click();consumed=await page.evaluate(()=>{const e=new KeyboardEvent('keydown',{key:'b',code:'KeyB',ctrlKey:true,bubbles:true,cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;});assert.equal(consumed,false);}
assert.deepEqual(errors,[]);await context.close();
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

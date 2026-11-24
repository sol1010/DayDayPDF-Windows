const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {PDFDocument,StandardFonts}=require('pdf-lib');
const origin=process.env.CLIPBOARD_TEST_ORIGIN||'http://127.0.0.1:9930';
const pc=process.env.CLIPBOARD_TEST_PC==='1';
let html=fs.readFileSync('PDF편집기.html','utf8').replaceAll('__APP_VER__','clipboard-test')
 .replaceAll('assets/fontawesome/','/assets/fontawesome/').replaceAll('assets/pdfjs/','/assets/pdfjs/');
if(pc)html=html.replace("const desktopViewMode = mode === 'desktop-view';","let desktopViewMode = mode === 'desktop-view';");
html=html.replace('mountEditorControllers();',`window.clipTest={
 delay:0,
 seed(){
  this.source=editorStore.activeDocument;
  this.source.pages[0].texts=[{type:'rect',fx:.3,fy:.3,fw:.18,fh:.12,fill:'#ffcccc',stroke:'#cc2222',sw:2}];
  positionMarks(document.getElementById('pg0'),this.source.pages[0]);
  this.destination=newDoc('destination');this.destination.pages=[clonePage(this.source.pages[0])];
  this.destination.pages[0].texts=[];this.destination.srcIds=[...this.source.srcIds];
  editorStore.documents.push(this.destination);renderTabs();
 },
 switch(name){switchDoc(this[name]);},
 snapshot(){return {focus:focusArea,selection:selText?.obj?.type,selected:[...editorStore.selectedPages],
  source:this.source.pages.map(p=>({idx:p.idx,texts:p.texts})),destination:this.destination.pages.map(p=>({idx:p.idx,texts:p.texts})),
  clipboard:clipboard?.length,latest:webClipboardBroker?.latest()?.kind,pending:!!pendingClipboardCopy};},
 settled:waitForClipboardCopy,undo,
 async selectOriginal(){const hits=await origObjects(editorStore.pages[0]);await origSelect(0,[hits.find(h=>h.type===1)]);},
 paste(value){const data=new DataTransfer();data.setData('text/plain',value);
  return handleClipboardPaste(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},
 ${pc?`enableShell(){desktopViewMode=true;
  putShellClipboard=async(packet,meta)=>{this.shared={packet,meta};};
  requestShellClipboard=async(options={})=>options.withMetadata?this.shared:this.shared?.packet;
 },` : ''}
};
const clipboardTestSerialize=serializePageListForClipboard;
serializePageListForClipboard=pages=>{const work=clipboardTestSerialize(pages),delay=clipTest.delay;
 return delay?Promise.all([work,new Promise(resolve=>setTimeout(resolve,delay))]).then(([packet])=>packet):work;};
mountEditorControllers();`);
(async()=>{
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
 for(let i=0;i<4;i++)doc.addPage([595,842]).drawText('ORIGINAL TEXT '+(i+1),{font,size:18,x:60,y:700});
 const bytes=Buffer.from(await doc.save());
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
 try {
  for(const mobile of [false,true]) {
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:960},
    isMobile:mobile,hasTouch:mobile,bypassCSP:true,permissions:['clipboard-read','clipboard-write']});
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{localStorage.setItem('pdfEditor.startupMode','blank');localStorage.setItem('pdfEditor.tutorialSeen','1')});
   await page.route(origin+'/editor/?clipboard-test',r=>r.fulfill({contentType:'text/html',body:html}));
   await page.goto(origin+'/editor/?clipboard-test');await page.waitForFunction(()=>!document.getElementById('appBootSplash'));
   await page.locator('#fileInput').setInputFiles({name:'source.pdf',mimeType:'application/pdf',buffer:bytes});
   await page.waitForFunction(()=>document.querySelector('#pg0 canvas')?.width>100);await page.evaluate(()=>clipTest.seed());
   const thumb=k=>page.locator('.thumb[data-k="'+k+'"]');
   const snapshot=()=>page.evaluate(()=>clipTest.snapshot());
   const settle=()=>page.evaluate(()=>clipTest.settled());
   const showThumbs=async()=>{if(await page.locator('#sidebar').evaluate(e=>e.classList.contains('hidden')))await page.locator('#btnThumbs').click();};
   await showThumbs();await thumb(0).click();await page.keyboard.press('Control+c');await settle();
   assert.equal((await snapshot()).clipboard,1);
   if(mobile)await page.locator('#btnThumbs').click();
   await page.locator('#pageJump').focus();
   await page.locator('#pg0 .obj').click();await page.evaluate(()=>clipTest.delay=450);
   assert.equal(await page.evaluate(()=>document.activeElement.matches('input, textarea, select')),false,'object click must release the previous numeric input focus');
   await page.keyboard.press('Control+c');await page.keyboard.press('Control+v');
   await page.waitForFunction(()=>clipTest.source.pages[0].texts.length===2);
   assert.equal((await snapshot()).source.length,4,'object copy must not add a page');
   await page.evaluate(()=>clipTest.undo());
   await page.locator('#pg0 .obj').click();await page.keyboard.press('Control+c');
   await page.evaluate(()=>clipTest.switch('destination'));await page.keyboard.press('Control+v');
   await page.waitForFunction(()=>clipTest.destination.pages[0].texts.length===1);
   assert.equal((await snapshot()).destination.length,1,'cross-tab object copy must not become a page');
   await page.evaluate(()=>clipTest.undo());
   await page.evaluate(()=>clipTest.switch('source'));await showThumbs();
   await thumb(0).click();await thumb(1).click({modifiers:['Shift']});
   assert.deepEqual((await snapshot()).selected,[0,1]);
   await page.keyboard.press('Control+c');await page.evaluate(()=>clipTest.switch('destination'));
   await page.keyboard.press('Control+v');await page.waitForFunction(()=>clipTest.destination.pages.length===3);
   assert.equal((await snapshot()).clipboard,2);
   assert.deepEqual((await snapshot()).destination.slice(-2).map(p=>p.idx),[0,1]);
   await page.evaluate(()=>clipTest.undo());
   await page.evaluate(()=>clipTest.switch('source'));await page.evaluate(()=>clipTest.selectOriginal());
   await showThumbs();await thumb(1).click();await thumb(2).click({modifiers:['Shift']});
   await page.keyboard.press('Control+c');await settle();assert.equal((await snapshot()).latest,'pages');
   assert.equal((await snapshot()).clipboard,2);
   if(mobile)await page.locator('#btnThumbs').click();
   await page.locator('#pg0 .obj').click();
   for(const key of ['C','ㅊ']) {
    await page.evaluate(key=>window.dispatchEvent(new KeyboardEvent('keydown',{key,code:'KeyC',ctrlKey:true,bubbles:true,cancelable:true})),key);
    await settle();assert.equal((await snapshot()).latest,'object');
   }
   await page.evaluate(()=>clipTest.switch('destination'));await page.evaluate(()=>clipTest.paste('\u2063pdfpages\u2063'));
   assert.equal((await snapshot()).destination.length,1);assert.equal((await snapshot()).destination[0].texts.length,1);
   await page.evaluate(()=>clipTest.undo());await page.evaluate(()=>clipTest.paste('EXTERNAL CLIPBOARD'));
   assert.equal((await snapshot()).destination[0].texts[0].text,'EXTERNAL CLIPBOARD');await page.evaluate(()=>clipTest.undo());
   if(pc&&!mobile) {
    await page.evaluate(()=>{clipTest.delay=0;clipTest.enableShell();clipTest.switch('source')});
    await page.evaluate(()=>clipTest.selectOriginal());await page.keyboard.press('Control+c');await settle();
    assert.equal(await page.evaluate(()=>clipTest.shared?.meta.kind),'object-v1','native objects must reach the desktop shared clipboard');
    await page.evaluate(()=>clipTest.switch('destination'));await page.evaluate(()=>clipTest.paste('\u2063pdfpages\u2063'));
    assert.equal((await snapshot()).destination.length,1);assert.match((await snapshot()).destination[0].texts[0].text,/ORIGINAL TEXT/);
    await page.evaluate(()=>clipTest.undo());await page.evaluate(()=>clipTest.switch('source'));await showThumbs();
    await thumb(0).click();await thumb(1).click({modifiers:['Shift']});await page.keyboard.press('Control+c');await settle();
    assert.equal(await page.evaluate(()=>clipTest.shared?.meta.count),2);
    await page.evaluate(()=>clipTest.switch('destination'));await page.evaluate(()=>clipTest.paste('\u2063pdfobj\u2063'));
    assert.equal((await snapshot()).destination.length,3,'shared metadata determines the copied type');
   }
   if(!pc) {
    await page.locator('#btnReaderMode').click();const before=await snapshot();
    await page.evaluate(()=>clipTest.paste('\u2063pdfpages\u2063'));assert.deepEqual(await snapshot(),before);
   }
   assert.deepEqual(errors,[]);console.log('PASS '+(pc?'pc':'web')+'/'+(mobile?'mobile':'desktop')+': selection, immediate copy/paste, other PDF tab, two-page range, native objects, IME and external text');
   await context.close();
  }
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

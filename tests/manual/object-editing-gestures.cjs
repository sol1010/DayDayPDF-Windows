const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {PDFDocument,rgb,PDFName}=require('pdf-lib');
const root=process.cwd(),desktop=path.join(root,'windows/PdfEditor.Preview/WebApp');
const hook=`window.gestureQA={
 objects:()=>editorStore.pages[0]?.texts.map(({data,...o})=>o),
 state:()=>({busy:mixedOperationPending,selected:selectedObjectEntries().length,native:origSels.length,undo:editorStore.undoStack.length,shape:shapeDraft}),
 ready:()=>!!editorStore.pages.length,
 reset(items){ stopDrawing();setOrigMode(false);deselectText();const p=editorStore.pages[0];p.texts=items;positionMarks(document.querySelector('#pg0'),p);focusViewer(); },
 pixels:async pts=>{await eraserQueue;const bytes=await buildPdf(editorStore.pages);const loading=openPdfDocument(bytes.slice()),doc=await loading.promise;
 try{const p=await doc.getPage(1),vp=p.getViewport({scale:2}),cv=document.createElement('canvas');cv.width=vp.width;cv.height=vp.height;
 const c=cv.getContext('2d');await p.render({canvasContext:c,viewport:vp}).promise;return pts.map(([x,y])=>Array.from(c.getImageData(x*2,y*2,1,1).data));}finally{await loading.destroy()}},
 settled:()=>eraserQueue, moved:pendingObjectEdits, undo, setZoom,\n annots:async()=>await origAnnots(editorStore.pages[0]),
 savedBounds:async(index)=>withPdfiumDoc(await buildPdf(editorStore.pages),(F,M,doc)=>{
 const pg=F.FPDF_LoadPage(doc,0),ptr=M.wasmExports.malloc(16);
 try{if(!F.FPDFPageObj_GetBounds(F.FPDFPage_GetObject(pg,index),ptr,ptr+4,ptr+8,ptr+12))throw new Error('bounds');
 return Array.from(new Float32Array(M.HEAPU8.buffer,ptr,4));}finally{M.wasmExports.free(ptr);F.FPDF_ClosePage(pg);}}),
 native:async()=>{const p=editorStore.pages[0]; return (await origObjects(p)).map(o=>[o.type,o.b]);},
 async selectPair(annotations) {
   setOrigMode(true);
   const page=editorStore.pages[0], hits=await (annotations?origAnnots(page):origObjects(page));
   await origSelect(0,[hits[1]]);
   await origPickHit(0,hits[0],true);
 },
 prepAnnotation:async()=>{setOrigMode(true);await origSelect(0,[(await origAnnots(editorStore.pages[0]))[0]]);},
 prepNative:async()=>{setOrigMode(true);await origSelect(0,[(await origObjects(editorStore.pages[0]))[1]]);}
};mountEditorControllers();`;
const server=http.createServer((req,res)=>{const url=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);
 for(const dir of [desktop,root]){const f=path.resolve(dir,url);if(!f.startsWith(dir+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile())continue;
 res.setHeader('content-type',({'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.woff2':'font/woff2'})[path.extname(f)]||'application/octet-stream');
 if(url==='view.html')return res.end(fs.readFileSync(f,'utf8').replace('mountEditorControllers();',()=>hook));return fs.createReadStream(f).pipe(res);}
 res.writeHead(404);res.end();});
async function checkSubpixelPainting(page) {
 const image=await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=canvas.height=100;
   const c=canvas.getContext('2d');
   c.fillStyle='white';c.fillRect(0,0,100,100);c.fillStyle='black';c.fillRect(50,0,50,100);
   return canvas.toDataURL();
 });
 for(const type of ['rect','img']){
   const model={type,fx:.252,fy:.17,fw:.25,fh:.2,fill:'#000000',strokeOn:false};
   if(type==='img')model.data=image;
   await page.evaluate(obj=>gestureQA.reset([obj]),model);
   const mark=page.locator('#pg0 > .obj').first();await mark.click();
   const r=await mark.boundingBox();
   const clip={x:Math.floor(r.x+(type==='img'?r.width/2:0))-3,y:Math.floor(r.y+r.height/4),width:10,height:1};
   async function edgeBrightness(){
     const shot=await page.screenshot({clip});
     return page.evaluate(async data=>{
       const bitmap=await createImageBitmap(await (await fetch('data:image/png;base64,'+data)).blob());
       const c=document.createElement('canvas');c.width=bitmap.width;c.height=1;
       const g=c.getContext('2d');g.drawImage(bitmap,0,0);bitmap.close();
       const pixels=g.getImageData(0,0,c.width,1).data;
       let sum=0;for(let i=0;i<pixels.length;i+=4)sum+=pixels[i]/255;
       return sum;
     },shot.toString('base64'));
   }
   const before=await edgeBrightness();
   for(let i=0;i<4;i++)await page.keyboard.press('Alt+ArrowRight');
   const shift=await edgeBrightness()-before;
   assert.ok(shift>.18 && shift<.7,type+' visible edge moved '+shift+' for a 0.4px nudge');
   await page.evaluate(()=>gestureQA.undo());
 }
}
async function checkRepeatedGroupMoves(page) {
 const scale=(await page.locator('#pg0').boundingBox()).width/400;
 for(const annotations of [false,true]){
   const positions=()=>page.evaluate(async annotations=>annotations
     ? (await gestureQA.annots()).map(o=>o.b[0])
     : (await gestureQA.native()).map(([,bounds])=>bounds[0]),annotations);
   for(const hold of [false,true]){
     await page.evaluate(a=>gestureQA.selectPair(a),annotations);
     const before=await positions();
     await page.keyboard.down('Alt');
     for(let i=0;i<60;i++){
       if(hold)await page.keyboard.down('ArrowRight');
       else await page.keyboard.press('ArrowRight');
     }
     if(hold)await page.keyboard.up('ArrowRight');
     await page.keyboard.up('Alt');
     await page.evaluate(()=>gestureQA.moved());
     const after=await positions();
     for(let i=0;i<2;i++){
       const shift=(after[i]-before[i])*scale;
       assert.ok(Math.abs(shift-6)<.03,'60 fine steps moved '+shift+'px');
     }
   }
 }
 console.log('PASS 60 tapped and held Alt+arrows on reverse-selected PDF objects and annotations');
}
async function checkPrecision(page, items) {
 const objects = () => page.evaluate(() => gestureQA.objects());
 const pageBox = await page.locator('#pg0').boundingBox();
 const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < .015, actual + ' vs ' + expected);
 const center = async locator => {
   const r = await locator.boundingBox();
   return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
 };
 const [first, second] = items;
 await page.evaluate(list => gestureQA.reset(list), items);
 const marks = page.locator('#pg0 > .obj');
 await page.mouse.click(...await center(marks.nth(0)));
 await page.keyboard.down('Shift'); await page.mouse.click(...await center(marks.nth(1))); await page.keyboard.up('Shift');
 const [x, y] = await center(marks.nth(1));
 await page.mouse.move(x,y); await page.mouse.down();
 await page.mouse.move(x+12,y+5);
 await page.keyboard.down('Alt'); await page.mouse.move(x+47,y+25,{steps:5});
 let positions = await objects();
 near((positions[0].fx-first.fx)*pageBox.width,15.5);
 near((positions[1].fy-second.fy)*pageBox.height,7);
 await page.keyboard.down('Control'); await page.keyboard.up('Alt');
 await page.mouse.move(x+54,y+29); await page.mouse.up(); await page.keyboard.up('Control');
 positions = await objects(); assert.equal(positions.length,4);
 near(positions[0].fx,first.fx); near(positions[1].fy,second.fy);
 near((positions[2].fx-first.fx)*pageBox.width,22.5);
 near((positions[3].fy-second.fy)*pageBox.height,11);
 await page.keyboard.down('Alt');
 for(let i=0;i<10;i++) await page.keyboard.press('ArrowLeft');
 await page.keyboard.press('ArrowDown'); await page.keyboard.up('Alt');
 await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowUp');
 const nudged = await objects();
 for(const i of [2,3]){
   near((nudged[i].fx-positions[i].fx)*pageBox.width,0);
   near((nudged[i].fy-positions[i].fy)*pageBox.height,-9.9);
 }
 await page.evaluate(()=>gestureQA.undo());
 const undone=await objects(); assert.equal(undone.length,4); near((undone[2].fy-positions[2].fy)*pageBox.height,0);
 await page.evaluate(()=>gestureQA.reset([])); await page.evaluate(()=>gestureQA.prepNative());
 const native=()=>page.evaluate(async()=>(await gestureQA.native())[1][1]);
 const original=await native();
 const [nx,ny]=await center(page.locator('.origBox').first());
 await page.keyboard.down('Alt'); await page.mouse.move(nx,ny); await page.mouse.down();
 await page.mouse.move(nx+6,ny-3,{steps:3});
 await page.evaluate(()=>window.addEventListener('mouseup',()=>{
   for(let i=0;i<3;i++)window.dispatchEvent(new KeyboardEvent('keydown',{
     key:'ArrowRight',code:'ArrowRight',altKey:true,bubbles:true,cancelable:true
   }));
 },{once:true}));
 await page.mouse.up(); await page.keyboard.up('Alt'); await page.evaluate(()=>gestureQA.moved());
 let rect=await native(); near((rect[0]-original[0])*pageBox.width/400,.9); near((rect[1]-original[1])*pageBox.height/500,.3);
 await page.keyboard.down('Alt');
 for(let i=0;i<10;i++) await page.keyboard.press('ArrowRight');
 await page.keyboard.up('Alt'); await page.waitForFunction(()=>!gestureQA.state().busy);
 rect=await native(); near((rect[0]-original[0])*pageBox.width/400,1.9);
 const saved=await page.evaluate(()=>{
   window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',altKey:true,bubbles:true,cancelable:true}));
   return gestureQA.savedBounds(1);
 });
 near((rect[1]-saved[1])*pageBox.height/500,.1);
 rect=await native();
 await page.evaluate(list=>gestureQA.reset(list),items); await page.evaluate(()=>gestureQA.prepNative());
 await page.keyboard.down('Shift'); await page.mouse.click(...await center(marks.nth(1))); await page.keyboard.up('Shift');
 assert.equal((await page.evaluate(()=>gestureQA.state())).selected,1);
 await page.keyboard.press('Alt+ArrowUp'); await page.waitForFunction(()=>!gestureQA.state().busy);
 const mixed=await objects();near((mixed[1].fy-second.fy)*pageBox.height,-.1);
 const afterMixed=await native(); near((afterMixed[1]-rect[1])*pageBox.height/500,.1);
 await page.evaluate(()=>gestureQA.prepAnnotation());
 const annotation=()=>page.evaluate(async()=>(await gestureQA.annots())[0].b);
 const annot=await annotation();await page.keyboard.press('Alt+ArrowLeft');
 await page.waitForFunction(()=>!gestureQA.state().busy);
 near(((await annotation())[0]-annot[0])*pageBox.width/400,-.1);
 await page.setViewportSize({width:420,height:800});
 await page.evaluate(()=>{
   gestureQA.setZoom(.7);
   const c=document.createElement('canvas'); c.width=c.height=2;
   gestureQA.reset([{type:'img',data:c.toDataURL(),fx:.3,fy:.4,fw:.25,fh:.2}]);
 });
 if (!await page.locator('#sidebar').evaluate(el=>el.classList.contains('hidden'))) await page.locator('#btnThumbs').evaluate(el=>el.click());
 await page.waitForFunction(()=>document.querySelector('#pg0')?.dataset.rendered);
 await page.locator('#pg0 > .obj').first().scrollIntoViewIfNeeded();
 await page.locator('#pg0 > .obj').first().hover();
 const mobileBox=await page.locator('#pg0').boundingBox();
 const [ix,iy]=await center(marks.first());
 assert.ok(await page.evaluate(([x,y])=>!!document.elementFromPoint(x,y)?.closest('.obj'),[ix,iy]),'image receives pointer');
 await page.keyboard.down('Alt'); await page.mouse.move(ix,iy); await page.mouse.down(); await page.mouse.move(ix+9,iy+4);
 await page.mouse.up(); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Alt');
 const img=(await objects())[0];near((img.fx-.3)*mobileBox.width,.9);near((img.fy-.4)*mobileBox.height,.5);
 console.log('PASS Alt drag, mid-drag modifiers, group duplication, Alt/normal/Shift arrows, repeated PDF nudges, mixed selection and annotation coordinates');
}
(async()=>{
 const doc=await PDFDocument.create(),pdf=doc.addPage([400,500]);
 pdf.drawRectangle({x:20,y:100,width:350,height:180,color:rgb(0,0,1)});
 pdf.drawRectangle({x:90,y:155,width:200,height:65,color:rgb(1,0,0)});
 const annot=doc.context.obj({Type:'Annot',Subtype:'Square',Rect:[45,410,110,455],C:[0,0,0],IC:[1,0,1],F:4});
 const secondAnnot=doc.context.obj({Type:'Annot',Subtype:'Square',Rect:[315,410,345,440],C:[0,0,0],F:4});
 pdf.node.set(PDFName.of('Annots'),doc.context.obj([doc.context.register(annot),doc.context.register(secondAnnot)]));
 const bytes=Buffer.from(await doc.save());
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try {
 const context=await browser.newContext({viewport:{width:1440,height:960},hasTouch:true,bypassCSP:true});
 await context.addInitScript(()=>{for(const k of ['tutorialSeen','readerTutorialSeen'])localStorage.setItem('pdfEditor.'+k,'1');localStorage.setItem('pdfEditor.startupMode','blank');
 const handlers=[];Object.defineProperty(window.chrome,'webview',{value:{addEventListener(t,f){if(t==='message')handlers.push(f)},removeEventListener(){},postMessage(m){if(m.type==='view-ready')queueMicrotask(()=>handlers.forEach(f=>f({data:{cmd:'dismiss-boot-splash'}})));}}});});
 const errors=[];
 async function tab(name){const p=await context.newPage();p.on('pageerror',e=>{console.warn(e.stack);errors.push(e.message)});p.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource'))console.warn(m.text().slice(0,300))});p.setDefaultTimeout(20000);
 await p.goto('http://127.0.0.1:'+server.address().port+'/view.html');await p.locator('#appBootSplash').waitFor({state:'hidden'});
 await p.locator('#fileInput').setInputFiles({name,mimeType:'application/pdf',buffer:bytes});
 await p.waitForFunction(()=>gestureQA.ready()&&document.querySelector('#pg0')?.dataset.rendered);
 await p.evaluate(()=>gestureQA.setZoom(1.2));return p;}
 const p=await tab('gestures.pdf');
 async function pagePoint(x,y){const r=await p.locator('#pg0').boundingBox();return [r.x+x/400*r.width,r.y+y/500*r.height];}
 async function clickAt(x,y){await p.mouse.click(...await pagePoint(x,y));}
 async function draw(x,y,x2,y2){await p.mouse.move(...await pagePoint(x,y));await p.mouse.down();await p.mouse.move(...await pagePoint(x2,y2),{steps:8});await p.mouse.up();await p.evaluate(()=>gestureQA.settled());}
 const rect=(fx,fy,fw,fh,fill)=>({type:'rect',fx,fy,fw,fh,fill,strokeOn:false,sw:1});
 const items=[rect(.1,.15,.15,.15,'#cc3300'),rect(.43,.15,.15,.15,'#448800')];
 const repeatPage=await tab('repeated-moves.pdf');await checkRepeatedGroupMoves(repeatPage);await repeatPage.close();
 const precisionPage=await tab('precision.pdf'); await checkSubpixelPainting(precisionPage); await checkPrecision(precisionPage,items); await precisionPage.close();
 await p.evaluate(items=>gestureQA.reset(items),items);
 await p.keyboard.press('r');assert.equal((await p.evaluate(()=>gestureQA.state())).shape,'rect');await p.keyboard.press('r');assert.equal((await p.evaluate(()=>gestureQA.state())).shape,null);
 await clickAt(70,110);await p.keyboard.down('Shift');await clickAt(201,110);await p.keyboard.up('Shift');assert.equal((await p.evaluate(()=>gestureQA.state())).selected,2);
 const before=await p.evaluate(()=>gestureQA.state());
 await p.mouse.move(...await pagePoint(201,110));await p.mouse.down();await p.mouse.move(...await pagePoint(217,121),{steps:3});
 await p.keyboard.down('Control');await p.mouse.move(...await pagePoint(234,132),{steps:3});
 await p.mouse.up();await p.keyboard.up('Control');
 const moved=await p.evaluate(()=>gestureQA.objects());assert.equal(moved.length,4);assert.equal(moved[0].fx,.1);assert.equal(moved[1].fx,.43);assert.ok(moved[2].fx>.16&&moved[3].fx>.49);
 assert.equal((await p.evaluate(()=>gestureQA.state())).selected,2);await p.evaluate(()=>gestureQA.undo());assert.equal((await p.evaluate(()=>gestureQA.objects())).length,2);
 console.log('PASS toggled R, Shift group, late Ctrl duplicate, relative offsets, one-step undo');
 await p.evaluate(items=>gestureQA.reset(items),items);await clickAt(70,110);const handle=p.locator('.obj.sel .objHandle.rotate').first(),h=await handle.boundingBox();assert.ok(h);
 await p.mouse.move(h.x+h.width/2,h.y+h.height/2);await p.keyboard.down('Alt');await p.mouse.down();await p.mouse.move(h.x+h.width/2+8,h.y+h.height/2,{steps:4});await p.mouse.up();await p.keyboard.up('Alt');
 const angle=(await p.evaluate(()=>gestureQA.objects()))[0].rot||0;assert.ok(angle>.01&&angle<1,'fine angle '+angle);console.log('PASS fine rotation',angle);
 await p.locator('#btnDraw').click();await p.locator('[data-ink-brush]').selectOption('marker');await p.locator('[data-ink-width]').fill('16.5');await p.locator('[data-ink-opacity]').fill('60');
 const p2=await tab('other.pdf');await p2.locator('#btnDraw').click();assert.equal(await p2.locator('[data-ink-brush]').inputValue(),'marker');assert.equal(await p2.locator('[data-ink-width]').inputValue(),'16.5');assert.equal(await p2.locator('[data-ink-opacity]').inputValue(),'60');await p2.close();
 console.log('PASS drawing preferences in another document and fresh editor instance');
 await p.evaluate(items=>gestureQA.reset(items),[rect(.08,.47,.76,.24,'#00cc00'),rect(.25,.53,.4,.12,'#ff0000')]);
 for(const tip of ['round','square','chisel','soft']){
 await p.locator('#btnDraw').click();await p.locator('[data-ink-brush]').selectOption('eraser');await p.locator('[data-eraser-tip]').selectOption(tip);await p.locator('[data-ink-width]').fill('20');await draw(180,285,180,301);
 const pix=await p.evaluate(()=>gestureQA.pixels([[180,293],[150,293]]));assert.ok(pix[0][1]>150&&pix[0][0]<60&&pix[1][0]>230,'overlay '+tip+' '+JSON.stringify(pix));await p.locator('[data-ink-done]').click();
 await p.evaluate(()=>gestureQA.undo());assert.equal((await p.evaluate(()=>gestureQA.objects()))[1].type,'rect');console.log('PASS partial overlay erase, saved color and undo',tip);}
 await p.evaluate(()=>gestureQA.reset([]));await p.locator('#btnDraw').click();await p.locator('[data-ink-brush]').selectOption('eraser');await p.locator('[data-eraser-tip]').selectOption('round');
 await draw(180,301,180,320);
 const orig=await p.evaluate(()=>gestureQA.pixels([[180,308],[150,308]]));assert.ok(orig[0][2]>220&&orig[0][0]<30&&orig[1][0]>220,'native PDF '+JSON.stringify(orig));await p.locator('[data-ink-done]').click();await p.evaluate(()=>gestureQA.undo());
 console.log('PASS partial native PDF erase exposes lower blue vector and preserves remaining red');
 await p.evaluate(()=>gestureQA.prepNative());await p.mouse.move(...await pagePoint(180,310));await p.mouse.down();await p.mouse.move(...await pagePoint(192,310));await p.keyboard.down('Control');await p.mouse.move(...await pagePoint(205,240));await p.mouse.up();await p.keyboard.up('Control');
 await p.waitForFunction(async()=>!gestureQA.state().busy&&(await gestureQA.native()).length===3);
 console.log('PASS native PDF drag with late Ctrl');
 await p.waitForFunction(()=>!gestureQA.state().busy);
 await p.evaluate(items=>gestureQA.reset(items),items);await p.evaluate(()=>gestureQA.prepNative());
 const hitAt=async(x,y)=>p.evaluate(([x,y])=>document.elementsFromPoint(x,y).slice(0,5).map(e=>[e.tagName,e.className?.baseVal||e.className,e.id]),await pagePoint(x,y));
 await p.keyboard.down('Shift');await clickAt(201,110);await p.keyboard.up('Shift');
 assert.equal((await p.evaluate(()=>gestureQA.state())).native,1);
 await p.mouse.move(...await pagePoint(201,110));await p.mouse.down();await p.mouse.move(...await pagePoint(212,116));await p.keyboard.down('Control');
 await p.mouse.move(...await pagePoint(224,127));await p.mouse.up();await p.keyboard.up('Control');
 await p.waitForFunction(()=>gestureQA.objects().length===3&&gestureQA.state().selected===1&&gestureQA.state().native===1).catch(async error=>{
 console.log('Mixed state',await p.evaluate(async()=>({objects:gestureQA.objects(),sel:gestureQA.state(),native:await gestureQA.native(),toast:document.querySelector('#toast')?.textContent})));throw error;});
 assert.equal((await p.evaluate(()=>gestureQA.native())).length,4);console.log('PASS mixed PDF and added-object group copy');
 await p.evaluate(()=>gestureQA.reset([]));await p.locator('#btnDraw').click();await p.locator('[data-ink-brush]').selectOption('eraser');
 await draw(70,60,70,74);
 const annotPx=await p.evaluate(()=>gestureQA.pixels([[70,66],[94,66]]));
 assert.ok(annotPx[0][1]>240&&annotPx[1][1]<40&&annotPx[1][0]>220,'annotation '+JSON.stringify(annotPx));
 console.log('PASS annotation partial erase and PDF appearance');
 await p.locator('[data-ink-done]').click();
 await p.setViewportSize({width:390,height:844}); await p.evaluate(items=>{gestureQA.reset(items);gestureQA.setZoom(.65)},[rect(.12,.25,.65,.3,'#00cc00'),rect(.24,.31,.4,.18,'#ff0000')]);
 await p.locator('#btnDraw').click();await p.locator('[data-ink-brush]').selectOption('eraser');
 await p.waitForFunction(()=>document.querySelector('#pg0').dataset.rendered&&document.body.classList.contains('drawingMode'));
 if (!await p.locator('#sidebar').evaluate(el=>el.classList.contains('hidden'))) await p.locator('#btnThumbs').evaluate(button=>button.click());
 await p.locator('#pg0').scrollIntoViewIfNeeded();
 const cdp=await context.newCDPSession(p),start=await pagePoint(170,190),end=await pagePoint(172,215);
 assert.ok((await hitAt(170,190)).some(e=>e[2]==='pg0'));
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start[0],y:start[1]}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:end[0],y:end[1]}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await p.waitForFunction(()=>gestureQA.objects().at(-1).type==='img');
 const touch=await p.evaluate(()=>gestureQA.pixels([[171,202],[135,202]]));
 assert.ok(touch[0][1]>150&&touch[1][0]>230,'touch '+JSON.stringify(touch));console.log('PASS narrow screen and touch eraser');
 assert.deepEqual(errors,[]);
 } finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close());
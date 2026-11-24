const fs=require('node:fs'), assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {PDFDocument,StandardFonts}=require('pdf-lib');
const origin=process.env.CONTROLS_TEST_ORIGIN||'http://127.0.0.1:9953', pc=process.env.CONTROLS_TEST_PC==='1';
const out='../output/drawing-qa';fs.mkdirSync(out,{recursive:true});
let html=fs.readFileSync('PDF편집기.html','utf8').replaceAll('__APP_VER__','drawing-test')
 .replaceAll('assets/fontawesome/','/assets/fontawesome/').replaceAll('assets/pdfjs/','/assets/pdfjs/');
html=html.replace('mountEditorControllers();',`window.inkTest={
 status:()=>({objects:JSON.parse(JSON.stringify(editorStore.pages[0]?.texts||[])),count:editorStore.pages.length,
  active:drawingController.active,undo:editorStore.undoStack.length,dirty:editorStore.activeDocument?.dirty,clip:objClip,zoom:editorStore.zoom}),
 async pdf(){return Array.from(await buildPdf(editorStore.pages));},
 select(i){selectOverlayObject(0,editorStore.pages[0].texts[i]);},
 async comparePdf(bytes){
  const p=editorStore.pages[0], reference=await renderPageRegion(p,0,0,1,1,1);
  overlayCanvasRenderer.drawObjects(p,reference,p._w1||595);
  const doc=await openPdfDocument(new Uint8Array(bytes)).promise, page=await doc.getPage(1), vp=page.getViewport({scale:1});
  const actual=document.createElement('canvas');actual.width=vp.width;actual.height=vp.height;
  await page.render({canvasContext:actual.getContext('2d'),viewport:vp}).promise;
  const a=reference.getContext('2d').getImageData(0,0,reference.width,reference.height).data,
    b=actual.getContext('2d').getImageData(0,0,actual.width,actual.height).data;
  let ink=0,mismatch=0;for(let i=0;i<a.length;i+=4){
    if(Math.min(a[i],a[i+1],a[i+2],b[i],b[i+1],b[i+2])<245){ink++;
      if(Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>50)mismatch++;}
  }
  await doc.destroy?.();return {ratio:mismatch/Math.max(1,ink),reference:reference.toDataURL(),actual:actual.toDataURL()};
 }
};mountEditorControllers();`);
(async()=>{
const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
const p=pdf.addPage([595,842]);p.drawText('Drawing test - PDF text stays readable',{x:55,y:650,font,size:18});
const buffer=Buffer.from(await pdf.save());
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
try{for(const mobile of [false,true]){
 const name=(pc?'pc':'web')+(mobile?'-mobile':'-desktop');
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1400,height:1100},hasTouch:mobile,isMobile:mobile,bypassCSP:true,permissions:['clipboard-read','clipboard-write']});
 await context.route('https://**/*',async route=>{
  const u=route.request().url();let f;
  if(u.endsWith('/pdf-lib.min.js'))f='node_modules/pdf-lib/dist/pdf-lib.min.js';
  else if(u.endsWith('/fontkit.umd.min.js'))f='node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js';
  else if(u.includes('/@embedpdf/pdfium@2.15.0/dist/'))f='assets/windows-vendor/pdfium/2.15.0/'+u.split('/').at(-1);
  else if(u.endsWith('SpoqaHanSansRegular.ttf'))f='assets/windows-vendor/fonts/SpoqaHanSansRegular.ttf';
  else if(u.endsWith('SpoqaHanSansBold.ttf'))f='assets/windows-vendor/fonts/SpoqaHanSansBold.ttf';
  if(f&&fs.existsSync(f))return route.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.wasm')?'application/wasm':f.endsWith('.ttf')?'font/ttf':'text/javascript',headers:{'access-control-allow-origin':'*'}});
  return route.continue();
 });
 await context.addInitScript(()=>{for(const key of ['tutorialSeen','readerTutorialSeen'])localStorage.setItem('pdfEditor.'+key,'1');localStorage.setItem('pdfEditor.startupMode','blank');});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(origin+'/editor/?drawing-test',r=>r.fulfill({body:html,contentType:'text/html'}));
 await page.goto(origin+'/editor/?drawing-test');await page.waitForFunction(()=>typeof inkTest!=='undefined');
 await page.locator('#fileInput').setInputFiles({name:'Drawing.pdf',mimeType:'application/pdf',buffer});
 await page.waitForFunction(()=>document.querySelector('#pg0 canvas')?.width>100);
 const state=()=>page.evaluate(()=>inkTest.status());
 await page.locator('#btnDraw').click();assert.equal((await state()).active,true);
 const beforeColor=await state();
 await page.locator('[data-ink-color]').click();
 assert.equal(await page.locator('#palGrid .sw').count(),20,'shared object color palette');
 await page.locator('#palGrid [data-c="#2196f3"]').click();
 assert.equal(await page.locator('[data-ink-color]').getAttribute('data-col'),'#2196f3');
 await page.locator('#palCustom').click();
 await page.locator('#palSV').click({position:{x:83,y:37}});
 const brushColor=await page.locator('[data-ink-color]').getAttribute('data-col');
 assert.equal(await page.locator('[data-ink-preview]').evaluate(e=>e.style.getPropertyValue('--ink-color')),brushColor);
 assert.equal(await page.locator('#palRecent .sw').first().getAttribute('data-c'),brushColor);
 assert.equal((await state()).undo,beforeColor.undo,'brush settings do not add document history');
 assert.equal((await state()).dirty,beforeColor.dirty,'brush settings do not dirty the document');
 await page.screenshot({path:out+'/'+name+'-palette.png'});
 await page.keyboard.press('Escape');assert.equal(await page.locator('#palettePop').isVisible(),false);
 assert.equal((await state()).active,true,'Escape closes the palette before exiting drawing');
 await page.locator('[data-ink-brush]').selectOption('marker');
 await page.locator('[data-ink-brush]').selectOption('pen');
 assert.equal(await page.locator('[data-ink-color]').getAttribute('data-col'),brushColor,'per-brush color remembered');
 const cdp=await context.newCDPSession(page);
 async function stroke(row,brush){
  await page.locator('[data-ink-brush]').selectOption(brush);
  await page.locator('[data-ink-brush]').focus();
  const r=await page.locator('#pg0').boundingBox(),pts=Array.from({length:35},(_,i)=>({x:r.x+r.width*(.15+i*.016),y:r.y+r.height*(row+Math.sin(i*.24)*.025)}));
  if(mobile){
   const touch=(p)=>[{x:p.x,y:p.y,id:1,radiusX:2,radiusY:2,force:.5}];
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touch(pts[0])});
   for(const pt of pts.slice(1))await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touch(pt)});
  }else{
   await page.mouse.move(pts[0].x,pts[0].y);await page.mouse.down();
   for(const pt of pts.slice(1))await page.mouse.move(pt.x,pt.y);
  }
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const draft=await page.locator('.inkDraft .inkVisual > path:last-child').boundingBox();
  if(mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  else await page.mouse.up();
  const committed=await page.locator('.obj .inkVisual > path:last-child').last().boundingBox();
  for(const key of ['x','y','width','height'])assert.ok(Math.abs(draft[key]-committed[key])<.02,brush+' release preserves '+key);
 }
 for(const [i,brush]of ['pen','pencil','marker','highlighter'].entries()){
  await stroke(.27+i*.09,brush);
  assert.equal((await state()).objects.length,i+1,brush+' commits one stroke');
  assert.equal((await state()).objects[i].brush,brush);
  if(i===0)assert.equal((await state()).objects[i].stroke,brushColor,'new stroke uses the chosen palette color');
  await page.keyboard.press('Control+z');assert.equal((await state()).objects.length,i,'undo directly after drawing');
  await page.keyboard.press('Control+y');assert.equal((await state()).objects.length,i+1,'redo without another click');
  assert.equal((await state()).active,true,'history shortcuts preserve drawing mode');
 }
 await page.locator('[data-ink-width]').fill('5');
 await page.keyboard.press('Control+z');assert.equal((await state()).objects.length,4,'editing a field does not undo strokes');
 await page.locator('[data-ink-width]').blur();
 console.log(name+' strokes drawn');
 assert.equal((await state()).dirty,true);assert.equal(await page.locator('.objHandle').count(),0);
 const s=await state();await page.keyboard.press('Delete');assert.equal((await state()).count,1);
 await page.locator('#btnUndo').click();assert.equal((await state()).objects.length,3);
 await page.locator('#btnRedo').click();assert.equal((await state()).objects.length,4);
 if(mobile){
  const r=await page.locator('#pg0').boundingBox(),x=Math.max(80,r.x+r.width*.4),y=Math.max(290,r.y+r.height*.45);
  const touch=(id,x,y)=>({id,x,y,radiusX:3,radiusY:3,force:.5});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(1,x,y)]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(1,x+5,y+5)]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(1,x+5,y+5),touch(2,x+65,y+5)]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(1,x-10,y),touch(2,x+85,y)]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal((await state()).objects.length,4,'pinch cancels unfinished ink');
  assert.ok((await state()).zoom>s.zoom,'pinch still zooms');
  await page.locator('#btnFit').click();
 }
 await page.screenshot({path:out+'/'+name+'-drawing.png'});
 await page.locator('[data-ink-done]').click();assert.equal((await state()).active,false);
 if(!mobile){
  await page.locator('#btnDraw').click();const r=await page.locator('#pg0').boundingBox();
  await page.mouse.move(r.x+r.width*.2,r.y+r.height*.7);await page.mouse.down();
  await page.mouse.move(r.x+r.width*.4,r.y+r.height*.7);await page.keyboard.press('Escape');await page.mouse.up();
  assert.equal((await state()).objects.length,4);assert.equal((await state()).active,false);
 }
 await page.evaluate(()=>inkTest.select(0));
 await page.locator('#tbStroke').click();
 await page.locator('#palSV').click({position:{x:22,y:74}});
 assert.notEqual((await state()).objects[0].stroke,brushColor,'shared palette still edits existing strokes');
 await page.keyboard.press('Escape');await page.keyboard.press('Control+z');
 assert.equal((await state()).objects[0].stroke,brushColor,'object color changes remain undoable');
 await page.evaluate(()=>inkTest.select(0));
 assert.equal(await page.locator('#tbFillCtl').isVisible(),false);
 assert.equal(await page.locator('#tbInkBrush').isVisible(),true);
 await page.locator('#tbSw').fill('5');await page.locator('#tbSw').dispatchEvent('change');
 assert.equal((await state()).objects[0].sw,5);
 await page.locator('#tbInkBrush').selectOption('marker');assert.equal((await state()).objects[0].brush,'marker');
 await page.keyboard.press('Escape');await page.evaluate(()=>inkTest.select(0));
 if(!mobile){
  const before=(await state()).objects[0];
  const hit=await page.locator('.obj .inkHit').first().evaluate(path=>{
    const p=path.getPointAtLength(path.getTotalLength()*.4),screen=p.matrixTransform(path.getScreenCTM());
    return {x:screen.x,y:screen.y};
  });
  await page.mouse.move(hit.x,hit.y);await page.mouse.down();await page.mouse.move(hit.x+30,hit.y+20,{steps:5});await page.mouse.up();
  const moved=(await state()).objects[0];assert.ok(moved.fx>before.fx);assert.deepEqual(moved.points,before.points);
  const handle=await page.locator('.obj.sel .dir-se').boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+handle.width/2+22,handle.y+handle.height/2+14,{steps:5});await page.mouse.up();
  const resized=(await state()).objects[0];assert.ok(resized.fw>moved.fw);assert.deepEqual(resized.points,moved.points);
  const rotate=await page.locator('.obj.sel .rotate').boundingBox();
  await page.mouse.move(rotate.x+rotate.width/2,rotate.y+rotate.height/2);await page.mouse.down();
  await page.mouse.move(rotate.x+rotate.width/2+45,rotate.y+rotate.height/2+15,{steps:5});await page.mouse.up();
  assert.ok(Math.abs((await state()).objects[0].rot||0)>1);
  await page.keyboard.press('Control+c');await page.waitForFunction(()=>inkTest.status().clip?.type==='ink');
  await page.keyboard.press('Control+v');await page.waitForFunction(()=>inkTest.status().objects.length===5);
  await page.keyboard.press('Delete');assert.equal((await state()).objects.length,4);
 }
 console.log(name+' controls passed');
 const objects=(await state()).objects;
 const bytes=Buffer.from(await page.evaluate(()=>inkTest.pdf()));fs.writeFileSync(out+'/'+name+'.pdf',bytes);
 const pixels=await page.evaluate(bytes=>inkTest.comparePdf(bytes),Array.from(bytes));
 for(const kind of ['reference','actual'])fs.writeFileSync(out+'/'+name+'-'+kind+'.png',Buffer.from(pixels[kind].split(',')[1],'base64'));
 console.log(name+' PDF pixel mismatch '+pixels.ratio.toFixed(4));
 assert.ok(pixels.ratio<.12,'PDF and thumbnail geometry/opacity agree');
 const saved=await PDFDocument.load(bytes);assert.equal(saved.getPageCount(),1);
 console.log(name+' PDF saved');
 await page.locator('#fileInput').setInputFiles({name:'Drawing result.pdf',mimeType:'application/pdf',buffer:bytes});
 await page.waitForFunction(()=>document.querySelector('#stFile')?.textContent.includes('Drawing result'));
 await page.waitForFunction(()=>inkTest.status().objects.length===4);
 const reopened=(await state()).objects;
 for(let i=0;i<4;i++)for(const key of ['type','brush','sw','stroke','strokeOp','fx','fy','fw','fh','inkW','inkH','points'])assert.deepEqual(reopened[i][key],objects[i][key],key+' roundtrip');
 await page.screenshot({path:out+'/'+name+'-reopened.png'});
 await page.evaluate(()=>inkTest.select(0));await page.keyboard.press('Delete');assert.equal((await state()).objects.length,3);
 await page.locator('#btnUndo').click();assert.equal((await state()).objects.length,4);
 if(!pc){
  await page.locator('#btnDraw').click();await page.locator('#btnReaderMode').click();
  assert.equal((await state()).active,false);assert.equal(await page.locator('#drawingBar').isVisible(),false);
  assert.equal(await page.locator('#btnDraw').isVisible(),false);assert.equal((await state()).objects.length,4);
  await page.locator('#btnReaderMode').click();assert.equal(await page.locator('#btnDraw').isVisible(),true);
 }
 assert.deepEqual(errors,[]);console.log('PASS '+name+' brushes, undo, selection, PDF roundtrip'+(mobile?', touch/pinch':''));
 await context.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

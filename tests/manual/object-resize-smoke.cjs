const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const {PDFDocument,rgb}=require("pdf-lib");
const root = path.resolve(__dirname, "../.."), input = path.resolve(process.argv[2]), html = path.resolve(process.argv[3]), out = path.resolve(process.argv[4]);
fs.mkdirSync(out, { recursive: true });
const hook = String.raw`window.resizeProbe={
 seed(type='img', rot=0, mirrors={}) {
  origClearSel();deselectText();
  const cv=document.createElement('canvas');cv.width=80;cv.height=80;const c=cv.getContext('2d');
  ['#ff0000','#00ff00','#0000ff','#ffff00'].forEach((color,i)=>{c.fillStyle=color;c.fillRect(i%2*40,Math.floor(i/2)*40,40,40);});
  const t={type,fx:.40,fy:.43,fw:.26,fh:.18,rot,sw:1,stroke:'#d32f2f',fill:'#ffaaaa',...mirrors};
  if(type==='img')t.data=cv.toDataURL();
  if(type==='text'){delete t.type;Object.assign(t,{text:'F',font:'roboto',size:20,color:'#112233'});}
  if(type==='polyline')Object.assign(t,{points:[[.40,.43],[.66,.43],[.66,.61]],closed:false});
  if(type==='ink')Object.assign(t,{inkW:100,inkH:80,points:[[10,10,.5],[20,60,.5],[80,65,.5]],brush:'pen'});
  editorStore.pages[0].texts=[t];positionMarks(document.getElementById('pg0'),editorStore.pages[0]);
  selectOverlayObject(0,t);return this.state();
 },
 group(){const a=editorStore.pages[0].texts[0],b={...a,fx:.72,fw:.10,fh:.08};editorStore.pages[0].texts.push(b);positionMarks(document.getElementById('pg0'),editorStore.pages[0]);selectPastedObjectBundle(0,[a,b],0,document.getElementById('pg0'));},
 state(){return JSON.parse(JSON.stringify({objects:editorStore.pages[0].texts,undo:editorStore.undoStack.length,selected:!!selText, zoom:editorStore.zoom}));},
 undo,redo,
 async save(){return Array.from(await buildPdf(editorStore.pages));},
 async restored(bytes){const d=await pdfLib.raw.PDFDocument.load(new Uint8Array(bytes));const result=await prepareMarkedRestoration(new Uint8Array(bytes),pdfLib.raw,sanitizeTextObj,{expectedPages:d.getPageCount()});return result.restored?.pageTexts;},
 async samples(){
  const t=editorStore.pages[0].texts[0],bytes=await buildPdf(editorStore.pages),doc=await openPdfDocument(bytes.slice()).promise;
  const pg=await doc.getPage(1),vp=pg.getViewport({scale:1});const pdf=document.createElement('canvas');pdf.width=vp.width;pdf.height=vp.height;
  await pg.render({canvasContext:pdf.getContext('2d'),viewport:vp}).promise;
  const thumb=document.createElement('canvas');thumb.width=vp.width;thumb.height=vp.height;
  await overlayCanvasRenderer.prepareImages(editorStore.pages[0]);drawObjsOnCanvas(editorStore.pages[0],thumb,vp.width);
  const angle=(t.rot||0)*Math.PI/180,co=Math.cos(angle),si=Math.sin(angle);
  const pick=cv=>[[-.25,-.25],[.25,-.25],[-.25,.25],[.25,.25]].map(([x,y])=>{
   const dx=x*t.fw*vp.width,dy=y*t.fh*vp.height;
   return Array.from(cv.getContext('2d').getImageData(Math.round((t.fx+t.fw/2)*vp.width+dx*co-dy*si),Math.round((t.fy+t.fh/2)*vp.height+dx*si+dy*co),1,1).data).slice(0,3);
  });
  const result={pdf:pick(pdf),thumb:pick(thumb)};await doc.destroy?.();return result;
 },
 async native(){origClearSel();deselectText();editorStore.pages[0].texts=[];positionMarks(document.getElementById('pg0'),editorStore.pages[0]);setOrigMode(true);const hits=await origObjects(editorStore.pages[0]);await origSelect(0,[hits[0]]);return {hits,undo:editorStore.undoStack.length};},
 async nativePixels(){
  const p=editorStore.pages[0],hit=(await origObjects(p))[0],bytes=await buildPdf(editorStore.pages),doc=await openPdfDocument(bytes.slice()).promise;
  const pg=await doc.getPage(1),vp=pg.getViewport({scale:1}),cv=document.createElement('canvas');cv.width=vp.width;cv.height=vp.height;
  await pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
  const b=hit.b;return [.25,.875].map(f=>{const pt=vp.convertToViewportPoint(b[0]+f*(b[2]-b[0]),b[1]+.15*(b[3]-b[1]));return Array.from(cv.getContext('2d').getImageData(Math.round(pt[0]),Math.round(pt[1]),1,1).data).slice(0,3);});
 },
 async nativeState(){return {hits:await origObjects(editorStore.pages[0]),undo:editorStore.undoStack.length};},
 count:()=>editorStore.pages.length
};mountEditorControllers();`;
const server = http.createServer((req, res) => {
  const route = decodeURIComponent(new URL(req.url, "http://localhost").pathname).slice(1);
  let f = route === "view.html" ? html : null;
  if (!f) for (const base of [path.join(root, "windows/PdfEditor.Preview/WebApp"), root]) {
    const c = path.resolve(base, route);
    if (c.startsWith(base + path.sep) && fs.existsSync(c) && fs.statSync(c).isFile()) {
      f = c;
      break;
    }
  }
  if (!f) {
    res.writeHead(404);
    return res.end();
  }
  res.setHeader("Content-Type", { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2" }[path.extname(f)] || "application/octet-stream");
  if (f === html) {
    let s = fs.readFileSync(f, "utf8").replaceAll("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js", "/assets/windows-vendor/pdf-lib/1.17.1/pdf-lib.min.js").replaceAll("https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js", "/assets/windows-vendor/fontkit/1.1.1/fontkit.umd.min.js").replaceAll("https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@2.15.0/dist/", "http://" + req.headers.host + "/assets/windows-vendor/pdfium/2.15.0/");
    s = s.replace("mountEditorControllers();", hook);
    return res.end(s);
  }
  fs.createReadStream(f).pipe(res);
});

(async()=>{
 const pdf=await PDFDocument.create(),pg=pdf.addPage([400,500]);
 pg.drawSvgPath('M0 0 L80 0 L80 15 L20 15 L20 35 L60 35 L60 50 L20 50 L20 80 L0 80 Z',{x:80,y:300,color:rgb(.1,.3,.8)});
 fs.writeFileSync(input,await pdf.save());
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
 const results=[];let current;
 try{
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:950},isMobile:mobile,hasTouch:mobile,bypassCSP:true});
  const page=current=await context.newPage(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(hosted=>{
   for(const k of ['tutorialSeen','readerTutorialSeen'])localStorage.setItem('pdfEditor.'+k,'1');localStorage.setItem('pdfEditor.startupMode','blank');
   const handlers=[];if(hosted)Object.defineProperty(window.chrome,'webview',{value:{addEventListener(t,f){if(t==='message')handlers.push(f);},removeEventListener(){},postMessage(m){if(m.type==='view-ready')queueMicrotask(()=>handlers.forEach(f=>f({data:{cmd:'dismiss-boot-splash'}})));}}});
  },!process.env.DRAWING_WEB);
  await page.goto('http://127.0.0.1:'+server.address().port+'/view.html');await page.locator('#appBootSplash').waitFor({state:'hidden'});
  await page.locator('#fileInput').setInputFiles(input);await page.waitForFunction(()=>resizeProbe.count()>0&&document.querySelector('#pg0')?.dataset.rendered);
  const cdp=await context.newCDPSession(page);
  async function drag(selector,dx,dy,touch=mobile){
   const loc=page.locator(selector);await loc.scrollIntoViewIfNeeded();const b=await loc.boundingBox();const start={x:b.x+b.width/2,y:b.y+b.height/2};
   if(touch){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+dx*i/8,y:start.y+dy*i/8}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
   else{await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+dx,start.y+dy,{steps:8});await page.mouse.up();}
  }
  async function state(){return page.evaluate(()=>resizeProbe.state());}
  function near(a,b,label){assert.ok(Math.abs(a-b)<.004,label+': '+a+' != '+b);}
  function pass(label){results.push({mobile,label});console.log('PASS '+(mobile?'mobile ':'desktop ')+label);}
  for(const type of ['rect','ellipse','triangle','star','img','ink','text']){
   const before=await page.evaluate(t=>resizeProbe.seed(t),type),p=await page.locator('#pg0').boundingBox();
   await drag('.obj.sel .dir-se',-.26*p.width*1.5,-.18*p.height*1.5);
   const after=await state(),o=after.objects[0];assert.equal(o.flipX,true,type+' flipX');assert.equal(o.flipY,true,type+' flipY');near(o.fw,.13,type+' width');near(o.fh,.09,type+' height');
   assert.equal(after.undo,before.undo+1);await page.evaluate(()=>resizeProbe.undo());let u=await state();assert.equal(!!u.objects[0].flipX,false);near(u.objects[0].fw,.26,'undo width');await page.evaluate(()=>resizeProbe.redo());assert.equal((await state()).objects[0].flipX,true);
   await page.evaluate(()=>{const t=resizeProbe.state().objects[0];resizeProbe.seed(t.type||'text',0,{flipX:true,flipY:true});});
   await drag('.obj.sel .dir-se',.26*p.width*1.5,.18*p.height*1.5);
   assert.equal((await state()).objects[0].flipX,false);assert.equal((await state()).objects[0].flipY,false);pass(type+' cross both axes, undo/redo, reverse');
  }
  await page.evaluate(()=>resizeProbe.seed('polyline'));
  const polyPage=await page.locator('#pg0').boundingBox();
  await drag('.obj.sel [data-poly-bounds="se"]',-.26*polyPage.width*1.5,-.18*polyPage.height*1.5);
  const poly=(await state()).objects[0].points;near(poly[0][0],.40,'poly anchor x');near(poly[0][1],.43,'poly anchor y');near(poly[2][0],.27,'poly mirrored x');near(poly[2][1],.34,'poly mirrored y');pass('polyline crosses both axes');
  for(const axis of ['x','y']){
   await page.evaluate(()=>resizeProbe.seed('rect',33));const p=await page.locator('#pg0').boundingBox(),angle=33*Math.PI/180;
   const amount=axis==='x'?-.26*p.width*1.5:-.18*p.height*1.5;
   await drag('.obj.sel .dir-'+(axis==='x'?'e':'s'),axis==='x'?amount*Math.cos(angle):-amount*Math.sin(angle),axis==='x'?amount*Math.sin(angle):amount*Math.cos(angle));
   const o=(await state()).objects[0];assert.equal(o.flipX,axis==='x');assert.equal(o.flipY,axis==='y');near(o.rot,33,'rotation retained');
  }pass('rotated single-axis reflection');
  await page.evaluate(()=>resizeProbe.seed('rect'));let p=await page.locator('#pg0').boundingBox();
  await drag('.obj.sel .dir-e',-.26*p.width+1,0);const tiny=(await state()).objects[0];assert.ok(tiny.fw*p.width<1.3);assert.ok(tiny.fw*p.width>0);pass('one-pixel width without minimum');
  for(const rot of [0,33,90])for(const flipX of [false,true])for(const flipY of [false,true]){
   await page.evaluate(a=>resizeProbe.seed('img',a.rot,a),{rot,flipX,flipY});
   const sample=await page.evaluate(()=>resizeProbe.samples());
   const colors=[[255,0,0],[0,255,0],[0,0,255],[255,255,0]];
   const expected=[0,1,2,3].map(i=>colors[(i^(flipX?1:0))^(flipY?2:0)]);
   assert.deepEqual(sample.pdf,expected,'PDF mirror '+rot);assert.deepEqual(sample.thumb,expected,'thumbnail mirror '+rot);
  }pass('12 PDF and thumbnail image reflection combinations');
  await page.evaluate(()=>resizeProbe.seed('triangle',33,{flipX:true,flipY:true}));
  const restored=await page.evaluate(async()=>resizeProbe.restored(await resizeProbe.save()));assert.equal(restored[0][0].flipX,true);assert.equal(restored[0][0].flipY,true);pass('saved editable metadata round trip');
  await page.evaluate(()=>{resizeProbe.seed('img');resizeProbe.group();});
  const bounds=await page.locator('.multiSelectionBounds').boundingBox();await drag('.multiSelectionBounds .dir-se',-bounds.width*1.3,-bounds.height*1.3);
  assert.ok((await state()).objects.every(o=>o.flipX&&o.flipY));pass('multiple objects cross both axes');
  if(await page.locator('#btnReaderMode').count()){
  const preserved=(await state()).objects;await page.locator('#btnReaderMode').click();
  assert.equal(await page.locator('.objHandle:visible').count(),0);assert.deepEqual((await state()).objects,preserved);
  await page.locator('#btnReaderMode').click();assert.deepEqual((await state()).objects,preserved);pass('viewer/editor mode retains mirrors');}

  if(!mobile){
   const old=await page.evaluate(()=>resizeProbe.native()),b=await page.locator('.origBox').boundingBox();
   await drag('.origBox .oh.se',-b.width*1.5,0,false);
   await page.waitForFunction(n=>resizeProbe.state().undo>n,old.undo);const after=await page.evaluate(()=>resizeProbe.nativeState());
   const a=old.hits[0].b,z=after.hits[0].b;assert.ok(z[0]<a[0]);assert.ok(Math.abs((z[2]-z[0])/(a[2]-a[0])-.5)<.04);const pixels=await page.evaluate(()=>resizeProbe.nativePixels());assert.deepEqual(pixels[0],[255,255,255]);assert.ok(pixels[1][2]>150 && pixels[1][0]<60,'native PDF pixels are mirrored');pass('native PDF resize crosses horizontal axis with mirrored saved pixels');
  }
  await page.evaluate(()=>resizeProbe.seed('img',0,{flipX:true,flipY:false}));await page.screenshot({path:path.join(out,mobile?'mobile.png':'desktop.png')});
  assert.deepEqual(errors,[]);await context.close();
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
 }catch(e){await current?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw e;}
 finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

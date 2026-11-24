const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {PDFDocument,PDFName,rgb}=require('pdf-lib');
const http=require('node:http'),path=require('node:path');
const assets=path.resolve('assets');
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const file=path.resolve('.', '.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(assets+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  const mime={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css','.woff2':'font/woff2'};
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
const html=fs.readFileSync('windows/PdfEditor.Preview/WebApp/view.html','utf8')
 .replace(/async function paintObjectClip\([^)]*\)\s*\{/,start=>start+'if(window.holdFragmentPaint) await window.holdFragmentPaint;')
 .replace('mountEditorControllers();',()=>`window.fragmentQA={
 ready:()=>editorStore.activeDocument?.fitDone,
 setup(){
   const p=editorStore.pages[0];
   p.texts=[{type:'rect',fx:.15,fy:.16,fw:.1,fh:.12,fill:'#ff0000',strokeOn:false},
     {type:'rect',fx:.13,fy:.14,fw:.1,fh:.10,fill:'#ffff00',fillOp:.5,strokeOn:false},
     {type:'text',text:'Frozen text',font:'spoqa',size:10,color:'#161616',fx:.33,fy:.24}];
   positionMarks(document.querySelector('#pg0'),p);
 },
 begin:startRegionSelect,placed:()=>!!stampData,undo,redo,settled:()=>eraserQueue,
 transformObject(rot,flipX){
   const p=editorStore.pages[1],o=p.texts[0];Object.assign(o,{rot,flipX});
   positionMarks(document.querySelector('#pg1'),p);
 },
 point(x,y) {
   const o=editorStore.pages[1].texts[0],dx=((x-this.box.x)/this.box.w-.5)*o.fw*500*(o.flipX?-1:1);
   const dy=((y-this.box.y)/this.box.h-.5)*o.fh*600,rad=(o.rot||0)*Math.PI/180;
   return [o.fx+o.fw/2+(dx*Math.cos(rad)-dy*Math.sin(rad))/500,
     o.fy+o.fh/2+(dx*Math.sin(rad)+dy*Math.cos(rad))/600];
 },
 focusProbe(x,y) {
   setZoom(8);const [fx,fy]=this.point(x,y);
   const v=viewer.getBoundingClientRect(),r=document.querySelector('#pg1').getBoundingClientRect();
   viewer.scrollLeft+=r.left+fx*r.width-v.left-viewer.clientWidth/2;
   viewer.scrollTop+=r.top+fy*r.height-v.top-viewer.clientHeight/2;
   const end=document.querySelector('#pg1').getBoundingClientRect();
   return {x:Math.floor(end.left+fx*end.width),y:Math.floor(end.top+fy*end.height),width:1,height:1};
 },
 erasePoint(){
   const r=document.querySelector('#pg1').getBoundingClientRect(),[x,y]=this.point(.53,.30);
   return [r.left+x*r.width,r.top+y*r.height];
 },
 zoom:setZoom,go:gotoPage,mode:setViewMode,
 metadata:()=>editorStore.pages[1].texts.map(({data,...o})=>o),
 clearOriginal(){editorStore.pages[0].texts=[];positionMarks(document.querySelector('#pg0'),editorStore.pages[0]);},
 pageCount:()=>editorStore.pages.length,
 async transferredPixels(){
   const object=editorStore.pages[1].texts[0],packet=await serializeObjectForWebClipboard(object);
   const {pages,sourceId}=await materializeClipboardPacket(packet),copy=pages[0].texts[0];
   try {
     const canvas=await paintObjectClip(copy,400,350);
     const ctx=canvas.getContext('2d'),pixel=(x,y)=>Array.from(ctx.getImageData(
       Math.floor((x-this.box.x)/this.box.w*canvas.width),Math.floor((y-this.box.y)/this.box.h*canvas.height),1,1).data);
     return {hole:pixel(.53,.30),red:pixel(.24,.25),strokes:copy.clipErasures?.length||0};
   } finally {
     const source=sources.get(sourceId);displayPainter.invalidateSource(sourceId);
     sources.delete(sourceId);await source.doc.loadingTask?.destroy();
   }
 },
 async duplicatePixels(){
   const copy=editorStore.pages[2],source=sources.get(copy.src).doc,page=await source.getPage(copy.idx+1);
   const canvas=document.createElement('canvas');
   await displayPainter.paintPage(copy,canvas,2);
   const colors=[[.24,.25],[.53,.30]].map(([x,y])=>{
     const [fx,fy]=this.point(x,y);return Array.from(canvas.getContext('2d').getImageData(
       Math.floor(fx*canvas.width),Math.floor(fy*canvas.height),1,1).data).slice(0,3);
   });
   return {colors,objects:copy.texts.length,text:(await page.getTextContent()).items.map(i=>i.str).join('')};
 },
 async pixels(){
   const dest=editorStore.pages[1],o=dest.texts[0];
   const at=(canvas,x,y)=>Array.from(canvas.getContext('2d').getImageData(Math.min(canvas.width-1,Math.floor(x*canvas.width)),Math.min(canvas.height-1,Math.floor(y*canvas.height)),1,1).data).slice(0,3);
   const sample=canvas=>[[.24,.25],[.385,.14],[.18,.37],[.48,.33],[.20,.20],[.53,.30],[.5475,.30]].map(([x,y])=>at(canvas,...this.point(x,y)));
   const bytes=await buildPdf([dest]), saved=await withRegionSource(bytes,async id=>{
     const canvas=document.createElement('canvas');await displayPainter.paintPage({src:id,idx:0,rot:0,texts:[]},canvas,3);return sample(canvas);
   });
   let raster;await rasterOutput.render([dest],{scale:3},canvas=>{raster=sample(canvas)});
   const loading=openPdfDocument(bytes.slice()),doc=await loading.promise;
   try {const text=(await (await doc.getPage(1)).getTextContent()).items.map(i=>i.str).join('');return {saved,raster,text};}
   finally{await loading.destroy();}
 },
 async transformed(){
   const output=[];
   for(const transform of [{rot:90,crop:[.08,.1,.85,.8]},{rot:270,resize:[604,410],crop:[.06,.12,.84,.8]}]){
     const p={...clonePage(editorStore.pages[0]),...transform,texts:[]};
     const selection={fx:.04,fy:.05,fw:.9,fh:.88},fragment=await freezeRegion(p,selection);
     try{
       const original=await renderPageRegion(p,.04,.05,.9,.88,1.25);
       const copy=await withRegionSource(fragment.bytes,async id=>{
         const c=document.createElement('canvas');await displayPainter.paintPage({src:id,idx:0,rot:0,texts:[]},c,1.25);return c;
       });
       const a=original.getContext('2d').getImageData(0,0,original.width,original.height).data;
       const b=copy.getContext('2d').getImageData(0,0,copy.width,copy.height).data;
       let matching=0,total=0;
       for(let y=1;y<original.height-1;y++)for(let x=1;x<original.width-1;x++){
         const i=(y*original.width+x)*4,j=(Math.floor(y*copy.height/original.height)*copy.width+Math.floor(x*copy.width/original.width))*4;
         if (Math.max(a[i],a[i+1],a[i+2])-Math.min(a[i],a[i+1],a[i+2])<120) continue;
         total++;if(Math.max(...[0,1,2].map(k=>Math.abs(a[i+k]-b[j+k])))<25)matching++;
       }
       function bounds(data,w,h){
         return ['green','magenta'].map((color)=>{
           let l=w,r=0,t=h,b=0,n=0,center=[];
           for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;
             if(color==='green' ? data[i+1]-data[i]<120 : data[i]-data[i+1]<120 || data[i+2]-data[i+1]<120)continue;
             l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);n++;
           }
           const i=4*(Math.floor((t+b)/2)*w+Math.floor((l+r)/2));center=Array.from(data.slice(i,i+3));
           return {l,r,t,b,n,center};
         });
       }
       output.push({matching,total,rotation:transform.rot,before:bounds(a,original.width,original.height),after:bounds(b,copy.width,copy.height),size:[original.width,original.height,copy.width,copy.height]});
     }finally{await fragment.loading.destroy();}
   }
   return output;
 },
 seam(setup=false){
   const p=editorStore.pages[0],o=editorStore.pages[1].texts[0],wrap=document.querySelector('#pg0');
   const {x,y,w,h}=this.box;
   if(setup){
     gotoPage(1);setZoom(6.5);
     p.texts=[{...o,fx:x,fy:y,fw:w,fh:h}];positionMarks(wrap,p);
     const v=viewer.getBoundingClientRect(),r=wrap.getBoundingClientRect();
     viewer.scrollLeft+=r.left+r.width*192.625/400-v.left-viewer.clientWidth/2;
     viewer.scrollTop+=r.top+r.height*(y+h)-v.top-viewer.clientHeight/2;
   }
   const r=wrap.getBoundingClientRect();
   return {x:Math.round(r.left+r.width*192.625/400)-32,y:Math.round(r.top+r.height*(y+h))-9,width:64,height:18};
 },
 focusLine(copy){
   const index=copy?1:0;gotoPage(index+1);setZoom(15);
   const o=editorStore.pages[1].texts[0],x=copy?o.fx+(.481-this.box.x)/this.box.w*o.fw:.481;
   const y=copy?o.fy+(.4-this.box.y)/this.box.h*o.fh:.4;
   const v=viewer.getBoundingClientRect(),p=document.querySelector('#pg'+index).getBoundingClientRect();
   viewer.scrollLeft+=p.left+x*p.width-v.left-viewer.clientWidth/2;
   viewer.scrollTop+=p.top+y*p.height-v.top-viewer.clientHeight/2;
   return {x:Math.round(v.left+viewer.clientWidth/2)-35,y:Math.round(v.top+viewer.clientHeight/2)-3,width:70,height:6};
 },
 async captureSaved(){
   const p=editorStore.pages[1], bytes=await buildPrintPdf([p]);
   this.probes=[[.53,.3],[.24,.25],[.481,.4]].map(([x,y])=>this.point(x,y));
   return Array.from(bytes);
 },
 async checkReopened(){
   const p=editorStore.pages[0], bytes=await buildPdf([p]);
   return withRegionSource(bytes,async (id,doc)=>{
     const page={src:id,idx:0,rot:0,texts:[]}, pixels=[];
     for(const [x,y] of this.probes){
       const c=document.createElement('canvas');
       await displayPainter.paintRegion(page,c,15,1,{x:(Math.round(x*500*15)-35)/15,
         y:Math.floor(y*600*15)/15,width:70/15,height:3/15});
       const rgba=c.getContext('2d').getImageData(0,1,70,1).data;
       let black=0,gray=0;
       for(let i=0;i<rgba.length;i+=4){if(rgba[i]<16)black++;else if(rgba[i]<240)gray++;}
       pixels.push({center:Array.from(rgba.slice(35*4,35*4+3)),black,gray});
     }
     const text=(await (await doc.getPage(1)).getTextContent()).items.map(i=>i.str).join('');
     return {pixels,text};
   });
 },
 selection(){const {fx:x,fy:y,fw:w,fh:h}=regionSelection;this.box={x,y,w,h};return this.box;}
};mountEditorControllers();`);
(async()=>{
 const doc=await PDFDocument.create(),p=doc.addPage([400,500]);doc.addPage([500,600]).drawRectangle({x:0,y:0,width:500,height:600,color:rgb(0,0,1)});
 p.drawRectangle({x:192,y:80,width:1.25,height:380,color:rgb(0,0,0)});
 p.drawText('Original line',{x:104,y:329,size:12});
 p.drawText('OUTSIDE-COPY-4511',{x:12,y:18,size:9});
 const a=doc.context;
 const form=a.formXObject([require('pdf-lib').setFillingRgbColor(0,.7,0),require('pdf-lib').rectangle(0,0,1,1),require('pdf-lib').fill()],{BBox:[0,0,1,1],Resources:{}});
 const green=a.obj({Type:'Annot',Subtype:'Square',Rect:[140,415,175,445],AP:{N:a.register(form)},F:4});
 const purple=a.obj({Type:'Annot',Subtype:'Square',Rect:[55,300,90,327],C:[0,0,0],IC:[1,0,1],F:4});
 p.node.set(PDFName.of('Annots'),a.obj([a.register(green),a.register(purple)]));
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
 const mobile=process.env.FRAGMENT_MOBILE==='1';
 const ctx=await browser.newContext({viewport:mobile?{width:412,height:820}:{width:1300,height:900},isMobile:mobile,hasTouch:mobile,bypassCSP:true});
 await ctx.addInitScript(()=>{localStorage.setItem('pdfEditor.tutorialSeen','1');localStorage.setItem('pdfEditor.startupMode','blank');
 const handlers=[];Object.defineProperty(window.chrome,'webview',{value:{addEventListener(t,h){if(t==='message')handlers.push(h)},removeEventListener(){},postMessage(m){if(m.type==='view-ready')queueMicrotask(()=>handlers.forEach(h=>h({data:{cmd:'dismiss-boot-splash'}})))}}});});
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.warn(e.message)});
 page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource'))console.warn(m.text().slice(0,500))});
 await page.route('**/fragment-qa',route=>route.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://127.0.0.1:'+server.address().port+'/fragment-qa');
 await page.waitForFunction(()=>typeof window.fragmentQA==='object');
 await page.locator('#appBootSplash').waitFor({state:'hidden'});
 await page.locator('#fileInput').setInputFiles({name:'Region QA.pdf',mimeType:'application/pdf',buffer:Buffer.from(await doc.save())});
 await page.waitForFunction(()=>window.fragmentQA?.ready()&&document.querySelector('#pg0')?.dataset.rendered);
 await page.evaluate(()=>{fragmentQA.mode('single');fragmentQA.setup();fragmentQA.begin();});
 const box=await page.locator('#pg0').boundingBox();
 await page.mouse.move(box.x+box.width*.1,box.y+box.height*.1);await page.mouse.down();
 await page.mouse.move(box.x+box.width*.6,box.y+box.height*.45,{steps:8});await page.mouse.up();
 const selection=await page.evaluate(()=>fragmentQA.selection());
 await page.locator('#regionCopyCommit').click();await page.waitForFunction(()=>fragmentQA.placed(),{},{timeout:90000});
 await page.evaluate(()=>{fragmentQA.clearOriginal();fragmentQA.go(2)});
 const dest=await page.locator('#pg1').boundingBox();
 await page.mouse.click(dest.x+dest.width*.5,dest.y+dest.height*.5);
 await page.waitForFunction(()=>document.querySelector('#pg1 foreignObject canvas')?.width>0);
 const [o]=await page.evaluate(()=>fragmentQA.metadata());assert.equal(o.clipFragment,true);
 assert.ok(Math.abs(o.fw*500-selection.w*400)<1 && Math.abs(o.fh*600-selection.h*500)<1);
 await page.evaluate(()=>{fragmentQA.zoom(15);document.querySelector('#pg1 .obj').scrollIntoView({block:'center',inline:'center'})});
 await page.waitForFunction(()=>document.querySelector('#pg1 foreignObject canvas')?.width>300);
 async function checkZoomFrames(label){
   const drift=await page.evaluate(()=>{
     const wrap=document.querySelector('#pg1'),viewer=document.querySelector('#viewer');
     const svg=wrap.querySelector('.imageVisual'),image=svg.querySelector('image');
     const detail=svg.querySelector('foreignObject canvas'),tile=detail.getBoundingClientRect();
     const photo=image.getBoundingClientRect(),sheet=wrap.getBoundingClientRect();
     const unit=(inner,outer)=>[(inner.left-outer.left)/outer.width,(inner.top-outer.top)/outer.height,
       inner.width/outer.width,inner.height/outer.height];
     const object=unit(photo,sheet),region=unit(tile,photo),errors=[];
     const view=viewer.getBoundingClientRect(),x=(view.left+view.right)/2,y=(view.top+view.bottom)/2;
     function measure(){
       const tile=detail.getBoundingClientRect(),photo=image.getBoundingClientRect(),sheet=wrap.getBoundingClientRect();
       const error=(actual,expected,width,height)=>Math.max(...actual.map((n,i)=>Math.abs(n-expected[i])*(i%2?height:width)));
       errors.push(Math.max(error(unit(photo,sheet),object,sheet.width,sheet.height),
         error(unit(tile,photo),region,photo.width,photo.height)));
     }
     for(const deltaY of [-1,-1,1,-1,1,1]){
       viewer.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY,clientX:x,clientY:y,cancelable:true,bubbles:true}));
       measure();
     }
     document.querySelector('#btnZoomIn').click();measure();document.querySelector('#btnZoomOut').click();measure();
     return errors;
   });
   console.log(label+' maximum zoom drift (CSS px):',Math.max(...drift));
   assert.ok(drift.every(px=>px<.2),'pasted detail shifted during zoom: '+JSON.stringify(drift));
 }
 await checkZoomFrames('cropped detail tile');
 await page.evaluate(()=>fragmentQA.seam(true));
 await page.waitForFunction(()=>{
   const w=document.querySelector('#pg0');
   return w?.querySelector('foreignObject canvas')?.width>300 && w._tiles?.tiles.size &&
     w.dataset.rendered===w._tiles.key && !w._tiles.cancelled && !w._task;
 });
 await page.evaluate(()=>{window.holdFragmentPaint=new Promise(resolve=>{window.resumeFragmentPaint=resolve});});
 async function compareSeam(label){
   const clip=await page.evaluate(()=>fragmentQA.seam());
   const png=(await page.screenshot({clip})).toString('base64');
   const offset=await page.evaluate(async png=>{
     const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();
     const c=document.createElement('canvas'),g=c.getContext('2d');g.drawImage(image,0,0);
     function center(y){
       const row=g.getImageData(0,y,image.width,1).data;let sum=0,n=0;
       for(let x=0;x<image.width;x++) {const ink=1-row[x*4]/255;sum+=x*ink;n+=ink;}
       if(n<2) throw new Error('missing line at copied boundary row '+y+' ink '+n);return sum/n;
     }
     return [center(3),center(14)];
   },png);
   const difference=Math.abs(offset[0]-offset[1]);
   console.log(label+' line offset across paste boundary:',difference);
   assert.ok(difference<(label==='refined'?1.1:1.6),label+' split the line at the pasted boundary: '+offset);
 }
 await compareSeam('before zoom');
 for(const direction of ['In','In','Out']){
   await page.evaluate(d=>document.querySelector('#btnZoom'+d).click(),direction);
   await compareSeam('zoom '+direction);
 }
 await page.evaluate(()=>{window.resumeFragmentPaint();window.holdFragmentPaint=null;});
 await page.waitForTimeout(400);await compareSeam('refined');
 await page.evaluate(()=>fragmentQA.clearOriginal());
 const measureLine=async copy=>{
   const clip=await page.evaluate(copy=>fragmentQA.focusLine(copy),copy);
   await page.waitForTimeout(700);
   const png=(await page.screenshot({clip})).toString('base64');
   const widths=await page.evaluate(async png=>{
     const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();
     const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
     const context=canvas.getContext('2d');context.drawImage(image,0,0);
     const px=context.getImageData(0,3,image.width,1).data;
     let black=0,gray=0;for(let i=0;i<px.length;i+=4){if(px[i]<16)black++;else if(px[i]<240)gray++;}
     return {black,gray};
   },png);
   return widths;
 };
 const edgeWidths=[await measureLine(false),await measureLine(true)];
 console.log('1500% screen line, original and copy:',edgeWidths);
 assert.ok(edgeWidths.every(e=>e.black>14&&e.black<22&&e.gray<=4),'screen black line degraded');
 assert.ok(Math.abs(edgeWidths[0].black-edgeWidths[1].black)<=2,'line width changed on screen');
 const results=await page.evaluate(()=>fragmentQA.pixels());
 console.log(JSON.stringify(results));
 for(const pixels of [results.saved,results.raster]){
   assert.ok(pixels[0][0]>230 && pixels[0][1]<30,'red editor overlay');
   assert.ok(pixels[1][1]>140 && pixels[1][0]<40,'green annotation with AP');
   assert.ok(pixels[2][0]>225 && pixels[2][2]>225 && pixels[2][1]<40,'magenta annotation without AP');
   assert.ok(Math.max(...pixels[3])<60,'black vector line');
   assert.ok(pixels[4][0]>250 && pixels[4][1]>119 && pixels[4][1]<137 && pixels[4][2]<5,'clipped translucent overlay order');
 }
 assert.equal(results.text,'','only visible pixels should be embedded for the region');
 for(const tip of ['round','square','chisel','soft']){
   await page.evaluate(tip=>{fragmentQA.zoom(1);fragmentQA.transformObject(tip==='chisel'?32:0,tip==='chisel');document.querySelector('#pg1 .obj').scrollIntoView({block:'center',inline:'center'});},tip);
   await page.locator('#btnDraw').click();await page.locator('[data-ink-brush]').selectOption('eraser');
   await page.locator('[data-eraser-tip]').selectOption(tip);await page.locator('[data-ink-width]').fill('20');
   const [x,y]=await page.evaluate(()=>fragmentQA.erasePoint());
   await page.mouse.click(x,y);await page.evaluate(()=>fragmentQA.settled());await page.keyboard.press('Escape');
   const [erased]=await page.evaluate(()=>fragmentQA.metadata());
   assert.equal(erased.clipSrc,o.clipSrc);assert.equal(erased.clipErasures.length,1);
   const edited=await page.evaluate(()=>fragmentQA.pixels());
   assert.equal(edited.text,'');
   for(const pixels of [edited.saved,edited.raster]){
     assert.ok(pixels[5][0]<14&&pixels[5][1]<14&&pixels[5][2]>240,tip+' erased center '+pixels[5]);
     if(tip==='soft') assert.ok(pixels[6][0]>55 && pixels[6][0]<220,tip+' feather '+pixels[6]);
   }
   if(tip==='soft') assert.ok(Math.abs(edited.saved[6][0]-edited.raster[6][0])<22,'soft mask mismatch');
   if(tip==='soft') {
     const clip=await page.evaluate(()=>fragmentQA.focusProbe(.5475,.30));
     await page.waitForTimeout(500);
     const png=(await page.screenshot({clip})).toString('base64');
     const screen=await page.evaluate(async png=>{
       const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();
       const c=document.createElement('canvas'),g=c.getContext('2d');g.drawImage(img,0,0);
       return Array.from(g.getImageData(0,0,1,1).data).slice(0,3);
     },png);
     assert.ok(Math.abs(screen[0]-edited.raster[6][0])<22,'soft edge on screen '+screen+' vs output '+edited.raster[6]);
   }
   if(tip==='round') {
     await page.waitForFunction(()=>document.querySelector('#pg1 foreignObject canvas')?.width>0);
     const mark=page.locator('#pg1 .obj').first(),box=await mark.boundingBox();
     const mx=box.x+box.width*.4,my=box.y+box.height*.6;
     await page.mouse.move(mx,my);await page.mouse.down();await page.mouse.move(mx+24,my+16,{steps:5});await page.mouse.up();
     assert.deepEqual(errors,[],'error when moving erased paste');
     const transfer=await page.evaluate(()=>fragmentQA.transferredPixels());
     assert.deepEqual(transfer.hole,[0,0,0,0]);assert.deepEqual(transfer.red,[255,0,0,255]);assert.equal(transfer.strokes,0);
     await mark.waitFor({state:'visible',timeout:2500});
     const [moved]=await page.evaluate(()=>fragmentQA.metadata());
     assert.ok(moved.fx>erased.fx && moved.fy>erased.fy,'paste moved');
     await page.locator('#sidebar .thumb[data-k="1"]').click({button:'right'});
     await page.locator('#ctxMenu [data-cmd="dupImg"]').click();
     await page.waitForFunction(()=>fragmentQA.pageCount()===3 && !document.querySelector('#spin')?.classList.contains('show'),null,{timeout:15000});
     assert.deepEqual(errors,[],'duplicate rebuild');
     const duplicate=await page.evaluate(()=>fragmentQA.duplicatePixels());
     assert.ok(duplicate.colors[0][0]>225&&duplicate.colors[0][1]<26,'duplicated red');
     assert.ok(duplicate.colors[1][2]>225&&duplicate.colors[1][0]<26,'duplicated hole');
     assert.equal(duplicate.objects,0);assert.equal(duplicate.text,'');
     await page.evaluate(()=>{fragmentQA.undo();fragmentQA.undo();fragmentQA.go(2);});
     await page.waitForFunction(()=>document.querySelector('#pg1 foreignObject canvas')?.width>0);
     await checkZoomFrames('erased copy');
     const after=await measureLine(true);console.log('1500% screen after partial erase:',after);
     assert.deepEqual(after,edgeWidths[1]);
   }
   await page.evaluate(()=>fragmentQA.undo());
   const [undone]=await page.evaluate(()=>fragmentQA.metadata());assert.equal(undone.clipErasures,undefined);
   await page.evaluate(()=>fragmentQA.redo());
   assert.equal((await page.evaluate(()=>fragmentQA.metadata()))[0].clipErasures.length,1);
   await page.evaluate(()=>fragmentQA.undo());
   console.log('PASS region partial erase, PDF/raster transparency, isolated pixels, undo/redo:',tip);
 }
 const geometry=await page.evaluate(()=>fragmentQA.transformed());console.log('rotated, resized and cropped sheets:',JSON.stringify(geometry));
 for(const {matching,total,before,after} of geometry){
   assert.ok(total>200 && matching/total>.93,'transformed annotation colors');
   before.forEach((shape,i)=>{
     for(const edge of ['l','r','t','b']) assert.ok(Math.abs(shape[edge]-after[i][edge])<=1,'transformed annotation edge '+edge);
   });
 }
 await page.evaluate(()=>{fragmentQA.zoom(1);fragmentQA.transformObject(0,false);document.querySelector('#pg1 .obj').scrollIntoView({block:'center',inline:'center'});});
 await page.locator('#btnDraw').click();await page.locator('[data-ink-brush]').selectOption('eraser');
 await page.locator('[data-eraser-tip]').selectOption('round');await page.locator('[data-ink-width]').fill('20');
 const [ex,ey]=await page.evaluate(()=>fragmentQA.erasePoint());
 await page.mouse.move(ex-3,ey);await page.mouse.down();await page.mouse.move(ex+3,ey,{steps:5});await page.mouse.up();
 await page.evaluate(()=>fragmentQA.settled());
 await page.locator('[data-eraser-tip]').selectOption('soft');await page.mouse.click(ex+11,ey);await page.evaluate(()=>fragmentQA.settled());
 assert.equal((await page.evaluate(()=>fragmentQA.metadata()))[0].clipErasures.length,2);
 await page.keyboard.press('Escape');
 const saved=await page.evaluate(()=>fragmentQA.captureSaved());
 const parsed=await PDFDocument.load(Uint8Array.from(saved));
 const {PDFRawStream,decodePDFRawStream}=require('pdf-lib');
 const outside='OUTSIDE-COPY-4511',encoded=Buffer.from(outside).toString('hex').toUpperCase();
 for(const [,stream] of parsed.context.enumerateIndirectObjects()){
   if(!(stream instanceof PDFRawStream)||stream.dict.get(PDFName.of('Subtype'))?.toString()==='/Image')continue;
   const plain=Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
   assert.ok(!plain.includes(outside)&&!plain.toUpperCase().includes(encoded),'cropped-away page content remains in PDF');
 }
 if(process.env.FRAGMENT_SAVED_PDF)fs.writeFileSync(process.env.FRAGMENT_SAVED_PDF,Buffer.from(saved));
 const reopenedPage=await ctx.newPage();
 reopenedPage.on('pageerror',e=>errors.push(e.message));
 await reopenedPage.route('**/fragment-qa',route=>route.fulfill({contentType:'text/html',body:html}));
 await reopenedPage.goto('http://127.0.0.1:'+server.address().port+'/fragment-qa');
 await reopenedPage.locator('#appBootSplash').waitFor({state:'hidden'});
 await reopenedPage.evaluate(probes=>{fragmentQA.probes=probes},await page.evaluate(()=>fragmentQA.probes));
 await reopenedPage.locator('#fileInput').setInputFiles({name:'Edited region.pdf',mimeType:'application/pdf',buffer:Buffer.from(saved)});
 await reopenedPage.waitForFunction(()=>fragmentQA.ready()&&!document.querySelector('#pg1')&&document.querySelector('#pg0')?.dataset.rendered);
 const reopened=await reopenedPage.evaluate(()=>fragmentQA.checkReopened());
 assert.ok(reopened.pixels[0].center[2]>245 && reopened.pixels[0].center[0]<10);
 assert.deepEqual(reopened.pixels[1].center,[255,0,0]);
 assert.ok(reopened.pixels[2].gray<=3 && Math.abs(reopened.pixels[2].black-edgeWidths[1].black)<=1);
 await reopenedPage.locator('#btnDraw').click();await reopenedPage.locator('[data-ink-brush]').selectOption('eraser');
 await reopenedPage.locator('[data-eraser-tip]').selectOption('square');await reopenedPage.locator('[data-ink-width]').fill('16');
 const xy=await reopenedPage.evaluate(()=>{const r=document.querySelector('#pg0').getBoundingClientRect(),[x,y]=fragmentQA.probes[1];return [r.left+x*r.width,r.top+y*r.height];});
 await reopenedPage.mouse.click(...xy);await reopenedPage.evaluate(()=>fragmentQA.settled());
 const twice=await reopenedPage.evaluate(()=>fragmentQA.checkReopened());
 console.log('Saved and reopened, then erased again:',JSON.stringify({reopened,twice}));
 assert.equal(twice.text,'');
 assert.deepEqual(twice.pixels[0].center,[0,0,255]);assert.deepEqual(twice.pixels[1].center,[0,0,255]);
 assert.deepEqual(twice.pixels[2],reopened.pixels[2]);
 assert.deepEqual(errors,[]);console.log('PASS snapshot independence, true size on different paper, bounded image data, annotations, zoom refinement and raster/PDF outputs');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

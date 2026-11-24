const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {PDFDocument}=require('pdf-lib');
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
const pc=process.env.PAGE_POSITION_PC==='1';
let html=fs.readFileSync(pc ? 'windows/PdfEditor.Preview/WebApp/view.html' : 'PDF편집기.html','utf8').replaceAll('__APP_VER__','page-position-test')
 .replace('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js','/assets/windows-vendor/pdf-lib/1.17.1/pdf-lib.min.js')
 .replace('https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js','/assets/windows-vendor/fontkit/1.1.1/fontkit.umd.min.js');
html=html.replace('mountEditorControllers();',`window.pagePositionTest={
 mode:setViewMode,go:gotoPage,zoom:z=>viewportZoom.to(z),
 ready:()=>!!editorStore.activeDocument?.fitDone,page:()=>editorStore.currentPage,scale:()=>editorStore.zoom,
 flip:flipPage,tab:i=>switchDoc(editorStore.documents[i]),doc:()=>editorStore.activeDocument?.name,
 dirty:()=>editorStore.dirty,
};\nmountEditorControllers();`);
(async()=>{
 const pdf=await PDFDocument.create();
 for(let i=0;i<4;i++) pdf.addPage(i===1?[842,595]:[595,842]).drawText('Page '+(i+1),{x:50,y:500,size:28});
 const buffer=Buffer.from(await pdf.save());
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:'chrome'})});
 let origin=process.env.PAGE_POSITION_ORIGIN;
 if(!origin){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;}
 try{for(const mobile of [false,true]){
 const label=(pc?'pc':'web')+'-'+(mobile?'mobile':'desktop');
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:960},hasTouch:mobile,isMobile:mobile,bypassCSP:true});
 await context.addInitScript(()=>{for(const k of ['tutorialSeen','readerTutorialSeen'])localStorage.setItem('pdfEditor.'+k,'1');localStorage.setItem('pdfEditor.startupMode','blank');});
 if(pc) await context.addInitScript(()=>{
   const handlers=[];
   Object.defineProperty(window.chrome,'webview',{value:{
     addEventListener(type,handler){if(type==='message')handlers.push(handler);},removeEventListener(){},
     postMessage(message){if(message.type==='view-ready')queueMicrotask(()=>handlers.forEach(h=>h({data:{cmd:'dismiss-boot-splash'}})));}
   }});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>{console.error(e.message);errors.push(e.message)});page.setDefaultTimeout(15000);
 await page.route(origin+'/?page-position-test',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto(origin+'/?page-position-test');
 await page.waitForFunction(()=>typeof pagePositionTest!=='undefined');
 await page.locator('#fileInput').setInputFiles({name:'Scroll space.pdf',mimeType:'application/pdf',buffer});
 await page.waitForFunction(()=>pagePositionTest.ready()&&document.querySelector('#pg0 canvas')?.width>100);await page.waitForTimeout(300);
 for(const mode of ['single','double','scroll']){
   await page.evaluate(mode=>{pagePositionTest.mode(mode);pagePositionTest.go(1);},mode);
   const next=mode==='double'?2:1;
   const pan=(index,zoom,fx,fy)=>page.evaluate(({index,zoom,fx,fy})=>{
     pagePositionTest.zoom(zoom);
     const v=document.querySelector('#viewer'),r=document.querySelector('#pg'+index).getBoundingClientRect(),b=v.getBoundingClientRect();
     v.scrollLeft+=r.left+fx*r.width-b.left-v.clientWidth/2;
     v.scrollTop+=r.top+fy*r.height-b.top-v.clientHeight/2;
   },{index,zoom,fx,fy});
   const location=index=>page.evaluate(index=>{
     const v=document.querySelector('#viewer'),r=document.querySelector('#pg'+index).getBoundingClientRect(),b=v.getBoundingClientRect();
     return {x:b.left+v.clientWidth/2-r.left,y:b.top+v.clientHeight/2-r.top,zoom:pagePositionTest.scale(),page:pagePositionTest.page()};
   },index);
   const check=async(index,expected)=>{
     const actual=await location(index);
     assert.equal(actual.page,index,label+' '+mode+' page');
     assert.equal(actual.zoom,expected.zoom,label+' '+mode+' zoom');
     for(const axis of ['x','y'])assert.ok(Math.abs(actual[axis]-expected[axis])<1.1,
       label+' '+mode+' '+axis+' '+JSON.stringify({expected,actual}));
   };
   await pan(0,2.5,.62,.64);await page.waitForTimeout(220);
   const first=await location(0);
   await page.locator('.thumb[data-k="'+next+'"]').dispatchEvent('click');
   await pan(next,3.25,.69,.57);await page.waitForTimeout(220);
   const second=await location(next);
   for(let i=0;i<2;i++){
     if(mode==='double')await page.evaluate(()=>pagePositionTest.flip(-1));
     else await page.locator('#pgPrev').dispatchEvent('click');
     await page.waitForTimeout(220);await check(0,first);
     await page.locator('#pageJump').evaluate((input,n)=>{
       input.value=String(n);input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
     },next+1);
     await page.waitForTimeout(220);await check(next,second);
   }
   if(mode==='scroll'){
     await page.locator('#pg2').evaluate(p=>p.scrollIntoView({block:'center'}));await page.waitForTimeout(220);
     assert.equal(await page.evaluate(()=>pagePositionTest.page()),2);
     await page.locator('.thumb[data-k="1"]').dispatchEvent('click');await page.waitForTimeout(220);await check(next,second);
     if (!pc) {
       await page.locator('#fileInput').setInputFiles({name:'Separate.pdf',mimeType:'application/pdf',buffer});
       await page.waitForFunction(()=>pagePositionTest.doc()==='Separate' && pagePositionTest.ready());
       await pan(0,1.75,.4,.5);
       await page.evaluate(()=>pagePositionTest.tab(0));await page.waitForTimeout(220);await check(next,second);
     }
     assert.equal(await page.evaluate(()=>pagePositionTest.dirty()),false,label+' reading changed the document');
   }
 }
 assert.deepEqual(errors,[]);console.log('PASS '+label+': three viewing modes, page return, independent zoom, horizontal and vertical position');await context.close();
 }}finally{await browser.close();if(server.listening)server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

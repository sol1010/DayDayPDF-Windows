const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createPrintResourceMonitor } = require("./print-resource-monitor.cjs");
const root = path.resolve(__dirname, "../.."), input = path.resolve(process.argv[2]), html = path.resolve(process.argv[3]), out = path.resolve(process.argv[4]);
fs.mkdirSync(out, { recursive: true });
const hook = String.raw`window.imageCopyProbe={
 async seed(input){const style=typeof input==='string'?{mode:input}:input,mode=style.mode;const p=editorStore.pages[0];delete p.crop;delete p.resize;p.rot=0;
  if(mode==='crop')p.crop=[.1,.15,.75,.7];if(mode==='rotation')p.rot=90;if(mode==='resize')p.resize=[500,700];
  const cv=document.createElement('canvas');cv.width=80;cv.height=40;const c=cv.getContext('2d');c.fillStyle='#ff00ff';c.fillRect(0,0,80,40);
  p.texts=[{type:'img',data:cv.toDataURL(),fx:.12,fy:.22,fw:.22,fh:.13,rot:17,flipX:true},
   {text:'Added text wraps here ABCDEFGHIJ',font:'roboto',size:19,color:'#008000',fx:.42,fy:.4,fw:.20,fh:.23,align:'right',valign:'middle'}];
  Object.assign(p.texts[1],style.textStyle||{});if(style.auto){delete p.texts[1].fw;delete p.texts[1].fh;}
  await ensureScreenFont(p.texts[1].font,!!p.texts[1].bold,{characters:p.texts[1].text});rebuildAll();viewportZoom.to(matchMedia('(max-width:768px)').matches?.6:1);deselectText();setOrigMode(false);
 },
 async raster(){let data;const p=clonePage(editorStore.pages[0]);await rasterOutput.render([p],{scale:editorStore.zoom},async c=>{data=c.toDataURL();});return data;},
 async duplicate(indexes){const t=performance.now();const r=await makeRasterSource(indexes,{openDocument:false});await fetch('/result.pdf',{method:'POST',body:r.bytes});return {ms:performance.now()-t,bytes:r.bytes.length,limited:r.limited,quality:r.qualityLabel};},
 async transactions(){
  const before=JSON.stringify(editorStore.pages.map(clonePage)),count=editorStore.pages.length,history=editorStore.undoStack.length;
  await duplicateAsImage([0]); const added=editorStore.pages[1], source=sources.get(added.src);
  const applied=editorStore.pages.length===count+1&&editorStore.undoStack.length===history+1&&added.texts.length===0&&added.rot===0;
  await fetch('/result.pdf',{method:'POST',body:source.bytes});undo();
  const restored=JSON.stringify(editorStore.pages.map(clonePage))===before;
  const pending=makeRasterSource([0],{openDocument:false});setTimeout(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})),0);
  let cancelled=false;try{await pending;}catch(e){cancelled=e.name==='AbortError'||e.name==='RenderingCancelledException';}finally{spin(false);}
  return {applied,restored,cancelled,unchanged:JSON.stringify(editorStore.pages.map(clonePage))===before,ready:!rasterPreparing};
 },
 count:()=>editorStore.pages.length
};mountEditorControllers();`;
const server = http.createServer((req, res) => {
 if(req.method==='POST' && req.url==='/result.pdf'){const stream=fs.createWriteStream(path.join(out,'result.pdf'));req.pipe(stream);stream.on('finish',()=>res.end('ok'));return;}
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
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});let monitor;
 try{
  const page=await browser.newPage({viewport:process.env.COPY_MOBILE?{width:390,height:844}:{width:1440,height:1000},isMobile:!!process.env.COPY_MOBILE,hasTouch:!!process.env.COPY_MOBILE,bypassCSP:true}),errors=[];page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(hosted=>{localStorage.setItem('pdfEditor.startupMode','blank');localStorage.setItem('pdfEditor.tutorialSeen','1');const h=[];if(hosted)Object.defineProperty(window.chrome,'webview',{value:{addEventListener(t,f){if(t==='message')h.push(f);},removeEventListener(){},postMessage(m){if(m.type==='view-ready')queueMicrotask(()=>h.forEach(f=>f({data:{cmd:'dismiss-boot-splash'}})));}}});},!process.env.COPY_WEB);
  await page.goto('http://127.0.0.1:'+server.address().port+'/view.html');await page.locator('#appBootSplash').waitFor({state:'hidden'});await page.locator('#fileInput').setInputFiles(input);await page.waitForFunction(()=>imageCopyProbe.count()>0&&document.querySelector('#pg0')?.dataset.rendered);
  const results=[];
  if(process.env.COPY_TRANSACTIONS){
   await page.evaluate(()=>imageCopyProbe.seed('normal'));const transaction=await page.evaluate(()=>imageCopyProbe.transactions());
   results.push(transaction);console.log(JSON.stringify(transaction));for(const [key,value] of Object.entries(transaction))assert.equal(value,true,key);
  }else if(process.env.COPY_BENCH){
   monitor=await createPrintResourceMonitor(browser,path.join(root,'windows/PdfEditor.Output.Tests/bin/Release/net10.0-windows/PdfEditor.Output.Tests.dll'));
   await monitor.begin();const stages=await page.evaluate(i=>imageCopyProbe.duplicate(i),process.env.COPY_BENCH.split(',').map(Number));const resources=await monitor.end();results.push({stages,resources});console.log(JSON.stringify({stages,peakWorkingSet:resources.peakWorkingSetBytes,peakPrivate:resources.peakPrivateBytes,averageCpu:resources.averageCpuPercent}));
  }else{
   const {PNG}=require(path.join(path.dirname(process.env.PLAYWRIGHT_MODULE),'pngjs'));
   function bounds(bytes,color){const png=PNG.sync.read(bytes),points=[];for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const i=(y*png.width+x)*4;if(color==='img'?png.data[i]>200&&png.data[i+1]<80&&png.data[i+2]>200:png.data[i]<80&&png.data[i+1]>75&&png.data[i+1]<175&&png.data[i+2]<80)points.push([x,y]);}return points.length?{left:Math.min(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),right:Math.max(...points.map(p=>p[0])),bottom:Math.max(...points.map(p=>p[1])),count:points.length}:null;}
   for(const scene of [{mode:'normal'},{mode:'crop'},{mode:'rotation'},{mode:'resize'},
    {mode:'normal',name:'korean',textStyle:{text:'추가 글자 위치 확인 ABCDEFGHIJ',font:'spoqa',align:'center',bold:true}},
    {mode:'normal',name:'mirror',textStyle:{rot:33,flipX:true,flipY:true}},
    {mode:'normal',name:'auto-width',auto:true}]){
    const mode=scene.name||scene.mode;await page.evaluate(m=>imageCopyProbe.seed(m),scene);await page.waitForFunction(()=>document.querySelector('#pg0')?.dataset.rendered);await page.waitForTimeout(250);
    const screenshot=await page.locator('#pg0').screenshot();fs.writeFileSync(path.join(out,mode+'-screen.png'),screenshot);
    const data=await page.evaluate(()=>imageCopyProbe.raster()),raster=Buffer.from(data.split(',')[1],'base64');fs.writeFileSync(path.join(out,mode+'-copy.png'),raster);
    const row={mode,image:{screen:bounds(screenshot,'img'),copy:bounds(raster,'img')},text:{screen:bounds(screenshot,'text'),copy:bounds(raster,'text')}};results.push(row);console.log(JSON.stringify(row));
    if(process.env.COPY_ASSERT)for(const kind of ['image','text'])for(const edge of ['left','top','right','bottom'])assert.ok(Math.abs(row[kind].screen[edge]-row[kind].copy[edge])<=3,mode+' '+kind+' '+edge+' mismatch');
   }
  }
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors},null,2));assert.deepEqual(errors,[]);
 }finally{await monitor?.close();await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

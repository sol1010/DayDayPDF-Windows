const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const PDFLib=require('pdf-lib'),{PDFDocument,PDFName}=PDFLib;
const root=path.resolve(__dirname,'../..'),output=path.resolve(root,'../output/raster-native-qa');
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.css':'text/css','.json':'application/json'};
const server=http.createServer((req,res)=>{const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);
 for(const base of [path.join(root,'windows/PdfEditor.Preview/WebApp'),root]){const file=path.resolve(base,route);if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())continue;
 res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);return;}res.writeHead(404);res.end();});
(async()=>{
 fs.mkdirSync(output,{recursive:true});const pdf=await PDFDocument.create();
 for(let i=0;i<30;i++){const p=pdf.addPage([842,595]);p.drawText('RASTER PAGE '+(i+1),{x:50,y:500,size:25});p.drawRectangle({x:80,y:100,width:450,height:250,color:PDFLib.rgb(.2,.5,.8)});}
 const bytes=Buffer.from(await pdf.save());await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  localStorage.setItem('pdfEditor.startupMode','blank');localStorage.setItem('pdfEditor.tutorialSeen','1');
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{},write:async()=>{}}});
  const handlers=new Map(),buffers=new Map();window.testMessages=[];window.testOutputs=[];window.testPackets=[];
  window.testDispatch=(name,event)=>(handlers.get(name)||[]).forEach(fn=>fn(event));
  const reply=data=>queueMicrotask(()=>testDispatch('message',{data}));
  Object.defineProperty(window.chrome,'webview',{value:{addEventListener(name,fn){if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(fn);},removeEventListener(){},releaseBuffer(){},
   postMessage(m){testMessages.push(m);
    if(m.type==='view-ready')reply({cmd:'dismiss-boot-splash'});
    if(m.type==='output-printers')reply({cmd:'output-result',requestId:m.requestId,ok:true,printers:[{name:'QA raster sink',isDefault:true,isPdf:false}]});
    if(m.type==='output-put'||m.type==='clipboard-put'){const buffer=new ArrayBuffer(m.size);buffers.set(m.requestId,{buffer,options:m});queueMicrotask(()=>testDispatch('sharedbufferreceived',{additionalData:{cmd:m.type==='output-put'?'output-buffer':'clipboard-put-buffer',requestId:m.requestId},getBuffer:()=>buffer}));}
    if(m.type==='output-put-done'){const item=buffers.get(m.requestId);buffers.delete(m.requestId);testOutputs.push({bytes:new Uint8Array(item.buffer),options:item.options});reply({cmd:'output-result',requestId:m.requestId,ok:true});}
    if(m.type==='clipboard-put-done'){const item=buffers.get(m.requestId);buffers.delete(m.requestId);testPackets.push(new Uint8Array(item.buffer));reply({cmd:'clipboard-put-committed',requestId:m.requestId});}
   }
  }});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/view.html?tab=raster-native-qa');await page.locator('#appBootSplash').waitFor({state:'hidden'});
 await page.evaluate(data=>{const buffer=new Uint8Array(data).buffer;testDispatch('sharedbufferreceived',{additionalData:{cmd:'open-document',name:'30 pages.pdf',requestId:'open'},getBuffer:()=>buffer});},Array.from(bytes));
 await page.waitForFunction(()=>testMessages.some(m=>m.type==='document-ready'&&m.ok));
 await page.keyboard.press('Control+p');await page.locator('#prPrinter').selectOption('QA raster sink');await page.locator('#prMode').selectOption('image');await page.locator('#prPaper').selectOption('a4');await page.locator('#prOrient').selectOption('auto');await page.locator('#prCopies').fill('1');
 let start=Date.now();await page.locator('#prOk').click();await page.waitForFunction(()=>testOutputs.length===1);const printMs=Date.now()-start;
 const data=Buffer.from(await page.evaluate(()=>Array.from(testOutputs[0].bytes))),printed=await PDFDocument.load(data);
 assert.equal(printed.getPageCount(),30);assert.equal(printed.context.enumerateIndirectObjects().filter(([,v])=>v instanceof PDFLib.PDFRawStream&&v.dict.get(PDFName.of('Subtype'))===PDFName.of('Image')).length,30);
 fs.writeFileSync(path.join(output,'print.pdf'),data);await page.locator('#spinner').waitFor({state:'hidden'});
 const thumbs=page.locator('#sidebar .thumb');await thumbs.nth(0).click();await thumbs.nth(2).click({modifiers:['Shift']});await thumbs.nth(1).click({button:'right'});await page.locator('#ctxMenu [data-cmd="exportDlg"]').click();
 start=Date.now();await page.locator('#exImage').click();await page.waitForFunction(()=>testMessages.some(m=>m.type==='request-new-from-clipboard'));const exportMs=Date.now()-start;
 const packet=Buffer.from(await page.evaluate(()=>Array.from(testPackets[0]))),{unpackShellClipboardPayload}=await import('../../src/adapters/shell-clipboard-codec.js');const payload=unpackShellClipboardPayload(packet),exported=await PDFDocument.load(payload.pdfBytes);
 assert.equal(exported.getPageCount(),3);assert.equal(payload.pages.length,3);
 for(let i=0;i<3;i++){assert.equal(payload.mapping[payload.pages[i].__sourceRef],i);assert.equal(payload.pages[i].src,null);}
 fs.writeFileSync(path.join(output,'export.pdf'),payload.pdfBytes);
 await page.goto('http://127.0.0.1:'+server.address().port+'/view.html?tab=raster-native-output');await page.locator('#appBootSplash').waitFor({state:'hidden'});
 await page.evaluate(data=>{const packet=new Uint8Array(data);const original=chrome.webview.postMessage.bind(chrome.webview);chrome.webview.postMessage=m=>{original(m);if(m.type==='clipboard-get')queueMicrotask(()=>testDispatch('sharedbufferreceived',{additionalData:{cmd:'clipboard-data',requestId:m.requestId,meta:{kind:'pages-v1'}},getBuffer:()=>packet.buffer}));};testDispatch('message',{data:{cmd:'paste-from-shell',title:'Exported images'}});},Array.from(packet));
 await page.waitForFunction(()=>document.querySelectorAll('#sidebar .thumb').length===3&&document.querySelector('#pg0 canvas')?.width>10);
 await page.waitForFunction(()=>[...document.querySelectorAll('#pg0 canvas')].some(c=>{if(!c.width||!c.height)return false;const p=c.getContext('2d').getImageData(Math.floor(c.width*.25),Math.floor(c.height*.5),1,1).data;return p[2]>150&&p[0]<90&&p[1]>90&&p[1]<160;}));
 await page.locator('#spinner').waitFor({state:'hidden'});await page.screenshot({path:path.join(output,'export-reopened.png')});assert.deepEqual(errors,[]);
 const results={printPages:30,printMs,printBytes:data.length,exportPages:3,exportMs,exportBytes:payload.pdfBytes.length,reopened:true};fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log('PASS',JSON.stringify(results));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());

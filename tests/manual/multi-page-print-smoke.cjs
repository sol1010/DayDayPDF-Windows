const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const pdfLib = require('../../node_modules/pdf-lib');
const { PDFDocument } = pdfLib;
const repo = path.resolve(__dirname, '../..');
const output = path.resolve(repo, '../output/multi-page-print-qa');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1);
  for (const root of [path.join(repo, 'windows/PdfEditor.Preview/WebApp'), repo]) {
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    if (relative === 'view.html') {
      const html = fs.readFileSync(file, 'utf8').replace('mountEditorControllers();', 'window.__multiPrint={resizeAll(){editorStore.pages.forEach(p=>{p.resize=[400,650];p.rot=90;p.crop=[.1,.05,.8,.9];});rebuildAll();}};mountEditorControllers();');
      res.end(html);
    } else fs.createReadStream(file).pipe(res); return;
  }
  res.writeHead(404); res.end();
});
(async () => {
 fs.mkdirSync(output,{recursive:true});
 const pdf=await PDFDocument.create();let n=123456789;const pixels=new Uint8Array(512*512*3);
 for(let i=0;i<pixels.length;i++){n^=n<<13;n^=n>>>17;n^=n<<5;pixels[i]=n&255;}
 const image=pdf.context.register(pdf.context.flateStream(pixels,{Type:'XObject',Subtype:'Image',Width:512,Height:512,ColorSpace:'DeviceRGB',BitsPerComponent:8}));
 for(let i=0;i<30;i++){const p=pdf.addPage([2384,1684]),name=p.node.newXObject('SharedDrawing',image);p.pushOperators(pdfLib.pushGraphicsState(),pdfLib.concatTransformationMatrix(700,0,0,700,100,100),pdfLib.drawObject(name),pdfLib.popGraphicsState());p.drawText('DRAWING PAGE '+(i+1),{x:400,y:1000,size:32});}
 const bytes=Buffer.from(await pdf.save());
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(60000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   localStorage.setItem('pdfEditor.startupMode','blank');localStorage.setItem('pdfEditor.tutorialSeen','1');
   const handlers=new Map(),buffers=new Map();window.testMessages=[];window.testOutputs=[];
   window.testDispatch=(name,event)=>(handlers.get(name)||[]).forEach(fn=>fn(event));
   const reply=data=>queueMicrotask(()=>testDispatch('message',{data}));
   Object.defineProperty(window.chrome,'webview',{value:{
    addEventListener(name,fn){if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(fn);},removeEventListener(){},releaseBuffer(){},
    postMessage(message){testMessages.push(message);
     if(message.type==='view-ready')reply({cmd:'dismiss-boot-splash'});
     if(message.type==='output-printers')reply({cmd:'output-result',requestId:message.requestId,ok:true,printers:[{name:'QA PDF',isDefault:true,isPdf:true},{name:'QA physical sink',isPdf:false}]});
     if(message.type==='output-put'){
      if(message.size>512*1024*1024)throw Error('Native transfer limit exceeded');
      const buffer=new ArrayBuffer(message.size);buffers.set(message.requestId,{buffer,options:message});
      queueMicrotask(()=>testDispatch('sharedbufferreceived',{additionalData:{cmd:'output-buffer',requestId:message.requestId},getBuffer:()=>buffer}));
     }
     if(message.type==='output-put-done'){
      const item=buffers.get(message.requestId);buffers.delete(message.requestId);testOutputs.push({bytes:new Uint8Array(item.buffer),options:item.options});
      reply({cmd:'output-result',requestId:message.requestId,ok:true});
     }
    }
   }});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/view.html?tab=multi-page-print-qa');
  await page.waitForFunction(()=>testMessages.some(m=>m.type==='view-ready'));
  await page.locator('#appBootSplash').waitFor({state:'hidden'});
  await page.evaluate(bytes=>{const buffer=new Uint8Array(bytes).buffer;testDispatch('sharedbufferreceived',{additionalData:{cmd:'open-document',name:'30-page drawing.pdf',docPath:null,requestId:'open'},getBuffer:()=>buffer});},Array.from(bytes));
  await page.waitForFunction(()=>testMessages.some(m=>m.type==='document-ready'&&m.ok));
  const results=[];
  for(const [index,printer,copies] of [[0,'QA PDF','2'],[1,'QA physical sink','1']]){
   if(index===1)await page.evaluate(()=>__multiPrint.resizeAll());
   await page.keyboard.press('Control+p');await page.waitForFunction(()=>document.querySelector('#prPrinter option[value="QA PDF"]'));
   await page.locator('#prPrinter').selectOption(printer);await page.locator('#prCopies').fill(copies);
   await page.locator('#prPaper').selectOption('a3');await page.locator('#prOrient').selectOption('landscape');await page.locator('#prMode').selectOption('pdf');await page.locator('#prColor').selectOption('color');
   await page.locator('#prOk').click();await page.waitForFunction(index=>testOutputs.length>index,index);
   const result=await page.evaluate(index=>({bytes:Array.from(testOutputs[index].bytes),options:testOutputs[index].options}),index);
   const data=new Uint8Array(result.bytes),doc=await PDFDocument.load(data);
   const images=doc.context.enumerateIndirectObjects().filter(([,v])=>v instanceof pdfLib.PDFRawStream&&v.dict.get(pdfLib.PDFName.of('Subtype'))===pdfLib.PDFName.of('Image')).length;
   assert.equal(doc.getPageCount(),index===0?60:30);assert.equal(images,1);assert.ok(data.length<bytes.length*1.2);
   assert.equal(result.options.copies,1);assert.equal(result.options.printer,printer);
   const textPages=await page.evaluate(async bytes=>{
    const pdfjs=await import('/assets/pdfjs/6.2.108/legacy/build/pdf.min.mjs');pdfjs.GlobalWorkerOptions.workerSrc='/assets/pdfjs/6.2.108/legacy/build/pdf.worker.min.mjs';
    const doc=await pdfjs.getDocument({data:new Uint8Array(bytes)}).promise;
    try {const indexes=doc.numPages===60?[1,30,31,60]:[1,30];return await Promise.all(indexes.map(async n=>({page:n,text:(await (await doc.getPage(n)).getTextContent()).items.map(i=>i.str).join(' ')})));}finally{await doc.loadingTask.destroy();}
   },result.bytes);
   for(const item of textPages)assert.ok(item.text.includes('DRAWING PAGE '+((item.page-1)%30+1)),JSON.stringify(item));
   fs.writeFileSync(path.join(output,'print-'+index+'.pdf'),data);
   results.push({printer,originalBytes:bytes.length,printBytes:data.length,pages:doc.getPageCount(),images});
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
  await page.screenshot({path:path.join(output,'30-pages-pc.png')});
  console.log('PASS 30-page desktop print UI: 60 collated PDF pages, 30 resized physical-printer pages, exact shared-buffer handoff, one shared image.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {PDFDocument,StandardFonts,rgb}=require('pdf-lib');
const root=path.resolve(__dirname,'../../..'),out=path.join(root,'output/print-dialog');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const ps=code=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',windowsHide:true});
async function ready(page){
 page.setDefaultTimeout(30000);await page.locator('#appBootSplash').waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelector('#pg0 canvas')?.width>100);
 if(await page.locator('.tutorialClose').isVisible())await page.locator('.tutorialClose').click();
}
async function preview(page,source){
 await page.waitForFunction(source=>document.querySelector('#prPrevBox').getAttribute('aria-busy')==='false'&&document.querySelector('#prPreview').style.visibility==='visible'&&document.querySelector('#prPreviewSource').textContent===String(source),source);
 return page.locator('#prPreview').evaluate(c=>c.toDataURL());
}
async function check(page,label,pc=false){
 await page.keyboard.press('Control+p');await preview(page,1);
 assert.equal(await page.locator('#prPreviewTotal').innerText(),'10');assert.ok(await page.locator('#prPreviewPrev').isDisabled());
 const first=await preview(page,1);
 await page.locator('#prPreviewNext').click();assert.notEqual(await preview(page,2),first,'page canvas actually changes');
 await page.locator('#prPreviewPage').fill('10');await page.locator('#prPreviewPage').press('Enter');await preview(page,10);
 assert.ok(await page.locator('#prPreviewNext').isDisabled());
 await page.locator('#prPreviewPrev').click();await preview(page,9);
 await page.locator('#prPreviewPage').fill('999');await page.locator('#prPreviewPage').press('Enter');await preview(page,10);
 await page.locator('#prRange').selectOption('custom');await page.locator('#prCustom').fill('2, 5, 9');await preview(page,2);
 assert.equal(await page.locator('#prPreviewTotal').innerText(),'3');
 await page.locator('#prPreviewNext').click();await preview(page,5);
 await page.locator('#prPreviewNext').click();await preview(page,9);assert.equal(await page.locator('#prPreviewPage').inputValue(),'3');
 await page.locator('#prCustom').fill('wrong');await page.waitForFunction(()=>document.querySelector('#prPreview').style.visibility==='hidden');
 assert.ok(await page.locator('#prPreviewNext').isDisabled());assert.equal(await page.locator('#prPreviewTotal').innerText(),'0');
 await page.locator('#prCustom').fill('2-5');await preview(page,2);
 await page.locator('#prOrient').selectOption('landscape');await page.locator('#prMode').selectOption('image');await preview(page,2);
 const size=await page.locator('#prPreview').evaluate(c=>({w:c.width,h:c.height}));assert.ok(size.w>size.h);
 if(pc){
  await page.locator('#prPrinter').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#prPrinter').disabled);
  await page.locator('#prPaper').selectOption('letter');await page.locator('#prCopies').fill('3');await page.locator('#prCopies').press('Tab');
  await page.locator('#prColor').selectOption('mono');
  const names=await page.locator('#prPrinter option').evaluateAll(options=>options.map(o=>({name:o.value,pdf:o.dataset.pdf==='true'})));
  const pdf=names.find(o=>o.pdf);assert.ok(pdf,'PDF printer available');await page.locator('#prPrinter').selectOption(pdf.name);
  assert.ok(await page.locator('#prDuplex').isDisabled());
  assert.match(await page.locator('#prDuplexHint').innerText(),/PDF/);
 }
 await page.screenshot({path:path.join(out,label+'.png')});
 const box=await page.locator('#prOverlay .printDialog').boundingBox(),v=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));
 assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=v.w+1&&box.y+box.height<=v.h+1,'dialog fits viewport');
 for(const id of ['prPreviewPrev','prPreviewPage','prPreviewNext']){const b=await page.locator('#'+id).boundingBox();assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=v.w&&b.y+b.height<=v.h,id+' fits');}
 await page.locator('#prCancel').click();await page.keyboard.press('Control+p');await preview(page,1);
 assert.equal(await page.locator('#prOrient').inputValue(),'landscape');assert.equal(await page.locator('#prMode').inputValue(),'image');assert.equal(await page.locator('#prRange').inputValue(),'all');
 if(pc){assert.equal(await page.locator('#prCopies').inputValue(),'3');assert.equal(await page.locator('#prPaper').inputValue(),'letter');assert.equal(await page.locator('#prColor').inputValue(),'mono');}
 await page.locator('#prCancel').click();
 console.log('PASS '+label+': page navigation, range mapping, invalid range, orientation, saved options, viewport layout');
}
async function web(file){
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:'msedge'})});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:850}}),errors=[];
  await context.addInitScript(()=>{localStorage.setItem('pdfEditor.startupMode','resume');for(const k of ['tutorialSeen','readerTutorialSeen'])localStorage.setItem('pdfEditor.'+k,'1');});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto((process.env.PRINT_TEST_ORIGIN||'http://127.0.0.1:9974')+'/editor/');
  await page.locator('#appBootSplash').waitFor({state:'hidden'});await page.locator('#fileInput').setInputFiles(file);await ready(page);
  for(const mode of ['editor','viewer']){
   if(mode==='viewer'){await page.locator('#btnReaderMode').click();assert.equal(await page.locator('#btnText').isVisible(),false);}
   for(const width of [1280,390]){await page.setViewportSize({width,height:850});await check(page,mode+'-'+width);}
  }
  await page.setViewportSize({width:1280,height:850});
  await page.waitForTimeout(1000);await page.reload();await ready(page);await page.keyboard.press('Control+p');await preview(page,1);
  assert.equal(await page.locator('#prOrient').inputValue(),'landscape');assert.equal(await page.locator('#prMode').inputValue(),'image');
  await page.locator('#prCancel').click();
  await page.locator('.thumb[data-k="1"]').click();await page.locator('.thumb[data-k="4"]').click({modifiers:['Control']});
  await page.locator('.thumb[data-k="4"]').click({button:'right'});await page.locator('#ctxMenu [data-cmd="printSel"]').click();await preview(page,2);
  assert.equal(await page.locator('#prRange').inputValue(),'selected');assert.equal(await page.locator('#prPreviewTotal').innerText(),'2');
  await page.locator('#prPreviewNext').click();await preview(page,5);await page.locator('#prCancel').click();
  for(const lang of ['en','ja','vi','zh','ko']){
   await page.evaluate(lang=>window.DaydayPDFI18n.setLanguage(lang,{route:false}),lang);await page.keyboard.press('Control+p');await preview(page,1);
   const label=await page.locator('#prPreviewPage').getAttribute('aria-label');assert.ok(label&&!/undefined|unidentified/.test(label));if(lang!=='ko')assert.doesNotMatch(label,/[가-힣]/);
   await page.locator('#prCancel').click();
  }
  assert.deepEqual(errors,[]);console.log('PASS reload persistence, thumbnail selection, five languages, editor/viewer shared state');
 }finally{await browser.close();}
}
async function native(file){
 assert.equal(ps('@(Get-Process DaydayPDF,PdfEditor.Preview -ErrorAction SilentlyContinue).Count').trim(),'0','User editor running');
 const recovery=path.join(process.env.LOCALAPPDATA,'SolPdfEditor/Preview/recovery-session.json'),prior=fs.existsSync(recovery)?fs.readFileSync(recovery):null;
 let child,browser;
 async function stop(){if(browser){await browser.close();browser=null;}if(child?.pid){ps(`$p=Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue;if($p){$null=$p.CloseMainWindow()}`);for(let i=0;i<20&&child.exitCode===null;i++)await delay(250);if(child.exitCode===null)child.kill();for(let i=0;i<30&&child.exitCode===null;i++)await delay(100);child=null;}}
 async function start(){
  child=spawn(process.env.PC_TEST_EXE||path.join(root,'tmp/pc-print-options/PdfEditor.Preview.exe'),['--open',file],{env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9942',WEBVIEW2_USER_DATA_FOLDER:path.join(out,'native-profile')},windowsHide:true,stdio:'ignore'});
  for(let i=0;i<90;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9942');break}catch{await delay(500)}}assert.ok(browser,'Native WebView');
  const context=browser.contexts()[0];for(let i=0;i<60&&!context.pages().length;i++)await delay(250);const page=context.pages()[0];await ready(page);return page;
 }
 try{
  let page=await start();await page.evaluate(()=>window.DaydayPDFI18n.setLanguage('ko',{route:false}));await check(page,'native',true);
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('pdfEditor.printOptions')));await stop();
  page=await start();await page.keyboard.press('Control+p');await preview(page,1);await page.waitForFunction(()=>!document.querySelector('#prPrinter').disabled);
  for(const [key,id] of Object.entries({printer:'prPrinter',copies:'prCopies',paper:'prPaper',color:'prColor',orientation:'prOrient',mode:'prMode',duplex:'prDuplex'}))assert.equal(await page.locator('#'+id).inputValue(),String(stored[key]),'relaunch '+key);
  await page.locator('#prCancel').click();console.log('PASS native restart: printer, copies, paper, color, sides, orientation and output mode restored');
 }finally{await stop();if(prior)fs.writeFileSync(recovery,prior);else if(fs.existsSync(recovery))fs.unlinkSync(recovery);}
}
(async()=>{fs.mkdirSync(out,{recursive:true});const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
 for(let i=1;i<=10;i++){const p=pdf.addPage([595,842]);p.drawRectangle({x:40,y:50,width:515,height:742,color:rgb(.95,.98-i*.015,.95)});p.drawText('PAGE '+i,{x:85,y:670,size:60,font});p.drawText('Print preview navigation',{x:85,y:615,size:20,font});}
 const file=path.join(out,'preview-10-pages.pdf');fs.writeFileSync(file,await pdf.save());if(process.argv.includes('--native'))await native(file);else await web(file);
})().catch(error=>{console.error(error);process.exitCode=1;});

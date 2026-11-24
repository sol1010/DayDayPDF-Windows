const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'../..');const {PDFDocument}=require('pdf-lib');
(async()=>{const b=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
try{const ctx=await b.newContext({viewport:{width:1280,height:900},locale:'ko-KR'}),p=await ctx.newPage(),errors=[];
 await ctx.route('**/*',async r=>{
  const u=new URL(r.request().url());let f;
  if(u.pathname==='/view.html')f=path.join(root,'windows/PdfEditor.Preview/WebApp/view.html');
  else if(u.pathname.includes('/assets/')){
   const rel=u.pathname.slice(1);
   f=['windows/PdfEditor.Preview/WebApp','windows/PdfEditor.Preview/bin/Release/net10.0-windows/WebApp','.'].map(dir=>path.join(root,dir,rel)).find(f=>fs.existsSync(f));
  }

  if(f)return r.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.html')?'text/html':f.endsWith('.wasm')?'application/wasm':(/\.m?js$/.test(f))?'text/javascript':f.endsWith('.css')?'text/css':'application/octet-stream'});
  return r.continue();
 });
 p.on('pageerror',e=>{errors.push(e.message);console.error('ERR',e.message)});p.on('console',m=>{if(m.type()==='error')console.error(m.text());if(m.type()==='error'&&m.text().includes('Content Security Policy'))errors.push(m.text())});
 await ctx.addInitScript(()=>{localStorage.setItem('pdfEditor.tutorialSeen','1');localStorage.setItem('pdfEditor.startupMode','blank')});
 await p.goto('http://127.0.0.1:9954/view.html');await p.waitForFunction(()=>window.pdfEditorStartupPromise);await p.evaluate(async()=>{await window.pdfEditorStartupPromise;window.dispatchEvent(new Event('pdf-editor-dismiss-boot-splash'))});await p.locator('#appBootSplash').waitFor({state:'hidden'});
 const pdf=await PDFDocument.create();pdf.addPage([595,842]);await p.locator('#fileInput').setInputFiles({name:'日本語_Việt.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
 await p.waitForFunction(()=>document.querySelector('#pg0 canvas')?.width>100);
 await p.evaluate(()=>window.__canvasBefore=document.querySelector('#pg0 canvas'));
 for(const lang of ['ja','vi','en','ko','vi']){
  await p.locator('[data-language-toggle]').click();await p.locator(`[role=menuitemradio][data-language=${lang}]`).click();
  assert.equal(new URL(p.url()).pathname,'/view.html');assert.equal(await p.locator('html').getAttribute('lang'),lang);
  assert.equal(await p.evaluate(()=>window.__canvasBefore===document.querySelector('#pg0 canvas')),true);
 }
 assert.equal(await p.locator('#btnDraw .lbl').innerText(),'Vẽ');
 const p2=await ctx.newPage();await p2.goto('http://127.0.0.1:9954/view.html');await p2.waitForFunction(()=>window.DaydayPDFI18n);
 await p2.waitForFunction(()=>window.pdfEditorStartupPromise);await p2.evaluate(async()=>{await window.pdfEditorStartupPromise;window.dispatchEvent(new Event('pdf-editor-dismiss-boot-splash'))});await p2.locator('#appBootSplash').waitFor({state:'hidden'});
 assert.equal(await p2.locator('html').getAttribute('lang'),'vi');
 await p2.locator('[data-language-toggle]').click();await p2.locator('[role=menuitemradio][data-language=ja]').click();
 await p.waitForFunction(()=>document.documentElement.lang==='ja');
 await ctx.setOffline(true);await p.locator('[data-language-toggle]').click();await p.locator('[role=menuitemradio][data-language=vi]').click();
 assert.equal(await p.locator('#btnDraw .lbl').innerText(),'Vẽ');assert.equal(await p.evaluate(()=>window.__canvasBefore===document.querySelector('#pg0 canvas')),true);
 await p.screenshot({path:path.join(root,'output/locales-pc-vi.png')});assert.deepEqual(errors,[]);
 console.log('PASS PC bundled locale menu, same document, stored language, cross-tab sync, offline, CSP');
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});

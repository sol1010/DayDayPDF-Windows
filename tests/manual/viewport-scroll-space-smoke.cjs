const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {PDFDocument}=require('pdf-lib');
const origin=process.env.SPACE_TEST_ORIGIN||'http://127.0.0.1:9939';
const out=process.env.SPACE_TEST_OUTPUT||'../output/viewport-space-qa';
const pc=process.env.SPACE_TEST_PC==='1';
let html=fs.readFileSync('PDF편집기.html','utf8').replaceAll('__APP_VER__','space-test')
 .replaceAll('assets/fontawesome/','/assets/fontawesome/').replaceAll('assets/pdfjs/','/assets/pdfjs/');
html=html.replace('mountEditorControllers();',`window.spaceTest={
 fit:()=>doFitPage(true),mode:setViewMode,go:gotoPage,zoom:z=>viewportZoom.to(z),
 ready:()=>!!editorStore.activeDocument?.fitDone,
 page:()=>editorStore.currentPage,
 chrome:()=>document.getElementById('btnReaderHideTools').click(),
 flip:flipPage,
};\nmountEditorControllers();`);
(async()=>{
 fs.mkdirSync(out,{recursive:true});const pdf=await PDFDocument.create();
 for(let i=0;i<4;i++) pdf.addPage(i===1?[842,595]:[595,842]).drawText('Page '+(i+1),{x:50,y:500,size:28});
 const buffer=Buffer.from(await pdf.save());
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:'chrome'})});
 try{for(const mobile of [false,true]){
 const label=(pc?'pc':'web')+'-'+(mobile?'mobile':'desktop');
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:960},hasTouch:mobile,isMobile:mobile,bypassCSP:true});
 await context.addInitScript(()=>{for(const k of ['tutorialSeen','readerTutorialSeen'])localStorage.setItem('pdfEditor.'+k,'1');localStorage.setItem('pdfEditor.startupMode','blank');});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 await page.route(origin+'/editor/?space-test',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto(origin+'/editor/?space-test');
 await page.waitForFunction(()=>typeof spaceTest!=='undefined');
 await page.locator('#fileInput').setInputFiles({name:'Scroll space.pdf',mimeType:'application/pdf',buffer});
 await page.waitForFunction(()=>spaceTest.ready()&&document.querySelector('#pg0 canvas')?.width>100);await page.waitForTimeout(300);
 const measure=()=>page.evaluate(()=>{
 const v=document.getElementById('viewer'),r=v.getBoundingClientRect();
 const pages=[...v.querySelectorAll('.pageWrap')].filter(p=>p.style.display!=='none').map(p=>{const b=p.getBoundingClientRect();return{top:b.top-r.top,bottom:b.bottom-r.top,height:b.height,k:+p.dataset.k}});
 return{height:v.clientHeight,top:v.scrollTop,max:v.scrollHeight-v.clientHeight,pages};
 });
 let m=await measure();assert.ok(Math.abs((m.pages[0].top+m.pages[0].bottom)/2-m.height/2)<2,label+' initial page is not centered '+JSON.stringify(m));
 const center=async()=>{await page.evaluate(()=>spaceTest.fit());await page.waitForTimeout(100);const q=await measure();const top=Math.min(...q.pages.map(p=>p.top)),bottom=Math.max(...q.pages.map(p=>p.bottom));assert.ok(Math.abs((top+bottom)/2-q.height/2)<2,'fitted spread not centered '+JSON.stringify(q));};
 for(const mode of ['scroll','single','double']){
 await page.evaluate(mode=>{spaceTest.mode(mode);spaceTest.go(1);},mode);
 if(mode!=='scroll')await center();
 await page.evaluate(()=>document.getElementById('viewer').scrollTop=0);await page.waitForTimeout(50);m=await measure();
 assert.ok(m.pages[0].top>=m.height/2-1,mode+' top cannot reach midpoint '+JSON.stringify(m));
 await page.screenshot({path:out+'/'+label+'-'+mode+'-top.png'});
 await page.evaluate(()=>{const v=document.getElementById('viewer');v.scrollTop=v.scrollHeight;});await page.waitForTimeout(50);m=await measure();
 const bottom=Math.max(...m.pages.map(p=>p.bottom));assert.ok(bottom<=m.height/2+1,mode+' bottom cannot reach midpoint '+JSON.stringify(m));
 if(mode!=='scroll'){
 await page.evaluate(()=>spaceTest.go(3));await page.waitForTimeout(80);m=await measure();
 const p=m.pages[0];assert.ok(p.top>=20&&p.top<m.height/2-20,'page navigation lands in empty space '+JSON.stringify(m));
 await center();
 const prevPage=await page.evaluate(()=>spaceTest.page());const before=await measure();const vr=await page.locator('#viewer').boundingBox();
 await page.mouse.move(vr.x+vr.width/2,vr.y+vr.height/2);await page.mouse.wheel(0,80);await page.waitForTimeout(150);
 m=await measure();assert.ok(m.top>before.top+10,'wheel cannot move a fitted page');assert.equal(await page.evaluate(()=>spaceTest.page()),prevPage,'wheel skipped the available margin');
 }
 }
 await page.evaluate(()=>{spaceTest.mode('scroll');spaceTest.go(2);spaceTest.zoom(1);});await page.waitForTimeout(200);
 let before=await measure();await page.setViewportSize(mobile?{width:390,height:700}:{width:1280,height:800});await page.waitForTimeout(150);m=await measure();
 assert.ok(Math.abs(m.pages[1].top-before.pages[1].top)<2,'resize shifted the current page');
 await page.evaluate(()=>document.getElementById('viewer').scrollTop=0);m=await measure();assert.ok(m.pages[0].top>=m.height/2-1,'resize gutter too short');
 if(mobile){
 await page.evaluate(()=>spaceTest.go(1));await page.waitForTimeout(100);const cdp=await context.newCDPSession(page);
 const rect=await page.locator('#viewer').boundingBox(),x=rect.x+rect.width*.65,y=rect.y+rect.height*.35;
 const anchor=await page.locator('#pg0').boundingBox();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let i=1;i<=10;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+i*12}]});await page.waitForTimeout(20);}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(150);
 assert.ok((await page.locator('#pg0').boundingBox()).y>anchor.y+30,'touch cannot move the top edge into the gutter');
 }
 if(!pc){
 await page.locator('#btnReaderMode').click();await page.waitForTimeout(100);assert.ok(await page.locator('body').evaluate(b=>b.classList.contains('readerMode')));
 await page.evaluate(()=>document.getElementById('viewer').scrollTop=0);m=await measure();assert.ok(m.pages[0].top>=m.height/2-1,'viewer top gutter too short');
 await page.evaluate(()=>spaceTest.chrome());await page.waitForTimeout(100);
 await page.evaluate(()=>document.getElementById('viewer').scrollTop=0);m=await measure();assert.ok(m.pages[0].top>=m.height/2-1,'quiet viewer gutter too short');
 await page.screenshot({path:out+'/'+label+'-reader-quiet.png'});
 }
 assert.deepEqual(errors,[]);console.log('PASS '+label+': initial fit, top/bottom midpoint, three page modes, navigation, wheel, resize, touch and reader');await context.close();
 }}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

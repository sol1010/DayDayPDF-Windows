const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {PDFDocument}=require('pdf-lib');
const origin=process.env.OPACITY_TEST_ORIGIN||'http://127.0.0.1:9938';
const out=process.env.OPACITY_TEST_OUTPUT||'../output/toolbar-opacity-qa';
const pc=process.env.OPACITY_TEST_PC==='1';
let html=fs.readFileSync(process.env.OPACITY_TEST_HTML||'PDF편집기.html','utf8')
 .replaceAll('__APP_VER__','opacity-test').replaceAll('assets/fontawesome/','/assets/fontawesome/').replaceAll('assets/pdfjs/','/assets/pdfjs/');
html=html.replace('mountEditorControllers();',`window.opacityTest={
 seed(){const page=editorStore.pages[0];page.texts=[
  {type:'rect',fx:.2,fy:.28,fw:.4,fh:.22,stroke:'#205ab5',strokeOp:1,fill:'#dbe7ff',fillOp:1,sw:2,
   text:'Opacity',font:'arial',size:18,color:'#222222',colorOp:1},
  {type:'text',fx:.25,fy:.6,fw:.4,fh:.1,text:'Text opacity',font:'arial',size:20,color:'#222222',colorOp:1}
 ];positionMarks(document.getElementById('pg0'),page);},
 select(index){selectOverlayObject(0,editorStore.pages[0].texts[index]);},
 snapshot(){return JSON.parse(JSON.stringify({objects:editorStore.pages[0].texts,undo:editorStore.undoStack.length}));}
};\nmountEditorControllers();`);
(async()=>{
 fs.mkdirSync(out,{recursive:true});const pdf=await PDFDocument.create();pdf.addPage([595,842]);const buffer=Buffer.from(await pdf.save());
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:'chrome'})});
 try{for(const width of [390,320]){
  const name=(pc?'pc':'web')+'-'+width,context=await browser.newContext({viewport:{width,height:844},hasTouch:true,isMobile:true,bypassCSP:true});
  await context.addInitScript(()=>{for(const key of ['tutorialSeen','readerTutorialSeen'])localStorage.setItem('pdfEditor.'+key,'1');localStorage.setItem('pdfEditor.startupMode','blank');localStorage.setItem('pdfEditor.barPin','0')});
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.route(origin+'/editor/?opacity-test',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto(origin+'/editor/?opacity-test');
  await page.waitForFunction(()=>typeof opacityTest!=='undefined');await page.locator('#fileInput').setInputFiles({name:'Opacity.pdf',mimeType:'application/pdf',buffer});
  await page.waitForFunction(()=>document.querySelector('#pg0 canvas')?.width>100);await page.evaluate(()=>opacityTest.seed());await page.waitForTimeout(250);
  const cdp=await context.newCDPSession(page);
  async function swipe(from,to,hold=0){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});if(hold)await page.waitForTimeout(hold);
   for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/10,y:from.y+(to.y-from.y)*i/10}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  for(const [id,index,key,barId,neighbor] of [['tbStrokeOp',0,'strokeOp','textBar','tbStroke'],['tbFillOp',0,'fillOp','textBar','tbFill'],['stColorOp',0,'colorOp','shapeTextBar','stColor'],['tbColorOp',1,'colorOp','textBar','tbColor']]){
   await page.evaluate(index=>opacityTest.select(index),index);const input=page.locator('#'+id),bar=page.locator('#'+barId);await input.scrollIntoViewIfNeeded();
   await input.evaluate(e=>e.scrollIntoView({inline:'center',block:'nearest'}));let r=await input.boundingBox();const before=await page.evaluate(()=>opacityTest.snapshot());
   const initialScroll=await bar.evaluate(e=>e.scrollLeft),initialRect=await bar.boundingBox();
   await swipe({x:r.x+r.width-5,y:r.y+r.height/2},{x:r.x+10,y:r.y+r.height/2},id==='stColorOp'?500:0);
   assert.equal(await bar.evaluate(e=>e.scrollLeft),initialScroll,id+': slider drag scrolled toolbar');
   assert.ok(+(await input.inputValue())<60,id+': drag did not lower opacity');
   let state=await page.evaluate(()=>opacityTest.snapshot());assert.equal(state.objects[index][key],+(await input.inputValue())/100);assert.equal(state.undo,before.undo+1,'one drag must create one undo entry');
   const finalRect=await bar.boundingBox();assert.ok(Math.abs(finalRect.x-initialRect.x)<1&&Math.abs(finalRect.y-initialRect.y)<1,id+': slider moved toolbar');
   assert.ok(r.width>=70&&r.height>=20,'mobile slider hit area is too small');
   const current=+(await input.inputValue()),ratio=(current-10)/90,x=r.x+8+(r.width-16)*ratio;
   await swipe({x,y:r.y+r.height/2},{x:r.x+r.width+18,y:r.y+r.height/2},500);
   assert.equal(await input.inputValue(),'100');assert.equal(await bar.evaluate(e=>e.scrollLeft),initialScroll);assert.equal(await bar.evaluate(e=>e.classList.contains('mobileToolbarDragging')),false);
   const swatch=page.locator('#'+neighbor);await swatch.evaluate(e=>e.scrollIntoView({inline:'center',block:'nearest'}));r=await swatch.boundingBox();
   const scroll=await bar.evaluate(e=>({left:e.scrollLeft,max:e.scrollWidth-e.clientWidth}));const dx=scroll.left>=scroll.max/2?60:-60;
   state=await page.evaluate(()=>opacityTest.snapshot());await swipe({x:r.x+r.width/2,y:r.y+r.height/2},{x:r.x+r.width/2+dx,y:r.y+r.height/2});
   const afterScroll=await bar.evaluate(e=>e.scrollLeft);
   assert.ok(Math.abs(afterScroll-scroll.left)>Math.min(20,scroll.max/2),neighbor+': adjacent toolbar area stopped scrolling '+JSON.stringify({scroll,afterScroll,r,dx}));
   assert.deepEqual(await page.evaluate(()=>opacityTest.snapshot()),state,'toolbar swipe edited an object');
  }
  await page.locator('#tbColorOp').evaluate(e=>e.scrollIntoView({inline:'center',block:'nearest'}));await page.locator('#textBar').screenshot({path:out+'/'+name+'.png'});
  if(!pc){await page.locator('#btnReaderMode').click();assert.equal(await page.locator('#textBar').isVisible(),false);await page.locator('#btnReaderMode').click();}
  assert.deepEqual(errors,[]);console.log('PASS '+name+': all four opacity sliders, drag/hold/outside, no toolbar movement, single undo, adjacent swipe and reader mode');await context.close();
 }}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

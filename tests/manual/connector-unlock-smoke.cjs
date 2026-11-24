const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {PDFDocument}=require('pdf-lib');
const origin=process.env.CONNECTOR_TEST_ORIGIN||'http://127.0.0.1:9937';
const out=process.env.CONNECTOR_TEST_OUTPUT||'../output/connector-unlock-qa';
const pc=process.env.CONNECTOR_TEST_PC==='1';
let html=fs.readFileSync(process.env.CONNECTOR_TEST_HTML||'PDF편집기.html','utf8')
 .replaceAll('__APP_VER__','connector-test').replaceAll('assets/fontawesome/','/assets/fontawesome/').replaceAll('assets/pdfjs/','/assets/pdfjs/');
html=html.replace('mountEditorControllers();',`window.connectorTest={
 async seed(){const page=editorStore.pages[0];page.texts=[
  {type:'rect',fx:.2,fy:.3,fw:.14,fh:.14,stroke:'#2454b6',fill:'#e6edfb',fillOp:1,sw:2,linkId:'moving-shape'},
  {type:'arrow',x1:.34,y1:.37,x2:.62,y2:.46,stroke:'#d33e30',sw:2,attachTo:'moving-shape',attachPoint:'start',
   connectorStyle:'angled',connectorAnchor:'edge',connectorAnchorX:.5,connectorAnchorY:0,arrowEndType:'arrow-filled'}
 ];positionMarks(document.getElementById('pg0'),page);await doFitPage(true);},
 select(){selectOverlayObject(0,editorStore.pages[0].texts[1]);},
 snapshot(){const objects=editorStore.pages[0].texts,arrow=objects.find(o=>o.type==='arrow');return JSON.parse(JSON.stringify({
  shape:objects.find(o=>o.type==='rect'),arrow,points:connectorPolyline(arrow)}));}
};\nmountEditorControllers();`);
function unlocked(state){assert.equal(state.arrow.connectorBendX,undefined);assert.equal(state.arrow.connectorBendY,undefined);
 assert.equal(state.arrow.connectorAnchorX,undefined,'unlock left the root fixed');assert.equal(state.arrow.connectorAnchorY,undefined);}
function outside(state){const {shape:s,points}=state;assert.equal(points.length,3);assert.equal(state.arrow.attachTo,s.linkId);
 for(let j=1;j<points.length;j++)for(let n=1;n<30;n++){const t=n/30,a=points[j-1],b=points[j],x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;
  assert.ok(x<=s.fx+1e-7||x>=s.fx+s.fw-1e-7||y<=s.fy+1e-7||y>=s.fy+s.fh-1e-7,'arrow crosses shape '+JSON.stringify(state));}
}
(async()=>{
 fs.mkdirSync(out,{recursive:true});const pdf=await PDFDocument.create();pdf.addPage([595,842]);const buffer=Buffer.from(await pdf.save());
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:'chrome'})});
 try{for(const mobile of [false,true]){
  const name=(pc?'pc':'web')+(mobile?'-mobile':'-desktop');
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:950},isMobile:mobile,hasTouch:mobile,bypassCSP:true});
  await context.addInitScript(()=>{for(const key of ['tutorialSeen','readerTutorialSeen'])localStorage.setItem('pdfEditor.'+key,'1');localStorage.setItem('pdfEditor.startupMode','blank');localStorage.setItem('pdfEditor.barPin','0')});
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.route(origin+'/editor/?connector-test',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto(origin+'/editor/?connector-test');
  await page.waitForFunction(()=>typeof connectorTest!=='undefined');await page.locator('#fileInput').setInputFiles({name:'Connector test.pdf',mimeType:'application/pdf',buffer});
  await page.waitForFunction(()=>document.querySelector('#pg0 canvas')?.width>100);await page.evaluate(()=>connectorTest.seed());
  const cdp=mobile?await context.newCDPSession(page):null;
  async function drag(from,to){if(mobile){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});for(let i=1;i<=15;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/15,y:from.y+(to.y-from.y)*i/15}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
   else{await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:15});await page.mouse.up();}}
  async function point(x,y){const r=await page.locator('#pg0').boundingBox();return{x:r.x+r.width*x,y:r.y+r.height*y};}
  const elbow=page.locator('.connectorMark.sel .connectorBody.angled');
  await page.waitForTimeout(300);await page.evaluate(()=>connectorTest.select());
  let r=await elbow.boundingBox();
  if(!r){await page.screenshot({path:out+'/'+name+'-missing-handle.png'});console.log(await page.evaluate(()=>({state:connectorTest.snapshot(),marks:[...document.querySelectorAll('.obj')].map(e=>({cls:e.className,handles:[...e.querySelectorAll('.objHandle')].map(h=>h.className)}))})));}
  assert.ok(r);
  await drag({x:r.x+r.width/2,y:r.y+r.height/2},await point(.12,.21));
  const locked=await page.evaluate(()=>connectorTest.snapshot());assert.ok(Number.isFinite(locked.arrow.connectorBendX));assert.equal(await elbow.evaluate(e=>e.classList.contains('locked')),true);
  if(mobile)await elbow.tap();else await elbow.click();
  unlocked(await page.evaluate(()=>connectorTest.snapshot()));assert.equal(await elbow.evaluate(e=>e.classList.contains('locked')),false);
  await page.keyboard.press('Control+z');assert.ok(Number.isFinite((await page.evaluate(()=>connectorTest.snapshot())).arrow.connectorBendX));
  await page.locator('#btnRedo').click();
  await page.waitForFunction(()=>connectorTest.snapshot().arrow.connectorBendX===undefined);
  unlocked(await page.evaluate(()=>connectorTest.snapshot()));
  for(const [x,y] of [[.32,.46],[.62,.2],[.84,.46],[.62,.7]]){
   await page.keyboard.press('Escape');const shape=page.locator('.shapeMark:not(.connectorMark)').first();
   if(mobile)await shape.tap();r=await shape.boundingBox();await drag({x:r.x+r.width/2,y:r.y+r.height/2},await point(x,y));
   const state=await page.evaluate(()=>connectorTest.snapshot());unlocked(state);outside(state);
   assert.ok(Math.abs(state.shape.fx+state.shape.fw/2-x)<.012&&Math.abs(state.shape.fy+state.shape.fh/2-y)<.012,'shape did not move to target');
   assert.ok(Math.abs(state.arrow.x2-.62)<1e-7&&Math.abs(state.arrow.y2-.46)<1e-7,'arrow head moved');
  }
  await page.keyboard.press('Escape');const final=await page.evaluate(()=>connectorTest.snapshot());
  await page.screenshot({path:out+'/'+name+'.png'});
  if(!pc){await page.locator('#btnReaderMode').click();assert.deepEqual(await page.evaluate(()=>connectorTest.snapshot()),final);await page.locator('#btnReaderMode').click();assert.deepEqual(await page.evaluate(()=>connectorTest.snapshot()),final);}
  assert.deepEqual(errors,[]);console.log('PASS '+name+': drag/lock/unlock, undo/redo, four-sided object moves, no penetration, head/attachment preserved');await context.close();
 }}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

const fs=require('fs'), assert=require('assert/strict');
const {PDFDocument,StandardFonts}=require('pdf-lib');
const origin=process.env.INTERACTION_TEST_ORIGIN || 'http://127.0.0.1:9926';
const { chromium }=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out=process.env.INTERACTION_TEST_OUTPUT || '../output/interaction-qa';fs.mkdirSync(out,{recursive:true});
const repo='.';
let html=fs.readFileSync(repo+'/PDF편집기.html','utf8').replaceAll('__APP_VER__','interaction-test').replaceAll('assets/fontawesome/','/assets/fontawesome/').replaceAll('assets/pdfjs/','/assets/pdfjs/');
html=html.replace('mountEditorControllers();',`window.interactionState = () => JSON.parse(JSON.stringify({ objects: editorStore.pages[0]?.texts || [], selected: selText?.obj || null, pinned: barPinned, undo: editorStore.undoStack.length }));\nmountEditorControllers();`);
(async()=>{
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
 for(let n=1;n<=10;n++)doc.addPage([595,842]).drawText('Toolbar regression page '+n,{font,x:50,y:700,size:24});
 const bytes=Buffer.from(await doc.save());
 const b=await chromium.launch({...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:'chrome'}),headless:true});
 try{
 const context=await b.newContext({viewport:{width:1300,height:1000},hasTouch:true,bypassCSP:true});
 const p=await context.newPage();p.setDefaultTimeout(12000);const errors=[];p.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message)});
 await p.addInitScript(()=>{localStorage.setItem('pdfEditor.startupMode','blank');localStorage.setItem('pdfEditor.barPin','0')});
 await p.route('**/editor/?interaction-test',r=>r.fulfill({status:200,contentType:'text/html',body:html}));
 await p.goto(origin+'/editor/?interaction-test');await p.waitForFunction(()=>typeof interactionState==='function');
 await p.locator('#fileInput').setInputFiles({name:'toolbar.pdf',mimeType:'application/pdf',buffer:bytes});await p.waitForFunction(()=>document.querySelector('#pg0 canvas')?.width>100);
 const pageRect=await p.locator('#pg0').boundingBox();const point=(x,y)=>({x:pageRect.x+pageRect.width*x,y:pageRect.y+pageRect.height*y});
 await p.keyboard.press('r');const a=point(.38,.38),z=point(.58,.53);await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move(z.x,z.y,{steps:8});await p.mouse.up();
 await p.waitForFunction(()=>interactionState().objects.some(o=>o.type==='rect'));await p.keyboard.press('Escape');await p.locator('#btnConnectArrow').click();
 const shapeHit=await p.locator('.shapeMark:not(.connectorMark)').first().evaluate(el=>{const r=el.getBoundingClientRect();for(const dx of [1,4,r.width/2,r.width-1])for(const dy of [1,4,r.height/2,r.height-1]){const x=r.x+dx,y=r.y+dy;if(el.contains(document.elementFromPoint(x,y)))return{x,y}}throw Error('No visible shape hit area '+JSON.stringify(r.toJSON()))});await p.mouse.click(shapeHit.x,shapeHit.y);
 await p.waitForFunction(()=>interactionState().objects.some(o=>o.type==='arrow'));await p.locator('.connectorMark .connectorHit').first().click({force:true});await p.locator('#tbConnectorStyle').selectOption('angled');
 const before=await p.evaluate(()=>interactionState());assert.ok(before.selected.attachTo);
 const elbow=p.locator('.connectorMark.sel .connectorBody.angled');let hr=await elbow.boundingBox();assert.ok(hr);
 const target=point(.15,.31);await p.mouse.move(hr.x+hr.width/2,hr.y+hr.height/2);await p.mouse.down();await p.mouse.move(target.x,target.y,{steps:12});await p.mouse.up();
 const after=await p.evaluate(()=>interactionState());
 assert.ok(Math.hypot(after.selected.x1-before.selected.x1,after.selected.y1-before.selected.y1)>.04,'Arrow root remained pinned');
 assert.equal(after.selected.attachTo,before.selected.attachTo);assert.equal(after.selected.x2,before.selected.x2);assert.equal(after.selected.y2,before.selected.y2);
 await p.keyboard.press('Control+z');
 const undone=await p.evaluate(()=>interactionState().objects.find(o=>o.type==='arrow'));assert.ok(Math.abs(undone.x1-before.selected.x1)<1e-8);assert.ok(Math.abs(undone.y1-before.selected.y1)<1e-8);
 await p.locator('.connectorMark .connectorHit').first().click({force:true});
 await p.setViewportSize({width:390,height:844});await p.locator('#textBar').waitFor({state:'visible'});
 const cdp=await context.newCDPSession(p);
 async function swipe(selector,dx){
  const item=p.locator(selector);await item.evaluate(el=>el.scrollIntoView({block:'nearest',inline:'center'}));
  const r=await item.boundingBox(),br=await p.locator('#textBar').boundingBox();const x=Math.min(br.x+br.width-10,Math.max(br.x+10,r.x+r.width/2)),y=r.y+r.height/2;
  const initial=await p.locator('#textBar').evaluate(el=>el.scrollLeft);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let k=1;k<=5;k++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*k/5,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const final=await p.locator('#textBar').evaluate(el=>el.scrollLeft);assert.ok(Math.abs(final-initial)>20,selector+' did not scroll '+initial+' '+final);
 }
 const stateBeforeScroll=await p.evaluate(()=>interactionState());
 await swipe('#tbStroke',-90);await swipe('#tbSw',-90);await swipe('#tbConnectorStyle',-65);
 await swipe('#tbPin',90);await swipe('#tbDelete',90);
 const stateAfterScroll=await p.evaluate(()=>interactionState());assert.deepEqual(stateAfterScroll.objects,stateBeforeScroll.objects,'Swipe changed PDF objects');assert.equal(stateAfterScroll.pinned,stateBeforeScroll.pinned);
 const sizes=await p.evaluate(()=>{const pin=document.getElementById('tbPin').getBoundingClientRect(),del=document.getElementById('tbDelete').getBoundingClientRect();return{pw:pin.width,ph:pin.height,dw:del.width,dh:del.height,gap:del.left-pin.right}});assert.deepEqual(sizes,{pw:30,ph:30,dw:30,dh:30,gap:6});
 await p.locator('#tbPin').evaluate(el=>el.scrollIntoView({inline:'end',block:'nearest'}));await p.locator('#tbPin').tap();await p.waitForFunction(v=>interactionState().pinned!==v,stateBeforeScroll.pinned,{timeout:2000});
 for(const [id,value] of [['tbSw','3.5'],['tbSw','2.5'],['tbArrowHead','18']]){
  const input=p.locator('#'+id);await input.evaluate(el=>el.scrollIntoView({inline:'center',block:'nearest'}));
  await input.tap();await p.keyboard.insertText(value);
  assert.equal(await input.inputValue(),value,id+' touch must select the whole value, including repeated taps');
 }
 await p.locator('#tbArrowHead').evaluate(el=>el.blur());
 const toggle=p.locator('label:has(#tbStrokeOn)');await toggle.evaluate(el=>el.scrollIntoView({inline:'center',block:'nearest'}));const checked=await p.locator('#tbStrokeOn').isChecked();await toggle.tap();assert.equal(await p.locator('#tbStrokeOn').isChecked(),!checked);await toggle.tap();
 await p.locator('#tbConnectorStyle').evaluate(el=>el.scrollIntoView({inline:'center',block:'nearest'}));await p.locator('#tbConnectorStyle').tap();await p.keyboard.press('End');await p.keyboard.press('Enter');assert.equal(await p.locator('#tbConnectorStyle').inputValue(),'step','Native select did not open');await p.locator('#tbConnectorStyle').selectOption('angled');
 await p.locator('#tbStrokeOp').evaluate(el=>el.scrollIntoView({inline:'center',block:'nearest'}));await p.locator('#tbStrokeOp').tap({position:{x:8,y:5}});assert.notEqual(await p.locator('#tbStrokeOp').inputValue(),'100','Range tap ignored');
 await p.locator('#tbDelete').evaluate(el=>el.scrollIntoView({inline:'end',block:'nearest'}));const dragBefore=await p.locator('#textBar').boundingBox(),deleteRect=await p.locator('#tbDelete').boundingBox(),dragState=await p.evaluate(()=>interactionState());
 const dragPoint={x:deleteRect.x+deleteRect.width/2,y:deleteRect.y+deleteRect.height/2};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[dragPoint]});await p.waitForTimeout(620);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:dragPoint.x,y:dragPoint.y+60}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.ok((await p.locator('#textBar').boundingBox()).y>dragBefore.y+40,'Long press did not move toolbar');assert.deepEqual((await p.evaluate(()=>interactionState())).objects,dragState.objects,'Long press deleted or edited an object');
 await p.locator('#tbPin').tap();assert.equal((await p.evaluate(()=>interactionState())).pinned,false,'Tap after long press ignored');
 await p.locator('#tbDelete').evaluate(el=>el.scrollIntoView({inline:'end',block:'nearest'}));await p.locator('#textBar').screenshot({path:out+'/toolbar.png'});
 await p.setViewportSize({width:320,height:700});
 const compact=await p.locator('#textBar').boundingBox();assert.ok(compact.x>=0&&compact.x+compact.width<=320,'Toolbar moved outside narrow viewport');
 await p.locator('#tbDelete').evaluate(el=>el.scrollIntoView({inline:'end',block:'nearest'}));
 for(const id of ['tbPin','tbDelete']){const rect=await p.locator('#'+id).boundingBox();assert.equal(rect.width,30);assert.equal(rect.height,30);}
 await p.locator('#textBar').screenshot({path:out+'/toolbar-320.png'});
 const count=(await p.evaluate(()=>interactionState())).objects.length;await p.locator('#tbDelete').tap();await p.waitForFunction(n=>interactionState().objects.length===n-1,count);
 assert.deepEqual(errors,[]);console.log('PASS: joint root follows, endpoint/attachment preserved, undo, all toolbar surfaces scroll without editing, 30px actions/6px gap, tap controls');
 }finally{await b.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const {PDFDocument}=require('pdf-lib');
const origin=process.env.TOOLBAR_TEST_ORIGIN||'http://127.0.0.1:9943',pc=process.env.TOOLBAR_TEST_PC==='1';
const out=process.env.TOOLBAR_TEST_OUTPUT||'../output/toolbar-fixes-qa';
let html=fs.readFileSync('PDF편집기.html','utf8').replaceAll('__APP_VER__','toolbar-test').replaceAll('assets/fontawesome/','/assets/fontawesome/').replaceAll('assets/pdfjs/','/assets/pdfjs/');
html=html.replace('mountEditorControllers();',`window.toolbarTest={seed(){editorStore.pages[0].texts=[
 {type:'rect',fx:.2,fy:.3,fw:.4,fh:.2,stroke:'#205ab5',strokeOp:1,fill:'#dbe7ff',fillOp:1,sw:2,text:'Shape text',font:'arial',size:18,color:'#222222',colorOp:1},
 {type:'text',fx:.25,fy:.6,fw:.4,fh:.1,text:'Alignment',font:'arial',size:20,color:'#222222',colorOp:1},
 {type:'arrow',x1:.2,y1:.4,x2:.6,y2:.5,stroke:'#205ab5',sw:2,connectorStyle:'straight'},
 {type:'line',x1:.25,y1:.5,x2:.65,y2:.5,stroke:'#205ab5',sw:2,lineCap:'round'}
 ];positionMarks(document.getElementById('pg0'),editorStore.pages[0]);},select(i){selectOverlayObject(0,editorStore.pages[0].texts[i]);},snapshot(){return JSON.stringify(editorStore.pages[0].texts);}};mountEditorControllers();`);
(async()=>{
 fs.mkdirSync(out,{recursive:true});const pdf=await PDFDocument.create();pdf.addPage([595,842]);const buffer=Buffer.from(await pdf.save());
 const b=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{channel:'chrome'})});
 try{for(const mobile of [false,true]){
 const label=(pc?'pc':'web')+'-'+(mobile?'mobile':'desktop'),c=await b.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile,bypassCSP:true});
 await c.addInitScript(()=>{for(const k of ['tutorialSeen','readerTutorialSeen'])localStorage.setItem('pdfEditor.'+k,'1');localStorage.setItem('pdfEditor.startupMode','blank')});
 const p=await c.newPage(),errors=[];p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
 await p.route(origin+'/editor/?toolbar-test',r=>r.fulfill({contentType:'text/html',body:html}));await p.goto(origin+'/editor/?toolbar-test');await p.waitForFunction(()=>typeof toolbarTest!=='undefined');
 await p.locator('#fileInput').setInputFiles({name:'toolbar.pdf',mimeType:'application/pdf',buffer});await p.waitForFunction(()=>document.querySelector('#pg0 canvas')?.width>100);await p.waitForTimeout(350);await p.evaluate(()=>toolbarTest.seed());
 const press=async loc=>loc[mobile?'tap':'click']();
 await press(p.locator('#btnShape'));assert.equal(await p.locator('#shapeMenu').isVisible(),true);await p.keyboard.press('Escape');
 for(const [id,index]of [['tbAlign',1],['tbValign',1],['stAlign',0],['stValign',0],['tbConnectorStyle',2],['tbArrowEnd',2],['tbLineCap',3]]){
 await p.evaluate(i=>toolbarTest.select(i),index);const sel=p.locator('#'+id);await sel.evaluate(e=>e.scrollIntoView({block:'nearest',inline:'center'}));
 const expected=await sel.locator('option').last().getAttribute('value');await press(sel);await p.waitForTimeout(80);
 assert.equal(await sel.evaluate(e=>e.matches(':open')),true,label+' '+id+': native dropdown closed immediately');
 await p.keyboard.press('End');await p.keyboard.press('Enter');assert.equal(await sel.inputValue(),expected,id+': popup did not select option');
 await press(sel);await p.waitForTimeout(50);assert.equal(await sel.evaluate(e=>e.matches(':open')),true,id+': dropdown cannot reopen');await p.keyboard.press('Escape');
 }
 for(const [id,index]of [['tbFontButton',1],['stFontButton',0]]){
 await p.evaluate(i=>toolbarTest.select(i),index);const btn=p.locator('#'+id);await btn.evaluate(e=>e.scrollIntoView({block:'nearest',inline:'center'}));await press(btn);assert.equal(await p.locator('#fontPicker').isVisible(),true,id);
 const category=p.locator('#fontPickerCategory');await press(category);assert.equal(await category.evaluate(e=>e.matches(':open')),true,'font category');await p.keyboard.press('Escape');await p.keyboard.press('Escape');
 }
 const bars=await p.locator('#toolbar,#textBar,#shapeTextBar').evaluateAll(es=>es.map(e=>({id:e.id,standard:getComputedStyle(e).scrollbarWidth,webkit:getComputedStyle(e,'::-webkit-scrollbar').display})));
 for(const bar of bars){assert.equal(bar.standard,'none',bar.id);assert.equal(bar.webkit,'none',bar.id)}
 if(mobile){
 await p.evaluate(()=>toolbarTest.select(2));const sel=p.locator('#tbConnectorStyle');await sel.evaluate(e=>e.scrollIntoView({block:'nearest',inline:'center'}));
 const bar=p.locator('#textBar'),before=await bar.evaluate(e=>({left:e.scrollLeft,max:e.scrollWidth-e.clientWidth})),state=await p.evaluate(()=>toolbarTest.snapshot());
 const r=await sel.boundingBox(),from={x:r.x+r.width/2,y:r.y+r.height/2},dx=before.left>=before.max/2?65:-65,cdp=await c.newCDPSession(p);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+dx*i/8,y:from.y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.ok(Math.abs(await bar.evaluate(e=>e.scrollLeft)-before.left)>30,'swipe over select did not scroll');assert.equal(await sel.evaluate(e=>e.matches(':open')),false,'swipe opened dropdown');assert.equal(await p.evaluate(()=>toolbarTest.snapshot()),state,'swipe changed object');
 await sel.evaluate(e=>e.scrollIntoView({block:'nearest',inline:'center'}));await press(sel);await p.waitForFunction(()=>document.getElementById('tbConnectorStyle').matches(':open'),null,{timeout:2000});assert.equal(await sel.evaluate(e=>e.matches(':open')),true,'tap after swipe');await p.keyboard.press('Escape');
 }
 if(!pc){
 for(const width of mobile?[390,320]:[1280]){
 await p.setViewportSize({width,height:mobile?844:900});
 for(const language of ['ko','en']){await p.evaluate(language=>DaydayPDFI18n.setLanguage(language),language);
 for(const mode of ['icons','labels'])for(const size of ['small','medium','large']){
 await p.locator('#btnSettings').click();await p.locator('input[name=toolbarDisplay][value='+mode+']').check();await p.locator('input[name=toolbarSize][value='+size+']').check();await p.locator('#setCancel').click();
 await p.locator('#btnSettings').evaluate(e=>e.scrollIntoView({inline:'end',block:'nearest'}));
 const m=await p.evaluate(()=>{const a=document.querySelector('#toolbar [data-language-toggle]'),b=document.getElementById('btnSettings'),r=a.getBoundingClientRect(),s=b.getBoundingClientRect(),code=a.querySelector('.dayday-language-code');return{height:r.height,other:s.height,gap:s.left-r.right,rowGap:parseFloat(getComputedStyle(a.parentElement).gap),codeSize:parseFloat(getComputedStyle(code).fontSize),label:getComputedStyle(a.querySelector('.lbl')).display,center:r.y+r.height/2-(s.y+s.height/2)}});
 assert.equal(m.height,m.other,JSON.stringify({width,mode,size,m}));assert.ok(Math.abs(m.center)<1);assert.ok(Math.abs(m.gap-m.rowGap)<1,'language spacing '+JSON.stringify(m));assert.equal(m.codeSize,{small:11,medium:13,large:15}[size]);assert.equal(m.label==='none',mode==='icons');
 if(size==='large'&&language==='ko')await p.locator('#toolbar').screenshot({path:out+'/'+label+'-'+width+'-'+mode+'.png'});
 }
 }
 }
 await p.locator('#btnReaderMode').click();assert.equal(await p.locator('body').evaluate(e=>e.classList.contains('readerMode')),true);assert.equal(await p.locator('#textBar').isVisible(),false);assert.equal(await p.locator('#shapeTextBar').isVisible(),false);
 }
 assert.deepEqual(errors,[]);console.log('PASS '+label+': seven native dropdowns open/reopen, font menus, hidden scrollbars, select swipe, language size/gaps and viewer');await c.close();
 }}finally{await b.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

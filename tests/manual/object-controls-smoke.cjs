const fs=require('node:fs'), assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {PDFDocument, StandardFonts, rgb}=require('pdf-lib');
const origin=process.env.CONTROLS_TEST_ORIGIN || 'http://127.0.0.1:9950';
const pc=process.env.CONTROLS_TEST_PC==='1', out='../output/object-controls-qa';
let html=fs.readFileSync('PDF편집기.html','utf8').replaceAll('__APP_VER__','controls-test')
  .replaceAll('assets/fontawesome/','/assets/fontawesome/').replaceAll('assets/pdfjs/','/assets/pdfjs/');
html=html.replace('mountEditorControllers();',`window.controlsTest={
  async seed(kind='arrow-filled', style='angled') {
    origClearSel(); deselectText(); objClip=null;
    editorStore.pages[0].texts=[
      {type:'rect',fx:.16,fy:.55,fw:.14,fh:.08,stroke:'#2462af',fill:'#cfe5ff',sw:2,linkId:'anchor'},
      {type:'arrow',x1:.30,y1:.59,x2:.65,y2:.70,stroke:'#2462af',sw:2,strokeOp:1,
        attachTo:'anchor',attachPoint:'start',connectorAnchor:'edge',connectorStyle:style,
        arrowEndType:kind,arrowHeadSize:10,arrowHeadRotation:0}
    ];
    positionMarks(document.getElementById('pg0'),editorStore.pages[0]);
    selectOverlayObject(0,editorStore.pages[0].texts[1]);
  },
  async seedTypes() {
    origClearSel(); deselectText(); objClip=null;
    const image=document.createElement('canvas'); image.width=8; image.height=8;
    image.getContext('2d').fillRect(0,0,8,8);
    editorStore.pages[0].texts=[
      {type:'rect',fx:.15,fy:.55,fw:.12,fh:.07,stroke:'#2462af',fill:'#cfe5ff',sw:2},
      {text:'Added text',font:'roboto',size:18,color:'#2462af',fx:.36,fy:.55,fw:.15,fh:.07},
      {type:'img',data:image.toDataURL(),fx:.61,fy:.55,fw:.12,fh:.07}
    ];
    positionMarks(document.getElementById('pg0'),editorStore.pages[0]); focusViewer();
  },
  async native(on=true) { setOrigMode(on); return origObjects(editorStore.pages[0]); },
  async exportPdf() { return Array.from(await buildPdf(editorStore.pages)); },
  status() {return {selected:origSels.length, overlays:selectedObjectEntries().length,mixed:hasMixedSelection(),
    undo:editorStore.undoStack.length,pending:mixedOperationPending,clip:objClip,objects:editorStore.pages[0].texts.length};},
  async state() {
    return JSON.parse(JSON.stringify({objects:editorStore.pages[0].texts,native:await origObjects(editorStore.pages[0]),
      selected:origSels,overlayCount:selectedObjectEntries().length,mixed:hasMixedSelection(),undo:editorStore.undoStack.length,
      pending:mixedOperationPending,clip:objClip,polyline:connectorPolyline(editorStore.pages[0].texts.find(t=>t.type==='arrow')||{})}));
  },
  async nativePoints() {
    const p=editorStore.pages[0], {view,rT}=await origView(p), r=document.getElementById('pg0').getBoundingClientRect();
    return (await origObjects(p)).map(o=>{const b=pageRectToDispRect(p,view,rT,o.b);
      return {i:o.i,type:o.type,x:r.left+(b.l+b.w/2)*r.width,y:r.top+(b.t+b.h/2)*r.height};});
  }
}; mountEditorControllers();`);
const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<.02,`${msg}: ${a} vs ${b}`);
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const pdf=await PDFDocument.create(), font=await pdf.embedFont(StandardFonts.Helvetica), pg=pdf.addPage([595,842]);
  pg.drawText('Original text',{x:110,y:570,size:23,font,color:rgb(.1,.15,.25)});
  pg.drawRectangle({x:280,y:400,width:110,height:60,color:rgb(.6,.75,.9)});
  const buffer=Buffer.from(await pdf.save());
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH});
  try {
    for(const width of [1280,390]) {
      const mobile=width<769, name=(pc?'pc':'web')+'-'+width;
      const context=await browser.newContext({viewport:{width,height:1000},isMobile:mobile,hasTouch:mobile,bypassCSP:true});
      const vendor='assets/windows-vendor/';
      await context.route('https://cdn.jsdelivr.net/npm/**', async route=>{
        const url=route.request().url(); let file;
        if(url.endsWith('/pdf-lib.min.js'))file='../PDF편집기/node_modules/pdf-lib/dist/pdf-lib.min.js';
        else if(url.endsWith('/fontkit.umd.min.js'))file='../PDF편집기/node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js';
        else if(url.includes('/@embedpdf/pdfium@2.15.0/dist/'))file=vendor+'pdfium/2.15.0/'+url.split('/').at(-1);
        if(file&&fs.existsSync(file))return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.wasm')?'application/wasm':'text/javascript',headers:{'access-control-allow-origin':'*'}});
        return route.continue();
      });
      await context.addInitScript(()=>{
        for(const key of ['tutorialSeen','readerTutorialSeen'])localStorage.setItem('pdfEditor.'+key,'1');
        localStorage.setItem('pdfEditor.startupMode','blank');
      });
      const page=await context.newPage(), errors=[];
      page.on('requestfailed',r=>console.log('REQUEST FAILED',r.url(),r.failure()?.errorText));
      page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text());});
      page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message);});
      await page.route(origin+'/editor/?controls-test',r=>r.fulfill({contentType:'text/html',body:html}));
      await page.goto(origin+'/editor/?controls-test');
      await page.waitForFunction(()=>typeof controlsTest!=='undefined').catch(async e=>{await page.screenshot({path:out+'/startup-error.png'});throw e;});
      await page.locator('#fileInput').setInputFiles({name:'Controls.pdf',mimeType:'application/pdf',buffer});
      await page.waitForFunction(()=>document.querySelector('#pg0 canvas')?.width>100);
      await page.waitForTimeout(500);
      const cdp=await context.newCDPSession(page);
      async function drag(from,to) {
        if(!mobile){await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:12});await page.mouse.up();return;}
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
        for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/12,y:from.y+(to.y-from.y)*i/12}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      }
      const center=async l=>{const b=await l.boundingBox();assert.ok(b);return{x:b.x+b.width/2,y:b.y+b.height/2};};
      await page.evaluate(()=>controlsTest.seed());
      if(mobile) await page.locator('.obj').first().tap();
      else await page.locator('.obj').first().click();
      for(const dir of ['n','nw','ne']) {
        const handle=page.locator('.objHandle.dir-'+dir), point=await center(handle);
        assert.equal(await page.evaluate(({x,y,dir})=>document.elementFromPoint(x,y)?.classList.contains('dir-'+dir),{...point,dir}),true,'top resize handle is covered: '+dir);
      }
      const north=page.locator('.objHandle.dir-n');
      if(mobile) await north.tap();
      const beforeResize=await page.evaluate(()=>controlsTest.state()), northPoint=await center(north);
      await drag(northPoint,{x:northPoint.x,y:northPoint.y-24});
      const afterResize=await page.evaluate(()=>controlsTest.state());
      assert.ok(afterResize.objects[0].fh>beforeResize.objects[0].fh,'top drag must resize the object');
      assert.equal(afterResize.objects[0].rot||0,beforeResize.objects[0].rot||0,'top drag must not rotate the object');
      const rotationPoint=await center(page.locator('.objHandle.rotate'));
      const objectCenter=await center(page.locator('.obj').first());
      const rx=rotationPoint.x-objectCenter.x, ry=rotationPoint.y-objectCenter.y;
      await drag(rotationPoint,{x:objectCenter.x+Math.cos(.6)*rx-Math.sin(.6)*ry,y:objectCenter.y+Math.sin(.6)*rx+Math.cos(.6)*ry});
      const afterRotate=await page.evaluate(()=>controlsTest.state());
      assert.ok(Math.abs(afterRotate.objects[0].rot)>20,'rotation knob must remain draggable');
      console.log('PASS '+name+' top resize hit targets, resize without rotation, rotation knob');
      const chooseTypes=async order=>{
        if(mobile && !pc) {
          await page.locator('#btnMultiPick').click();
          for(const index of order)await page.locator('.obj').nth(index).tap();
          await page.locator('#btnMultiPick').click();
          return;
        }
        await page.locator('.obj').nth(order[0]).click();
        await page.keyboard.down('Control');
        for(const index of order.slice(1)) await page.locator('.obj').nth(index).click();
        await page.keyboard.up('Control');
      };
      for(const order of (mobile ? [[2,1,0]] : [[0,1,2],[2,1,0],[1,2,0]])) {
        await page.evaluate(()=>controlsTest.seedTypes());
        await chooseTypes(order);
        assert.equal((await page.evaluate(()=>controlsTest.status())).overlays,3,'text, shape and image all selected');
        assert.equal(await page.locator('#textBar.mixedSelection').count(),1,'mixed types use common actions');
        assert.equal(await page.locator('#tbFontButton').isVisible(),false,'mixed types do not share font options');
        const beforeScale=await page.evaluate(()=>controlsTest.state());
        const corner=await center(page.locator('.multiSelectionBounds .dir-se'));
        await drag(corner,{x:corner.x+12,y:corner.y+10});
        const afterScale=await page.evaluate(()=>controlsTest.state());
        for(let i=0;i<3;i++)assert.ok(afterScale.objects[i].fw>beforeScale.objects[i].fw,'all kinds resize together');
        const before=afterScale, from=await center(page.locator('.obj').first());
        await drag(from,{x:from.x+18,y:from.y-12});
        let after=await page.evaluate(()=>controlsTest.state());
        const dx=after.objects[0].fx-before.objects[0].fx, dy=after.objects[0].fy-before.objects[0].fy;
        assert.ok(dx>0 && dy<0);
        for(let i=1;i<3;i++) {
          assert.ok(Math.abs(after.objects[i].fx-before.objects[i].fx-dx)<1e-8,'group drag x');
          assert.ok(Math.abs(after.objects[i].fy-before.objects[i].fy-dy)<1e-8,'group drag y');
        }
        const x=after.objects.map(o=>o.fx);
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(850);
        after=await page.evaluate(()=>controlsTest.state());
        assert.ok(after.objects[0].fx>x[0]);
        for(let i=1;i<3;i++)assert.ok(Math.abs(after.objects[i].fx-x[i]-(after.objects[0].fx-x[0]))<1e-8,'all kinds nudge together');
        await page.keyboard.press('Control+c');
        await page.waitForFunction(()=>controlsTest.status().clip?.objects?.length===3);
        const clip=(await page.evaluate(()=>controlsTest.state())).clip;
        assert.deepEqual(clip.objects.map(o=>o.type||'text').sort(),['img','rect','text']);
        await page.keyboard.press('Control+v');
        await page.waitForFunction(()=>controlsTest.status().objects===6 && controlsTest.status().overlays===3);
        await page.keyboard.press('Delete');
        await page.waitForFunction(()=>controlsTest.status().objects===3);
        await page.locator('#btnUndo').click();
        await page.waitForFunction(()=>controlsTest.status().objects===6);
        await chooseTypes([3,4,5]);
        await page.keyboard.press('Control+x');
        await page.waitForFunction(()=>controlsTest.status().objects===3);
        await page.locator('#btnUndo').click();
        await page.waitForFunction(()=>controlsTest.status().objects===6);
      }
      if(!mobile) {
        await page.evaluate(()=>controlsTest.seedTypes());
        await page.keyboard.press('m');
        const rect=await page.locator('#pg0').boundingBox();
        await drag({x:rect.x+.10*rect.width,y:rect.y+.52*rect.height},
          {x:rect.x+.78*rect.width,y:rect.y+.65*rect.height});
        assert.equal((await page.evaluate(()=>controlsTest.status())).overlays,3,'marquee selects all types');
        if(!pc)await page.keyboard.press('m');
        await page.keyboard.down('Control');
        await page.locator('.obj').nth(2).click();
        await page.locator('.obj').nth(1).click();
        await page.keyboard.up('Control');
        assert.equal(await page.locator('#textBar.mixedSelection').count(),0,'single type restores its toolbar');
      }
      console.log('PASS '+name+' mixed added types select/resize/drag/nudge/copy/paste/delete/cut/undo');
      for(const kind of ['arrow-filled','arrow-open']) {
        await page.evaluate(kind=>controlsTest.seed(kind),kind);
        const before=await page.evaluate(()=>controlsTest.state());
        const from=await center(page.locator('.lineRotate'));
        const end=await center(page.locator('.objHandle.p2'));
        assert.ok(Math.hypot(from.x-end.x,from.y-end.y)>=(mobile?60:44),'head handle separation');
        const angle=.63, dx=from.x-end.x,dy=from.y-end.y;
        await drag(from,{x:end.x+Math.cos(angle)*dx-Math.sin(angle)*dy,y:end.y+Math.sin(angle)*dx+Math.cos(angle)*dy});
        const after=await page.evaluate(()=>controlsTest.state());
        assert.ok(Math.abs(after.objects[1].arrowHeadRotation)>20,kind+' head did not rotate');
        for(const key of ['x1','x2','y1','y2','connectorBendX','connectorBendY','attachTo']) {
          const a=after.objects[1][key],b=before.objects[1][key];
          if(typeof a==='number')assert.ok(Math.abs(a-b)<1e-10,'rotation changes '+key);
          else assert.equal(a,b,'rotation changes '+key);
        }
        assert.equal(after.undo,before.undo+1);
        if(!mobile) {
          const bytes=Buffer.from(await page.evaluate(()=>controlsTest.exportPdf()));
          assert.equal((await PDFDocument.load(bytes)).getPageCount(),1);
          fs.writeFileSync(out+'/'+name+'-'+kind+'.pdf',bytes);
        }
        await page.locator('#btnUndo').click();
        await page.evaluate(kind=>controlsTest.seed(kind),kind);
        const start=await page.evaluate(()=>controlsTest.state());
        if(mobile)await page.locator('.objHandle.p2').tap();
        const endpoint=await center(page.locator('.objHandle.p2'));
        await drag(endpoint,{x:endpoint.x+24,y:endpoint.y-19});
        const moved=await page.evaluate(()=>controlsTest.state());
        near(moved.objects[1].connectorBendX,start.polyline[1][0],'fixed elbow x');
        near(moved.objects[1].connectorBendY,start.polyline[1][1],'fixed elbow y');
        const points=moved.polyline,last=points.at(-1),prev=points.at(-2);
        assert.ok(Math.abs(last[0]-prev[0])>.01&&Math.abs(last[1]-prev[1])>.01,'head follows a diagonal final segment');
        await page.screenshot({path:out+'/'+name+'-'+kind+'.png'});
      }
      console.log('PASS '+name+' arrow rotation/diagonal head/undo');
      if(!mobile) {
        await page.evaluate(()=>controlsTest.seed());
        await page.evaluate(()=>controlsTest.native());
        let points=await page.evaluate(()=>controlsTest.nativePoints());
        await page.mouse.click(points[0].x,points[0].y);
        await page.waitForFunction(()=>controlsTest.status().selected===1);
        await page.keyboard.down('Control');
        await page.mouse.click(points[1].x,points[1].y);
        await page.keyboard.up('Control');
        await page.waitForFunction(()=>controlsTest.status().selected===2);
        const overlay=await center(page.locator('.obj').first());
        await page.keyboard.down('Control');await page.mouse.click(overlay.x,overlay.y);await page.keyboard.up('Control');
        await page.waitForFunction(()=>{const s=controlsTest.status();return s.mixed&&s.overlays===1;});
        assert.equal(await page.locator('.oh,.objHandle').count(),0,'no partial transform handles');
        const before=await page.evaluate(()=>controlsTest.state());
        await drag(overlay,{x:overlay.x+45,y:overlay.y+27});
        await page.waitForFunction(n=>{const s=controlsTest.status();return !s.pending&&s.undo===n+1;},before.undo);
        await page.waitForTimeout(500);
        let after=await page.evaluate(()=>controlsTest.state());
        fs.writeFileSync(out+'/'+name+'-move.json',JSON.stringify({before,after},null,2));
        const r=await page.locator('#pg0').boundingBox();
        near(after.objects[0].fx-before.objects[0].fx,45/r.width,'overlay move x');
        near(after.native[0].b[0]-before.native[0].b[0],45/r.width*595,'native text move x');
        near(after.native[1].b[0]-before.native[1].b[0],45/r.width*595,'native shape move x');
        assert.ok(after.mixed,'selection survives source rerender');
        await page.screenshot({path:out+'/'+name+'-mixed.png'});
        await page.keyboard.press('Control+c');
        await page.waitForFunction(()=>controlsTest.status().clip?.objects?.[0]?.clipSrc);
        const clip=(await page.evaluate(()=>controlsTest.state())).clip;
        assert.ok(clip.objects[0].clipSrc,'original contents keep vector source');
        assert.ok(clip.objects.some(o=>o.type==='rect'),'editable overlay included');
        const count=after.undo;
        await page.keyboard.press('Delete');
        await page.waitForFunction(n=>{const s=controlsTest.status();return s.undo===n+1&&s.objects===0;},count);
        assert.equal((await page.evaluate(()=>controlsTest.state())).native.length,0);
        await page.locator('#btnUndo').click();
        await page.waitForFunction(()=>controlsTest.status().objects===2);
        after=await page.evaluate(()=>controlsTest.state());
        near(after.objects[0].fx,before.objects[0].fx+45/r.width,'undo deletion restores overlay position');
        await page.locator('#btnUndo').click();
        await page.waitForFunction(n=>controlsTest.status().undo===n,before.undo);
        after=await page.evaluate(()=>controlsTest.state());
        near(after.native[0].b[0],before.native[0].b[0],'one undo restores native move');
        near(after.objects[0].fx,before.objects[0].fx,'one undo restores overlay move');
        await page.evaluate(()=>controlsTest.native(false));
        points=await page.evaluate(()=>controlsTest.nativePoints());
        const overlayAgain=await center(page.locator('.obj').first());
        await page.mouse.click(overlayAgain.x,overlayAgain.y);
        await page.keyboard.down('Control');
        for(const point of points)await page.mouse.click(point.x,point.y);
        await page.keyboard.up('Control');
        await page.waitForFunction(()=>{const s=controlsTest.status();return s.mixed&&s.selected===2;});
        await page.keyboard.down('Control');await page.mouse.click(points[0].x,points[0].y);await page.keyboard.up('Control');
        await page.waitForFunction(()=>{const s=controlsTest.status();return s.mixed&&s.selected===1;});
        await page.keyboard.down('Control');await page.mouse.click(overlayAgain.x,overlayAgain.y);await page.keyboard.up('Control');
        await page.waitForFunction(()=>{const s=controlsTest.status();return !s.mixed&&s.selected===1&&s.overlays===0;});
        await page.keyboard.down('Control');await page.mouse.click(overlayAgain.x,overlayAgain.y);await page.keyboard.up('Control');
        await page.waitForFunction(()=>controlsTest.status().mixed);
        const nudgeBefore=await page.evaluate(()=>controlsTest.state());
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(n=>{const s=controlsTest.status();return !s.pending&&s.undo===n+1;},nudgeBefore.undo);
        const nudged=await page.evaluate(()=>controlsTest.state());
        near(nudged.native[1].b[0]-nudgeBefore.native[1].b[0],595/r.width,'mixed keyboard native move');
        near(nudged.objects[0].fx-nudgeBefore.objects[0].fx,1/r.width,'mixed keyboard overlay move');
        console.log('PASS '+name+' reverse Ctrl selection, toggling, mixed keyboard movement');
        console.log('PASS '+name+' Ctrl native+overlay move/copy/delete/atomic undo');
        if(!pc){await page.locator('#btnReaderMode').click();assert.equal(await page.locator('.origBox,.objHandle').count(),0);}
      }
      assert.deepEqual(errors,[]); await context.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

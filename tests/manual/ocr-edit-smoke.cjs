const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { PDFDocument, degrees, StandardFonts } = require('pdf-lib');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..'), web = path.join(root, 'windows/PdfEditor.Preview/WebApp');
const out = path.join(root, 'tmp/ocr-edit-check');
fs.mkdirSync(out, { recursive: true });
let html = fs.readFileSync(path.join(web, 'view.html'), 'utf8');
function inject(from, to) { assert.ok(html.includes(from), from); html = html.replace(from, () => to); }
inject('if (desktopViewMode) return desktopOutput.save(bytes, name);', 'window.savedOcr = bytes.slice(); return { ok:true };');
inject('if (desktopViewMode) return desktopOutput.openSaved(saved.requestId);', 'return true;');
inject('mountEditorControllers();', 'window.ocrCheck={withDocument:withPdfiumDoc, save:()=>buildPdf(editorStore.pages.map(clonePage)), text:(i)=>origReadTextContent(editorStore.pages[0],i), objs:()=>origObjects(editorStore.pages[0]), ready:()=>!!editorStore.activeDocument?.fitDone}; mountEditorControllers();');
const mime = { '.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.css':'text/css','.ttf':'font/ttf' };
const server = http.createServer((req,res) => {
  const url = new URL(req.url,'http://localhost');
  if(url.pathname === '/test') { res.setHeader('Content-Type','text/html; charset=utf-8'); return res.end(html); }
  for(const base of [web, root]) {
    const f=path.resolve(base,'.'+decodeURIComponent(url.pathname));
    if(!f.startsWith(path.join(base,'assets')+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()) continue;
    res.setHeader('Content-Type',mime[path.extname(f)]||'application/octet-stream'); return fs.createReadStream(f).pipe(res);
  }
  res.writeHead(404); res.end();
});
async function main() {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const context=await browser.newContext({viewport:{width:1350,height:850},bypassCSP:true});
    let page=await context.newPage();
    page.setDefaultTimeout(35000);
    page.on('pageerror',e=>console.log('PAGE:',e.message));
    page.on('console',e=>{if(e.type()==='error'&&!e.text().includes('Failed to load resource')) console.log(e.text().slice(0,300));});
    await context.addInitScript(()=>{
      localStorage.setItem('pdfEditor.tutorialSeen','1'); localStorage.setItem('pdfEditor.startupMode','blank');
      const handlers=[];Object.defineProperty(window.chrome,'webview',{value:{addEventListener(t,h){if(t==='message')handlers.push(h);},removeEventListener(){},postMessage(m){if(m.type==='view-ready')queueMicrotask(()=>handlers.forEach(h=>h({data:{cmd:'dismiss-boot-splash'}})));}}});
    });
    await page.goto('http://127.0.0.1:'+server.address().port+'/test');
    await page.locator('#appBootSplash').waitFor({state:'hidden'});
    const png=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=1200;c.height=710;const x=c.getContext('2d');
      x.fillStyle='#faf9f2';x.fillRect(0,0,c.width,c.height);
      x.strokeStyle='#38404c';x.lineWidth=3;x.strokeRect(45,70,1110,440);x.beginPath();x.moveTo(45,270);x.lineTo(1155,270);x.stroke();
      x.font='56px "Malgun Gothic"';x.fillStyle='#1d3951';x.fillText('검사 결과 합격',90,200);
      x.font='48px "Malgun Gothic"';x.fillStyle='#222222';x.fillText('설치 수량 125',90,405);
      x.fillStyle='#a64539';x.fillRect(950,550,145,75);
      return c.toDataURL().split(',')[1];
    });
    const pdf=await PDFDocument.create(), img=await pdf.embedPng(Buffer.from(png,'base64'));
    pdf.addPage([600,355]).drawImage(img,{x:0,y:0,width:600,height:355});
    const digital=pdf.addPage([600,355]);digital.drawText('Existing selectable text',{x:40,y:180,font:await pdf.embedFont(StandardFonts.Helvetica),size:18});
    const scan=Buffer.from(await pdf.save());fs.writeFileSync(path.join(out,'scan.pdf'),scan);
    await page.locator('#fileInput').setInputFiles({name:'scan.pdf',mimeType:'application/pdf',buffer:scan});
    await page.waitForFunction(()=>window.ocrCheck?.ready()&&document.querySelector('#pg0')?.dataset.rendered);
    await page.locator('#btnDocumentTools').evaluate(e=>e.click());
    await page.locator('#documentOutput').selectOption('editable-pdf');
    await page.locator('#documentPages').fill('1');
    await page.locator('#documentReview').check();
    await page.locator('#documentToolsOverlay [data-run]').click();
    try {await page.locator('[data-review-preview]').waitFor({timeout:90000});}
    catch(e){throw Error('review unavailable: '+await page.locator('.documentToolsStatus').textContent(),{cause:e});}
    await page.locator('[data-review-filter]').selectOption('all');
    let before=await page.locator('[data-review-text]').inputValue();
    if (!before.includes('검사')) {await page.locator('[data-review-next]').click();before=await page.locator('[data-review-text]').inputValue();}
    console.log('Recognized:',before); assert.match(before,/검사/);
    await page.locator('[data-review-text]').fill('검사 결과 승인');
    await page.locator('[data-review-apply]').click();
    await page.waitForFunction(()=>window.savedOcr || !document.querySelector('#documentToolsOverlay [data-run]').disabled,null,{timeout:60000});
    assert.ok(await page.evaluate(()=>!!window.savedOcr),await page.locator('#documentToolsOverlay .documentToolsStatus').textContent());
    await page.waitForFunction(()=>!document.querySelector('#documentToolsOverlay').classList.contains('show'),null,{timeout:15000}).catch(async e=>{throw Error(await page.locator('#documentToolsOverlay .documentToolsStatus').textContent(),{cause:e});});
    fs.writeFileSync(path.join(out,'editable.pdf'),Buffer.from(await page.evaluate(()=>Array.from(window.savedOcr))));
    const saved=fs.readFileSync(path.join(out,'editable.pdf'));
    await page.close(); page=await context.newPage();
    await page.goto('http://127.0.0.1:'+server.address().port+'/test');
    await page.locator('#appBootSplash').waitFor({state:'hidden'});
    await page.locator('#fileInput').setInputFiles({name:'editable.pdf',mimeType:'application/pdf',buffer:saved});
    await page.waitForFunction(()=>window.ocrCheck?.ready()&&document.querySelector('#pg0')?.dataset.rendered);
    const findTarget=async()=>page.evaluate(async()=>{
      const objects=await ocrCheck.objs(), result=[];
      for(const o of objects.filter(o=>o.type===1)) result.push({b:o.b,text:await ocrCheck.text(o.i),hidden:!!o.invisible});
      return result;
    });
    let objects=await findTarget();console.log('Native OCR objects',JSON.stringify(objects));assert.ok(objects.find(o=>o.text==='검사 결과 승인'&&!o.hidden));
    await page.locator('#btnOrig').click();
    const box=objects.find(o=>o.text==='검사 결과 승인').b, view=await page.locator('#pg0').boundingBox();
    await page.mouse.dblclick(view.x+view.width*(box[0]+box[2])/1200,view.y+view.height*(1-(box[1]+box[3])/710));
    const input=page.locator('.origEdit[contenteditable=true]');await input.waitFor();await input.fill('검사 결과 확인');await input.dispatchEvent('keydown',{key:'Enter',isComposing:true});assert.ok(await input.isVisible());await input.press('Enter');
    await page.waitForFunction(()=>!document.querySelector('.origEdit') && (document.querySelector('.textMark')?.textContent?.includes('확인') || document.querySelector('.textMark')?.innerText?.includes('확인')),null,{timeout:12000}).catch(()=>{});
    const edited=Buffer.from(await page.evaluate(async()=>Array.from(await ocrCheck.save())));fs.writeFileSync(path.join(out,'edited.pdf'),edited);
    const tests=await page.evaluate(async(source)=>{
      const runtime=await import('/assets/editor-tools/runtime.js');
      const file=bytes=>new File([new Uint8Array(bytes)],'scan.pdf',{type:'application/pdf'});
      const opt={language:'kor+eng',quality:'balanced',pageRange:'1',withDocument:ocrCheck.withDocument};
      const searchable=await runtime.convertEditorDocument(file(source),{...opt,output:'pdf',reviewPage:async p=>({texts:p.lines.map(l=>l.text.includes('검사')?'검색 교정 완료':l.text)})});
      const reprocessed=await runtime.convertEditorDocument(file(searchable.bytes),{...opt,output:'editable-pdf'});
      const repeated=await runtime.convertEditorDocument(file(reprocessed.bytes),{...opt,output:'editable-pdf',forceOcr:true});
      return [searchable,reprocessed,repeated].map(r=>Array.from(r.bytes));
    },Array.from(scan));
    ['searchable','reprocessed','repeated'].forEach((s,i)=>fs.writeFileSync(path.join(out,s+'.pdf'),Buffer.from(tests[i])));
    const spun=await PDFDocument.create(), embedded=await spun.embedPng(Buffer.from(png,'base64'));
    const rot=spun.addPage([395,660]); rot.setCropBox(20,30,355,600); rot.setRotation(degrees(90));
    rot.drawImage(embedded,{x:375,y:30,width:600,height:355,rotate:degrees(90)});
    rot.drawText('NATIVE TITLE',{x:55,y:65,size:14,rotate:degrees(90)});
    const rotated=Buffer.from(await spun.save());fs.writeFileSync(path.join(out,'rotated-source.pdf'),rotated);
    const transformed=await page.evaluate(async data=>{
      const r=await import('/assets/editor-tools/runtime.js');
      const result=await r.convertEditorDocument(new File([new Uint8Array(data)],'mixed.pdf'),
        {output:'editable-pdf',withDocument:ocrCheck.withDocument,reviewPage:async p=>({texts:p.lines.map(l=>l.text.includes('검사')?'회전 편집 확인':l.text)})});
      return Array.from(result.bytes);
    },Array.from(rotated));
    fs.writeFileSync(path.join(out,'rotated.pdf'),Buffer.from(transformed));
    await page.close(); page=await context.newPage();
    await page.goto('http://127.0.0.1:'+server.address().port+'/test');
    await page.locator('#appBootSplash').waitFor({state:'hidden'});
    await page.locator('#fileInput').setInputFiles({name:'searchable.pdf',mimeType:'application/pdf',buffer:Buffer.from(tests[0])});
    await page.waitForFunction(()=>window.ocrCheck?.ready()&&document.querySelector('#pg0')?.dataset.rendered);
    objects=await findTarget();
    const old=objects.find(o=>o.text==='검색 교정 완료'&&o.hidden);assert.ok(old);
    await page.locator('#btnOrig').click(); const r=await page.locator('#pg0').boundingBox();
    await page.mouse.dblclick(r.x+r.width*(old.b[0]+old.b[2])/1200,r.y+r.height*(1-(old.b[1]+old.b[3])/710));
    await page.locator('.ocrUnavailableDialog textarea').fill('저장 후 교정');
    await page.getByRole('button',{name:'검색 글자 적용'}).click();
    await page.locator('.ocrUnavailableDialog').waitFor({state:'hidden'});
    assert.equal((await findTarget()).filter(o=>o.text==='저장 후 교정'&&o.hidden).length,1);
    fs.writeFileSync(path.join(out,'post-review.pdf'),Buffer.from(await page.evaluate(async()=>Array.from(await ocrCheck.save()))));
    const table = fs.readFileSync(path.join(root,'tests/fixtures/ocr-korean-table.pdf'));
    const text = await page.evaluate(async bytes => {
      const runtime = await import('/assets/editor-tools/runtime.js');
      const converted = await runtime.convertEditorDocument(new File([new Uint8Array(bytes)],'table.pdf'), {output:'editable-pdf',withDocument:ocrCheck.withDocument});
      const pdfjs = await import('/assets/pdfjs/6.2.108/legacy/build/pdf.min.mjs');
      const doc = await pdfjs.getDocument({data:converted.bytes}).promise;
      try { return (await (await doc.getPage(1)).getTextContent()).items.map(item=>item.str).join('').replace(/\s/g,''); }
      finally { await doc.loadingTask.destroy(); }
    },Array.from(table));
    for(let i=0;i<20;i++) assert.ok(text.includes(String(i+1).padStart(2,'0')+'작업구역'+(i%4+1)+'층설치수량'+(105+i)+'개검사결과정상'),'OCR table row '+(i+1));
    console.log('PASS: 20 Korean table rows, OCR review, native edit, repeated conversion, rotated mixed page and post-save correction.');
  } finally { await browser.close(); await new Promise(r=>server.close(r)); }
}
main().catch(e=>{console.error(e);process.exitCode=1;server.close();});

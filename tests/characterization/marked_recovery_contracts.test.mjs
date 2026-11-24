import assert from 'node:assert/strict';
import test from 'node:test';
import * as P from 'pdf-lib';
import {findMarkedPageCandidates,prepareMarkedRestoration} from '../../src/features/recovery/marked-page-filter.js';
const options={yieldControl:async()=>{}};
const shape={type:'rect',fx:.2,fy:.3,fw:.1,fh:.2,stroke:'#ff0000',sw:2,_m:1};
const header=(object=shape,tag='SolTx')=>'/'+tag+' << /T <'+Buffer.from(JSON.stringify(object)).toString('hex')+'> >> BDC\n';
const owned=(body='q 1 0 0 RG 20 20 30 40 re S Q',object=shape,tag='SolTx')=>header(object,tag)+body+'\nEMC\n';
async function fixture(contents) {
 const d=await P.PDFDocument.create();
 for(const streams of contents) {const page=d.addPage([400,500]);page.node.set(P.PDFName.of('Contents'),d.context.obj(streams.map(x=>d.context.register(d.context.flateStream(x)))));}
 d.setKeywords(['sol-marked']);return d.save();
}
const sanitize=x=>x.type==='rect'||x.type==='ink'?x:null;
async function content(bytes,k) {
 const d=await P.PDFDocument.load(bytes),c=d.getPages()[k].node.Contents();
 return Array.from({length:c.size()},(_,i)=>Buffer.from(P.decodePDFRawStream(c.lookup(i)).decode()).toString('latin1'));
}
test('owned overlay streams restore without touching complex original drawing streams or other pages',async()=>{
 const drawing='q 0 0 m 100 100 l S Q\n'.repeat(10000);
 const bytes=await fixture([[drawing,owned()],[drawing],[]]);
 const before=await content(bytes,0),r=await prepareMarkedRestoration(bytes,P,sanitize,options);
 assert.deepEqual([...r.candidates],[0]);assert.ok(r.restored);
 assert.deepEqual(await content(r.restored.bytes,0),[before[0]]);
 assert.deepEqual(await content(r.restored.bytes,1),await content(bytes,1));
 assert.deepEqual(r.restored.pageTexts[0],[{...shape,_m:undefined}].map(({_m,...x})=>x));
 assert.equal((await P.PDFDocument.load(r.restored.bytes)).getPageCount(),3);
});
test('multiple marked streams, ink, repeated text fragments and distinct identical objects keep identity',async()=>{
 const ink={...shape,type:'ink',_m:2};
 const bytes=await fixture([[owned()+owned(),owned('q 0 0 m 1 1 l S Q',ink,'SolInk')+owned('q 1 1 2 2 re S Q',{...shape,_m:3})]]);
 const r=await prepareMarkedRestoration(bytes,P,sanitize,options);
 assert.deepEqual(r.restored.pageTexts[0].map(x=>x.type),['rect','ink','rect']);
 assert.deepEqual(await content(r.restored.bytes,0),[]);
});
test('literal strings and comments cannot masquerade as body operators',async()=>{
 const bytes=await fixture([[owned('q BT (Q EMC \(test\)) Tj ET % EMC Q\n Q')]]);
 assert.ok((await prepareMarkedRestoration(bytes,P,sanitize,options)).restored);
});
for(const [label,stream] of [
 ['unmarked visible content in same stream',owned()+'q 0 0 20 20 re f Q'],
 ['unbalanced graphics state',owned('q q 1 1 2 2 re S Q')],
 ['drawing outside a state wrapper',owned('1 1 2 2 re S')],
 ['nested foreign marked content',owned('q /Other BMC 1 1 2 2 re S EMC Q')],
 ['inline image',owned('q BI /W 1 /H 1 ID abc EI Q')],
 ['escaped tag name',owned().replace('/SolTx','/Sol#54x')],
 ['mixed tag case',owned()+owned('q 1 1 2 2 re S Q',shape,'soltx')],
 ['unsupported object',owned('q 1 1 2 2 re S Q',{type:'unknown'})],
])test(label+' conservatively retains native recovery',async()=>{
 const r=await prepareMarkedRestoration(await fixture([[stream]]),P,sanitize,options);
 assert.deepEqual([...r.candidates],[0]);assert.equal(r.restored,null);
});
test('empty candidates skip the engine; size, page count and parse uncertainty cannot skip recovery',async()=>{
 const b=await fixture([['q 0 0 m 1 1 l S Q'],[]]);
 assert.equal((await findMarkedPageCandidates(b,P,options)).size,0);
 assert.deepEqual([...await findMarkedPageCandidates(b,P,{...options,maxDecodedBytes:4})],[0]);
 assert.equal((await prepareMarkedRestoration(b,P,sanitize,{...options,expectedPages:3})).candidates,null);
 assert.equal((await prepareMarkedRestoration(new Uint8Array([0]),P,sanitize,options)).candidates,null);
});

test('uncertain later streams prohibit partial fast recovery after an earlier owned stream',async()=>{
 const bytes=await fixture([[owned(),'q 0 0 1 1 re S Q\n'.repeat(100)]]);
 const r=await prepareMarkedRestoration(bytes,P,sanitize,{...options,maxDecodedBytes:800});
 assert.deepEqual([...r.candidates],[0]);assert.equal(r.restored,null);
 const d=await P.PDFDocument.load(await fixture([[owned()]]));
 const page=d.getPages()[0],bad=d.context.register(d.context.stream('unreadable',{Filter:'UnknownFilter'}));
 page.node.Contents().push(bad);
 assert.equal((await prepareMarkedRestoration(await d.save(),P,sanitize,options)).restored,null);
});
test('a direct single content stream is restored without depending on an array wrapper',async()=>{
 const d=await P.PDFDocument.create(),page=d.addPage();page.node.set(P.PDFName.of('Contents'),d.context.register(d.context.flateStream(owned())));
 const r=await prepareMarkedRestoration(await d.save(),P,sanitize,options);
 assert.equal(r.restored.pageTexts[0].length,1);assert.deepEqual(await content(r.restored.bytes,0),[]);
});

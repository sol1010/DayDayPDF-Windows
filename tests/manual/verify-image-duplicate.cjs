const fs=require('node:fs'),path=require('node:path'),P=require('pdf-lib'),assert=require('node:assert/strict');
function rgbPixels(image,w,h){
 const data=P.decodePDFRawStream(image).decode();
 if(data.length===w*h*3)return data;
 assert.equal(data.length,(w*3+1)*h);const result=new Uint8Array(w*h*3),stride=w*3;
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<h;y++){const filter=data[y*(stride+1)];assert.ok(filter<=4);
  for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=3?result[i-3]:0,b=y?result[i-stride]:0,c=y&&x>=3?result[i-stride-3]:0;
   result[i]=data[y*(stride+1)+1+x]+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c));
  }
 }
 return result;
}
(async()=>{
 const sets=[];
 for(const file of process.argv.slice(2,4)){
  const doc=await P.PDFDocument.load(fs.readFileSync(file));assert.equal(doc.getPageCount(),4);assert.equal(doc.getKeywords(),undefined);const pages=[];
  for(const page of doc.getPages()){
   assert.equal(page.node.Resources().lookup(P.PDFName.of('Font'))?.keys().length||0,0);assert.equal(page.node.Annots()?.size()||0,0);
   const refs=page.node.Resources().lookup(P.PDFName.of('XObject')).values();assert.equal(refs.length,1);
   const image=doc.context.lookup(refs[0]),w=image.dict.lookup(P.PDFName.of('Width')).asNumber(),h=image.dict.lookup(P.PDFName.of('Height')).asNumber();
   assert.equal(w,3508);assert.equal(h,2481);const bytes=rgbPixels(image,w,h),sample=[];
   for(let y=0;y<h;y+=16)for(let x=0;x<w;x+=16){let sum=0,count=0;for(let dy=0;dy<16&&y+dy<h;dy++)for(let dx=0;dx<16&&x+dx<w;dx++){const i=((y+dy)*w+x+dx)*3;sum+=bytes[i]+bytes[i+1]+bytes[i+2];count+=3;}sample.push(sum/count);}
   pages.push(sample);
  }
  sets.push(pages);
 }
 const distance=sets[1].map(a=>sets[0].map(b=>a.reduce((s,v,i)=>s+Math.abs(v-b[i]),0)/a.length));
 const matches=distance.map(r=>r.indexOf(Math.min(...r)));assert.deepEqual(matches,[0,1,2,3]);
 for(let i=0;i<4;i++)assert.ok(distance[i][i]<5,'Same-page appearance changed');
 const result={dimensions:[3508,2481],pages:4,imagesPerPage:1,fonts:0,annotations:0,editMetadata:false,matches,distance};
 fs.writeFileSync(path.join(path.dirname(process.argv[3]),'fidelity.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;});

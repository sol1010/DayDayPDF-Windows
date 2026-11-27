async function readContent(stream, pdfLib, limit) {
  const filter = stream.dict.get(pdfLib.PDFName.of('Filter'));
  const native = typeof DecompressionStream === 'function' && stream.contents.length >= 2048 &&
    String(filter) === '/FlateDecode' && !stream.dict.has(pdfLib.PDFName.of('DecodeParms'));
  const reader = native ? new Blob([stream.contents]).stream().pipeThrough(new DecompressionStream('deflate')).getReader() : null;
  const decoder = reader ? null : pdfLib.decodePDFRawStream(stream);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const data = reader ? (await reader.read()).value : decoder.getBytes(Math.min(65536, limit - size + 1));
      if (!data?.length) break;
      size += data.length;
      if (size > limit) {
        if (reader) await reader.cancel();
        return null;
      }
      chunks.push(data);
    }
  } finally { reader?.releaseLock(); }
  if (chunks.length === 1) return chunks[0];
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

async function inspectMarkedPages(bytes, pdfLib, { expectedPages, maxDecodedBytes = 64 * 1024 * 1024,
  yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  try {
    const { PDFDocument, PDFArray, PDFRawStream } = pdfLib;
    const document = await PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: 1500 });
    const candidates = new Set(), markedStreams = new Map(), uncertain = new Set(), decoder = new TextDecoder('latin1');
    const pages = document.getPages();
    if (expectedPages !== undefined && pages.length !== expectedPages) return null;
    for (let index = 0; index < pages.length; index++) {
      try {
        const contents = pages[index].node.Contents();
        const streams = contents instanceof PDFArray
          ? Array.from({length:contents.size()}, (_,i) => contents.lookup(i))
          : contents ? [contents] : [];
        let tail = '', remaining = maxDecodedBytes;
        for (const stream of streams) {
          if (!(stream instanceof PDFRawStream)) { candidates.add(index); uncertain.add(index); break; }
          const decoded = await readContent(stream, pdfLib, remaining);
          if (!decoded) { candidates.add(index); uncertain.add(index); break; }
          remaining -= decoded.length;
          const text = (tail + decoder.decode(decoded)).replace(/#([0-9a-f]{2})/gi,
            (_,hex) => String.fromCharCode(parseInt(hex,16)));
          if (text.includes('/SolTx') || text.includes('/SolInk')) {
            candidates.add(index);
            const entries = markedStreams.get(index) || [];
            entries.push({stream, text:decoder.decode(decoded)}); markedStreams.set(index, entries);
          }
          tail = text.slice(-32);
        }
      } catch { candidates.add(index); uncertain.add(index); }
      if (index % 4 === 3) await yieldControl();
    }
    for (const index of uncertain) markedStreams.delete(index);
    return {document, candidates, markedStreams};
  } catch { return null; }  
}

export async function findMarkedPageCandidates(bytes, pdfLib, options) {
  return (await inspectMarkedPages(bytes, pdfLib, options))?.candidates ?? null;
}

function ownedStreamObjects(text) {
  let at=0; const objects=[];
  function space() {
    while(at<text.length) {
      if (/[\x00\t\n\f\r ]/.test(text[at])) {at++;continue;}
      if(text[at]==='%') {while(at<text.length && !/[\r\n]/.test(text[at]))at++;continue;}
      break;
    }
  }
  function token() {
    space(); const start=at, ch=text[at++];
    if(ch==='(') {
      let depth=1;
      while(at<text.length && depth) {
        const c=text[at++]; if(c==='\\') {at++;continue;}
        if(c==='(')depth++;else if(c===')')depth--;
      }
      if(depth)throw Error('Unclosed string'); return 'string';
    }
    if(ch==='<') {
      if(text[at]==='<') {at++;return '<<';}
      const end=text.indexOf('>',at); if(end<0)throw Error('Unclosed hex');at=end+1;return 'string';
    }
    if('[]>'.includes(ch))return ch;
    while(at<text.length && !/[\x00\t\n\f\r ()<>[\]{}/%]/.test(text[at]))at++;
    return text.slice(start,at);
  }
  while(true) {
    space(); if(at===text.length)return objects.length ? objects : null;
    const header=/^\/Sol(?:Tx|Ink)\s*<<\s*\/T\s*<([0-9a-fA-F\s]+)>\s*>>\s*BDC\b/.exec(text.slice(at));
    if(!header)return null;
    const hex=header[1].replace(/\s/g,''); if(hex.length%2)return null;
    const bytes=Uint8Array.from(hex.match(/../g)||[],h=>parseInt(h,16));
    if(bytes.some(b=>b>127))return null;
    const json=new TextDecoder().decode(bytes), object=JSON.parse(json);
    if(!object || typeof object!=='object' || Array.isArray(object))return null;
    at+=header[0].length;
    if(token()!=='q')return null;
    let graphics=1;
    while(at<text.length && graphics) {
      const word=token();
      if(word==='BI' || word==='BDC' || word==='BMC' || word==='EMC')return null;
      if(word==='q')graphics++;else if(word==='Q')graphics--;
    }
    if(graphics || token()!=='EMC')return null;
    objects.push({json,object});
  }
}

export async function prepareMarkedRestoration(bytes, pdfLib, sanitize, options) {
  const inspected=await inspectMarkedPages(bytes,pdfLib,options);
  if(!inspected)return {candidates:null,restored:null};
  const {document,candidates,markedStreams}=inspected;
  try {
    if(!candidates.size)return {candidates,restored:null};
    const pageTexts=[], replacements=[];
    for(const index of candidates) {
      const entries=markedStreams.get(index);
      if(!entries?.length)throw Error('Unknown content stream');
      const objects=[],seen=new Set();
      for(const entry of entries) {
        if(entry.text.length>256*1024)throw Error('Large marked stream');
        const values=ownedStreamObjects(entry.text);
        if(!values)throw Error('Noncanonical marked content');
        for(const {json,object} of values) {
          if(seen.has(json))continue;
          delete object._m;
          const clean=sanitize(object); if(!clean)throw Error('Unsupported object');
          seen.add(json);objects.push(clean);
        }
      }
      const removed=new Set(entries.map(e=>e.stream)), page=document.getPages()[index];
      const contents=page.node.Contents();
      const kept=contents instanceof pdfLib.PDFArray
        ? Array.from({length:contents.size()},(_,i)=>({ref:contents.get(i),stream:contents.lookup(i)}))
          .filter(e=>!removed.has(e.stream)).map(e=>e.ref)
        : [];
      replacements.push({page,kept});pageTexts[index]=objects;
    }
    for(const {page,kept} of replacements)page.node.set(pdfLib.PDFName.of('Contents'),document.context.obj(kept));
    return {candidates,restored:{bytes:await document.save({objectsPerTick:1500}),pageTexts}};
  } catch { return {candidates,restored:null}; }
}

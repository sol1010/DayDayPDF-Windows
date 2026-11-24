const MAGIC = new Uint8Array([0x50, 0x44, 0x46, 0x43, 0x4c, 0x49, 0x50, 0x31]);  
const HEADER_LIMIT = 64 * 1024 * 1024;

export const CLIPBOARD_SERIALIZE_WORKER_SOURCE = String.raw`
let pdfLibReady = null;

async function ensurePdfLib(url) {
  if (!pdfLibReady) {
    pdfLibReady = (async () => {
      importScripts(url);
      if (!self.PDFLib || !self.PDFLib.PDFDocument) throw new Error('PDF clipboard engine unavailable');
      return self.PDFLib;
    })();
  }
  return pdfLibReady;
}

self.onmessage = async event => {
  const message = event.data;
  if (!message || message.type !== 'serialize') return;
  try {
    const library = await ensurePdfLib(message.pdfLibUrl);
    const output = await library.PDFDocument.create();
    const loaded = new Map();
    const mapping = {};
    for (let index = 0; index < message.references.length; index++) {
      const reference = message.references[index];
      let source = loaded.get(reference.sourceKey);
      if (!source) {
        const sourceBytes = message.sources.find(item => item.key === reference.sourceKey)?.bytes;
        if (!sourceBytes) throw new Error('clipboard source bytes missing');
        source = await library.PDFDocument.load(sourceBytes, { ignoreEncryption: true });
        loaded.set(reference.sourceKey, source);
      }
      const [page] = await output.copyPages(source, [reference.pageIndex]);
      output.addPage(page);
      mapping[reference.key] = output.getPageCount() - 1;
      if ((index & 3) === 3) self.postMessage({ type: 'progress', requestId: message.requestId, done: index + 1 });
    }
    const pdfBytes = await output.save({ useObjectStreams: false });
    const headerBytes = new TextEncoder().encode(JSON.stringify({
      version: 1, pages: message.pages, mapping,
    }));
    const magic = new Uint8Array([0x50, 0x44, 0x46, 0x43, 0x4c, 0x49, 0x50, 0x31]);
    const packet = new Uint8Array(magic.byteLength + 4 + headerBytes.byteLength + pdfBytes.byteLength);
    packet.set(magic, 0);
    new DataView(packet.buffer).setUint32(magic.byteLength, headerBytes.byteLength, true);
    packet.set(headerBytes, magic.byteLength + 4);
    packet.set(pdfBytes, magic.byteLength + 4 + headerBytes.byteLength);
    self.postMessage({
      type: 'serialized',
      requestId: message.requestId,
      packet: packet.buffer,
    }, [packet.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', requestId: message.requestId, error: String(error && error.message || error) });
  }
};
`;

export function packShellClipboardPayload({ pages, mapping, pdfBytes }) {
  const pdf = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes || 0);
  const headerBytes = new TextEncoder().encode(JSON.stringify({ version: 1, pages, mapping }));
  if (headerBytes.byteLength > HEADER_LIMIT) throw new Error('클립보드 메타데이터가 너무 큽니다');
  const output = new Uint8Array(MAGIC.byteLength + 4 + headerBytes.byteLength + pdf.byteLength);
  output.set(MAGIC, 0);
  new DataView(output.buffer).setUint32(MAGIC.byteLength, headerBytes.byteLength, true);
  output.set(headerBytes, MAGIC.byteLength + 4);
  output.set(pdf, MAGIC.byteLength + 4 + headerBytes.byteLength);
  return output;
}

export function unpackShellClipboardPayload(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < MAGIC.byteLength + 4) throw new Error('클립보드 데이터가 잘렸습니다');
  for (let index = 0; index < MAGIC.byteLength; index++) {
    if (bytes[index] !== MAGIC[index]) throw new Error('지원하지 않는 클립보드 데이터입니다');
  }
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint32(MAGIC.byteLength, true);
  if (headerLength > HEADER_LIMIT || MAGIC.byteLength + 4 + headerLength > bytes.byteLength)
    throw new Error('클립보드 메타데이터 크기가 올바르지 않습니다');
  const headerStart = MAGIC.byteLength + 4;
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(headerStart, headerStart + headerLength)));
  if (header?.version !== 1 || !Array.isArray(header.pages) || !header.mapping)
    throw new Error('지원하지 않는 클립보드 버전입니다');
  return {
    pages: header.pages,
    mapping: header.mapping,
    pdfBytes: bytes.slice(headerStart + headerLength),
  };
}

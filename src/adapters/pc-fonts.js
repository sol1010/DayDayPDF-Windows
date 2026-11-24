export async function readPcFonts(base, fetchFn) {
  if (!base) return [];
  try {
    const response = await fetchFn(base + 'catalog', { credentials: 'omit', cache: 'no-store' });
    const faces = response.ok ? await response.json() : null;
    return Array.isArray(faces) ? faces : [];
  } catch { return []; }
}

export function pcWritingFonts(faces) {
  const families = new Map();
  for (const face of faces) {
    if (face.italic || !/^(Editable|Installable)(ButNoSubsetting)?$/.test(face.rights)) continue;
    if (!families.has(face.name)) families.set(face.name, []);
    families.get(face.name).push(face);
  }
  return Array.from(families, ([name, group]) => {
    const closest = weight => group.reduce((best, f) =>
      Math.abs(f.stretch - 5) * 1000 + Math.abs(f.weight - weight) <
      Math.abs(best.stretch - 5) * 1000 + Math.abs(best.weight - weight) ? f : best);
    const regular = closest(400), bold = closest(700);
    return { key: 'pc:' + encodeURIComponent(name) + '.', label: regular.label, aliases: regular.aliases,
      source: 'installed', language: 'pc', category: 'pc', supportsKo: regular.ko,
      regular, boldFace: bold, systemName: name };
  });
}

export function sfntFace(bytes, index = 0, metadataSource = null) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const collection = view.getUint32(0) === 0x74746366;
  if (!collection && !metadataSource) return bytes;
  if (collection && (index < 0 || index >= view.getUint32(8))) throw new Error('Unknown collection face');
  const offset = collection ? view.getUint32(12 + index * 4) : 0;
  const tables = new Map();
  function readTables(input, start, metadataOnly) {
    const dir = new DataView(input.buffer, input.byteOffset, input.byteLength);
    for (let i = 0; i < dir.getUint16(start + 4); i++) {
      const p = start + 12 + 16 * i, tag = dir.getUint32(p);
      if (metadataOnly && tag !== 0x4f532f32 && tag !== 0x6e616d65) continue;  
      const from = dir.getUint32(p + 8), size = dir.getUint32(p + 12);
      if (from + size > input.length) throw new Error('Invalid font table');
      tables.set(tag, { checksum: dir.getUint32(p + 4), bytes: input.subarray(from, from + size) });
    }
  }
  readTables(bytes, offset, false);
  if (metadataSource) readTables(metadataSource, 0, true);
  const count = tables.size, power = 2 ** Math.floor(Math.log2(count));
  const header = 12 + count * 16;
  let length = header;
  for (const table of tables.values()) length += Math.ceil(table.bytes.length / 4) * 4;
  const result = new Uint8Array(length), out = new DataView(result.buffer);
  out.setUint32(0, view.getUint32(offset));
  out.setUint16(4, count); out.setUint16(6, power * 16);
  out.setUint16(8, Math.log2(power)); out.setUint16(10, (count - power) * 16);
  let pos = header, entry = 12, head = 0;
  for (const tag of [...tables.keys()].sort((a, b) => a - b)) {
    const table = tables.get(tag);
    out.setUint32(entry, tag);
    out.setUint32(entry + 4, table.checksum);
    out.setUint32(entry + 8, pos);
    out.setUint32(entry + 12, table.bytes.length);
    result.set(table.bytes, pos);
    if (tag === 0x68656164) head = pos;
    pos += Math.ceil(table.bytes.length / 4) * 4;
    entry += 16;
  }
  if (head) {
    out.setUint32(head + 8, 0);
    let sum = 0;
    for (let i = 0; i < result.length; i += 4) sum = (sum + out.getUint32(i)) >>> 0;
    out.setUint32(head + 8, (0xb1b0afba - sum) >>> 0);
  }
  return result;
}

export async function retainPcFontMetadata(doc, font, record, pdfLib) {
  await font.embed();
  const name = pdfLib.PDFName.of;
  const cid = doc.context.lookup(font.ref).lookup(name('DescendantFonts')).lookup(0);
  const descriptor = cid.lookup(name('FontDescriptor'));
  if (record.embedSubset) {
    const ref = descriptor.get(name('FontFile2'));
    const subset = pdfLib.decodePDFRawStream(doc.context.lookup(ref)).getBytes();
    const withMetadata = sfntFace(subset, 0, record.bytes);
    doc.context.assign(ref, doc.context.flateStream(withMetadata, { Length1: withMetadata.length }));
  } else if (record.openTypeCff) {
    descriptor.lookup(name('FontFile3')).dict.set(name('Subtype'), name('OpenType'));
  }
}

export function embeddingFlags(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4);
  for (let i = 0; i < count; i++) {
    const p = 12 + i * 16;
    if (view.getUint32(p) === 0x4f532f32) return view.getUint16(view.getUint32(p + 8) + 8);
  }
  return null;
}

export function installPcFontMapper(lib, faces, loadFace) {
  const m = lib.pdfium;
  const normalize = name => String(name).normalize('NFKC').replace(/^[A-Z]{6}\+/, '')
    .replace(/[\s,_-]/g, '').toLowerCase();
  const families = new Map(), handles = new Map(), data = new Map();
  for (const face of faces) {
    for (const alias of new Set([face.name, ...face.aliases].map(normalize))) {
      if (!families.has(alias)) families.set(alias, []);
      families.get(alias).push(face);
    }
  }
  const fallback = [400, 700].map(weight => ({ name: 'NanumGothic', weight, fallback: true }));
  function getHandle(face) {
    if (!face) return 0;
    if (handles.has(face)) return handles.get(face);
    let handle = 0;
    try {
      const bytes = loadFace(face);
      if (bytes?.length) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const tables = new Map([[0, bytes]]);
        for (let i = 0; i < view.getUint16(4); i++) {
          const offset = 12 + i * 16, begin = view.getUint32(offset + 8);
          tables.set(view.getUint32(offset), bytes.subarray(begin, begin + view.getUint32(offset + 12)));
        }
        handle = data.size + 1;
        data.set(handle, { tables, name: new TextEncoder().encode(face.name + '\0') });
      }
    } catch {   }
    handles.set(face, handle);
    return handle;
  }
  function map(weight, italic, charset, name) {
    const key = normalize(name);
    const family = families.get(key) || families.get(key.replace(/(?:bolditalic|boldmt|italicmt|regular|bold|italic|psmt|mt)$/, ''));
    if (family) {
      const score = f => (Number(f.italic) !== Number(!!italic) ? 10000 : 0) +
        Math.abs(f.stretch - 5) * 1000 + Math.abs(f.weight - weight);
      const handle = getHandle(family.reduce((a, b) => score(a) <= score(b) ? a : b));
      if (handle) return handle;
    }
    return charset === 129 || /malgungothic|맑은고딕/.test(key) ? getHandle(fallback[Number(weight >= 600)]) : 0;
  }
  function copy(bytes, address, capacity) {
    if (!bytes) return 0;
    if (address && capacity >= bytes.length) m.HEAPU8.set(bytes, address);
    return bytes.length;
  }
  const cb = (sig, body) => m.addFunction(body, sig);
  const entries = [1, 0, 0,
    cb('iiiiiiii', (_, weight, italic, charset, pitch, name) => map(weight, italic, charset, m.UTF8ToString(name))),
    cb('iii', (_, name) => map(400, false, 0, m.UTF8ToString(name))),
    cb('iiiiii', (_, id, tag, ptr, size) => copy(data.get(id)?.tables.get(tag >>> 0), ptr, size)),
    cb('iiiii', (_, id, ptr, size) => copy(data.get(id)?.name, ptr, size)), 0, cb('vii', () => {})];
  const info = m.wasmExports.malloc(entries.length * 4);
  new Uint32Array(m.HEAPU8.buffer, info, entries.length).set(entries);
  lib.FPDF_SetSystemFontInfo(info);
}

export function pcFontWorkerSource(source, faces, base, bundled) {
  if (!base) return source;
  return 'const configurePcFonts = lib => (' + installPcFontMapper.toString() + ')(lib,' +
    JSON.stringify(faces) + ',face => {' +
    'const xhr = new XMLHttpRequest(); xhr.open("GET",face.fallback ? ' + JSON.stringify(bundled) +
    '+(face.weight >= 600 ? "NanumGothic-Bold.ttf" : "NanumGothic-Regular.ttf") : ' + JSON.stringify(base) +
    '+face.id,false);  ' +
    'xhr.responseType="arraybuffer"; xhr.send(); if(xhr.status!==200) return null;return (' +
    sfntFace.toString() + ')(new Uint8Array(xhr.response), face.index || 0);});\n' + source;
}

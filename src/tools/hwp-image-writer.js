import { deflateSync } from 'fflate';
import { createCompoundFile } from './compound-file-writer.js';

export const HANCOM_HWP_NOTICE = '본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.';
export const HWP_IMAGE_LIMITS = Object.freeze({ pages: 100, imageBytes: 120 * 1024 * 1024, maxPagePoints: 2834 });

function data(size, fill) {
  const bytes = new Uint8Array(size);
  fill?.(new DataView(bytes.buffer), bytes);
  return bytes;
}
function join(parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
const u16 = value => data(2, view => view.setUint16(0, value, true));
const u32 = value => data(4, view => view.setUint32(0, value, true));
const utf16 = text => data(text.length * 2, view => {
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
});
const string = text => join([u16(text.length), utf16(text)]);
const fourCC = text => Uint8Array.from([...text].reverse().map(char => char.charCodeAt(0)));
const record = (tag, level, payload) => join([
  u32(tag | (level << 10) | (Math.min(4095, payload.length) << 20)),
  ...(payload.length >= 4095 ? [u32(payload.length)] : []), payload,
]);
const controlChar = (code, id) => join([u16(code), fourCC(id), data(8), u16(code)]);

function docInfo(pages) {
  const properties = data(26, view => {
    view.setUint16(0, pages.length, true);
    for (let i = 2; i < 14; i += 2) view.setUint16(i, 1, true);
  });
  const counts = [pages.length, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0];
  const faceName = join([data(1), string('Arial')]);
  const charShape = data(74, (view, bytes) => {
    bytes.fill(100, 14, 21); bytes.fill(100, 28, 35);
    view.setInt32(42, 100, true);  
    view.setUint32(60, 0xffffffff, true);
    view.setUint16(68, 1, true);
  });
  const paraShape = data(54, view => {
    view.setUint32(0, 4, true);  
    view.setInt32(24, 100, true);
    view.setUint16(32, 1, true);
    view.setUint32(50, 100, true);
  });
  const style = join([string('Normal'), string('Normal'), data(2), u16(0x0412), u16(0), u16(0), u16(0)]);
  return join([
    record(16, 0, properties), record(17, 0, join(counts.map(u32))),
    ...pages.map((page, index) => record(18, 1, join([u16(0x0011), u16(index + 1), string(page.extension)]))),
    ...Array.from({ length: 7 }, () => record(19, 1, faceName)),
    record(20, 1, data(40)),  
    record(21, 1, charShape), record(22, 1, data(8)),
    record(25, 1, paraShape), record(26, 1, style),
  ]);
}

function section(page, index) {
  const width = Math.round(page.width * 100);
  const height = Math.round(page.height * 100);
  const nativeWidth = page.pixelWidth * 75;
  const nativeHeight = page.pixelHeight * 75;
  const instance = index + 1;
  const header = data(24, (view, bytes) => {
    view.setUint32(0, 0x80000019, true);  
    view.setUint32(4, (1 << 2) | (1 << 11), true);
    bytes[11] = 3;  
    view.setUint16(12, 1, true); view.setUint16(16, 1, true);
    view.setUint32(18, instance, true);
  });
  const text = join([controlChar(2, 'secd'), controlChar(2, 'cold'), controlChar(11, 'gso '), u16(13)]);
  const line = join([0, 0, 100, 100, 85, 0, 0, width, 0x60000].map(u32));
  const sectionDef = join([fourCC('secd'), data(26, view => view.setUint32(10, 8000, true))]);
  const pageDef = join([width, height, 0, 0, 0, 0, 0, 0, 0, 0].map(u32));
  const footnote = data(28, view => view.setUint16(10, 1, true));
  const border = data(14, view => view.setUint16(12, 1, true));
  const columnDef = join([fourCC('cold'), u16(0x1004), data(10)]);
  const object = join([fourCC('gso '), data(40, view => {
    view.setUint32(0, (4 << 15) | (2 << 18) | (5 << 21), true);
    view.setUint32(12, width, true); view.setUint32(16, height, true);
    view.setUint32(20, 1, true); view.setUint32(32, instance, true);
  }), string(`PDF page ${index + 1}`)]);
  const shape = join([fourCC('$pic'), fourCC('$pic'), data(188, view => {
    view.setUint16(10, 1, true);
    for (const [offset, value] of [[12, width], [16, height], [20, width], [24, height]]) view.setUint32(offset, value, true);
    view.setUint16(42, 1, true);
    for (let matrix = 0; matrix < 3; matrix++) {
      view.setFloat64(44 + matrix * 48, 1, true);
      view.setFloat64(44 + matrix * 48 + 32, 1, true);
    }
  })]);
  const picture = data(91, view => {
    [0, 0, width, 0, width, height, 0, height].forEach((value, i) => view.setInt32(12 + i * 4, value, true));
    view.setInt32(52, nativeWidth, true); view.setInt32(56, nativeHeight, true);
    view.setUint16(71, instance, true);
    view.setUint32(74, instance, true);
    view.setUint32(82, nativeWidth, true); view.setUint32(86, nativeHeight, true);
  });
  return join([
    record(66, 0, header), record(67, 1, text), record(68, 1, data(8)), record(69, 1, line),
    record(71, 1, sectionDef), record(73, 2, pageDef),
    record(74, 2, footnote), record(74, 2, footnote),
    record(75, 2, border), record(75, 2, border), record(75, 2, border),
    record(71, 1, columnDef), record(71, 1, object),
    record(76, 2, shape), record(85, 3, picture),
  ]);
}

export function createImageHwp(pages) {
  if (!Array.isArray(pages) || !pages.length || pages.length > HWP_IMAGE_LIMITS.pages) {
    throw new Error(`1~${HWP_IMAGE_LIMITS.pages}페이지 PDF를 선택하세요.`);
  }
  let total = 0;
  for (const page of pages) {
    if (![page.width, page.height].every(value => Number.isFinite(value) && value >= 1 && value <= HWP_IMAGE_LIMITS.maxPagePoints)) {
      throw new Error('HWP로 저장할 수 없는 용지 크기입니다. 최대 한 변 1m까지 지원합니다.');
    }
    if (![page.pixelWidth, page.pixelHeight].every(value => Number.isInteger(value) && value > 0 && value <= 12000)
      || !(page.image instanceof Uint8Array) || !['jpg', 'png'].includes(page.extension)) throw new Error('페이지 이미지 정보가 올바르지 않습니다.');
    const magic = page.image;
    if (page.extension === 'jpg' ? !(magic[0] === 255 && magic[1] === 216 && magic[2] === 255)
      : ![137,80,78,71,13,10,26,10].every((value, index) => magic[index] === value)) throw new Error('페이지 이미지 형식이 올바르지 않습니다.');
    total += page.image.length;
    if (total > HWP_IMAGE_LIMITS.imageBytes) throw new Error('페이지 이미지 용량이 120MB를 넘었습니다. PDF를 나누거나 화질을 낮춰 변환하세요.');
  }
  const fileHeader = data(256, (view, bytes) => {
    bytes.set(new TextEncoder().encode('HWP Document File'));
    view.setUint32(32, 0x05000302, true);  
    view.setUint32(36, 1, true);  
  });
  const streams = { FileHeader: fileHeader, DocInfo: deflateSync(docInfo(pages)), PrvText: utf16('DaydayPDF - PDF pages as images') };
  pages.forEach((page, index) => {
    streams[`BodyText/Section${index}`] = deflateSync(section(page, index));
    const id = (index + 1).toString(16).toUpperCase().padStart(4, '0');
    streams[`BinData/BIN${id}.${page.extension}`] = deflateSync(page.image, { level: 1 });
  });
  return createCompoundFile(streams);
}

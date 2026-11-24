import { strFromU8, unzipSync } from 'fflate';

export const DOCUMENT_INPUTS = Object.freeze(['.xlsx', '.docx', '.pptx', '.hwpx']);
const MAX_FILE = 30 * 1024 * 1024;
const MAX_EXPANDED = 100 * 1024 * 1024;
const all = (node, name) => [...node?.getElementsByTagNameNS('*', name) || []];
const first = (node, name) => all(node, name)[0];
const children = (node, name) => [...node?.children || []].filter(n => n.localName === name);
const attr = (node, name, fallback = '') => [...node?.attributes || []].find(a => a.localName === name)?.value ?? fallback;
const number = (node, name, fallback = 0) => Number(attr(node, name, fallback));
const text = node => node?.textContent || '';
const hex = value => /^[\da-f]{6}$/i.test(value) ? value : null;

export function openDocumentPackage(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_FILE) throw new Error('문서는 30MB 이하만 지원합니다.');
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('암호가 있거나 지원하지 않는 문서입니다. DOCX·XLSX·PPTX·HWPX 파일을 선택하세요.');
  let total = 0;
  let count = 0;
  return unzipSync(bytes, { filter(entry) {
    total += entry.originalSize;
    count++;
    if (count > 5000 || total > MAX_EXPANDED || entry.originalSize > 30 * 1024 * 1024) throw new Error('압축을 푼 문서가 너무 큽니다. 문서를 나눠서 변환하세요.');
    if (/\\|(^|\/)\.\.(\/|$)|^\//.test(entry.name)) throw new Error('문서 내부 경로가 올바르지 않습니다.');
    return true;
  } });
}

export function resolveDocumentPart(base, target) {
  if (!target || /[\\?#]|^[a-z][a-z\d+.-]*:|^\/\//i.test(target)) return null;
  const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/');
}

export function parseOfficeDocument(bytes, name, { DOMParserClass = globalThis.DOMParser } = {}) {
  const extension = String(name).toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!DOCUMENT_INPUTS.includes(extension)) throw new Error('DOCX·XLSX·PPTX·HWPX만 지원합니다. HWP·DOC·XLS·PPT는 새 문서 형식으로 저장한 뒤 선택하세요.');
  const files = openDocumentPackage(bytes);
  const warnings = new Set();
  const warn = message => warnings.add(message);
  const xml = (path, required = true) => {
    if (!files[path]) { if (!required) return null; throw new Error(`문서 구성 파일이 없습니다: ${path}`); }
    const source = strFromU8(files[path]);
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('지원하지 않는 XML 선언이 포함되어 있습니다.');
    const doc = new DOMParserClass().parseFromString(source, 'application/xml');
    if (all(doc, 'parsererror').length) throw new Error('문서 XML이 손상되었습니다.');
    return doc;
  };
  const relationships = path => {
    const split = path.lastIndexOf('/');
    const rel = xml(`${path.slice(0, split + 1)}_rels/${path.slice(split + 1)}.rels`, false);
    return new Map(all(rel, 'Relationship').map(node => [attr(node, 'Id'),
      attr(node, 'TargetMode') === 'External' ? null : resolveDocumentPart(path, attr(node, 'Target'))]));
  };
  const image = (path, extra = {}) => {
    const data = files[path];
    if (!data || !/\.(png|jpe?g)$/i.test(path || '')) { warn('일부 그림은 지원하지 않는 형식이거나 외부 연결이므로 포함되지 않습니다.'); return null; }
    return { kind: 'image', bytes: data, ...extra };
  };
  const model = { format: extension.slice(1), sections: [], warnings: [] };

  if (extension === '.docx') {
    const part = 'word/document.xml';
    const doc = xml(part);
    const rels = relationships(part);
    const section = first(doc, 'sectPr');
    const pageSize = first(section, 'pgSz');
    const margins = first(section, 'pgMar');
    const blocks = [];
    const plain = node => all(node, 't').map(text).join('');
    function paragraph(node) {
      const content = [];
      for (const child of [...node.childNodes || []]) {
        if (child.nodeType !== 1) continue;
        if (child.localName === 't') content.push(text(child));
        else if (child.localName === 'tab') content.push('    ');
        else if (child.localName === 'br') content.push(attr(child, 'type') === 'page' ? '\f' : '\n');
        else if (!['drawing', 'pict', 'del', 'instrText'].includes(child.localName)) content.push(paragraph(child));
      }
      return content.join('');
    }
    function addParagraph(p) {
      const props = first(p, 'pPr');
      if (first(props, 'pageBreakBefore') && blocks.length) blocks.push({ kind: 'break' });
      const runs = children(p, 'r');
      const size = number(first(runs[0], 'sz'), 'val', 22) / 2;
      const color = hex(attr(first(runs[0], 'color'), 'val'));
      const align = attr(first(props, 'jc'), 'val');
      const segments = paragraph(p).split('\f');
      segments.forEach((value, index) => {
        if (index) blocks.push({ kind: 'break' });
        blocks.push({ kind: 'text', text: value, size, color, align });
      });
      for (const drawing of all(p, 'drawing')) {
        const blip = first(drawing, 'blip');
        const extent = first(drawing, 'extent');
        const picture = image(rels.get(attr(blip, 'embed')), {
          width: number(extent, 'cx') / 12700, height: number(extent, 'cy') / 12700,
        });
        if (picture) blocks.push(picture);
      }
    }
    for (const node of [...first(doc, 'body')?.children || []]) {
      if (node.localName === 'p') addParagraph(node);
      else if (node.localName === 'tbl') {
        blocks.push({ kind: 'table', widths: all(first(node, 'tblGrid'), 'gridCol').map(n => number(n, 'w') / 20),
          rows: children(node, 'tr').map(row => children(row, 'tc').map(cell => ({
            text: children(cell, 'p').map(paragraph).join('\n'),
            span: Math.max(1, number(first(cell, 'gridSpan'), 'val', 1)),
            fill: hex(attr(first(cell, 'shd'), 'fill')),
          }))),
        });
        if (all(node, 'drawing').length || all(node, 'vMerge').length) warn('표 안의 그림과 세로 병합은 정확히 재현되지 않습니다.');
      } else if (node.localName !== 'sectPr') {
        for (const p of all(node, 'p')) addParagraph(p);
      }
    }
    if (all(doc, 'altChunk').length) throw new Error('외부 본문이 삽입된 Word 문서는 지원하지 않습니다. Word에서 DOCX로 다시 저장하세요.');
    if (all(doc, 'sectPr').length > 1 || all(doc, 'headerReference').length || all(doc, 'footerReference').length || all(doc, 'numPr').length) warn('구역별 서식·머리말·꼬리말·자동 번호는 원본과 다를 수 있습니다.');
    if (!plain(doc).trim() && !blocks.some(b => b.kind === 'image')) throw new Error('변환할 본문이 없습니다.');
    model.sections.push({ name: 'Word', width: number(pageSize, 'w', 11906) / 20, height: number(pageSize, 'h', 16838) / 20,
      margin: Math.min(100, Math.max(24, number(margins, 'left', 1000) / 20)), blocks });
  }

  if (extension === '.xlsx') {
    const workbook = xml('xl/workbook.xml');
    const rels = relationships('xl/workbook.xml');
    const shared = all(xml('xl/sharedStrings.xml', false), 'si').map(si => all(si, 't').map(text).join(''));
    const styles = xml('xl/styles.xml', false);
    const xfs = children(first(styles, 'cellXfs'), 'xf');
    const fonts = children(first(styles, 'fonts'), 'font');
    const fills = children(first(styles, 'fills'), 'fill');
    const formats = new Map(all(styles, 'numFmt').map(n => [number(n, 'numFmtId'), attr(n, 'formatCode')]));
    const date1904 = attr(first(workbook, 'workbookPr'), 'date1904') === '1';
    let cellsRead = 0;
    for (const sheet of all(workbook, 'sheet')) {
      if (['hidden', 'veryHidden'].includes(attr(sheet, 'state'))) continue;
      const part = rels.get(attr(sheet, 'id'));
      const doc = xml(part);
      const data = first(doc, 'sheetData');
      const name = attr(sheet, 'name');
      const entries = [];
      let maxCol = 0;
      for (const row of children(data, 'row')) {
        if (attr(row, 'hidden') === '1') continue;
        const cells = [];
        for (const cell of children(row, 'c')) {
          if (++cellsRead > 30000) throw new Error('셀은 문서당 30,000개까지 변환할 수 있습니다.');
          const position = parseCellAddress(attr(cell, 'r'));
          if (!position || position.col > 199) throw new Error('200열을 넘는 시트는 지원하지 않습니다.');
          const valueNode = first(cell, 'v');
          if (first(cell, 'f') && (!valueNode || text(valueNode) === '' && attr(cell, 't') !== 'str')) throw new Error('계산 결과가 저장되지 않은 수식이 있습니다. Excel에서 계산 후 저장한 파일을 선택하세요.');
          const type = attr(cell, 't');
          const value = text(valueNode);
          const style = xfs[number(cell, 's')];
          const fmt = number(style, 'numFmtId');
          let output = type === 's' ? shared[Number(value)] : type === 'inlineStr' ? all(cell, 't').map(text).join('') : type === 'b' ? (value === '1' ? 'TRUE' : 'FALSE') : value;
          if (!type || type === 'n') output = formatSpreadsheetNumber(value, fmt, formats.get(fmt), date1904);
          cells[position.col] = { text: output ?? '', color: hex(attr(first(fonts[number(style, 'fontId')], 'color'), 'rgb').slice(-6)),
            fill: hex(attr(first(fills[number(style, 'fillId')], 'fgColor'), 'rgb').slice(-6)),
            align: attr(first(style, 'alignment'), 'horizontal', !type || type === 'n' ? 'right' : 'left'),
          };
          maxCol = Math.max(maxCol, position.col);
        }
        if (cells.length) entries.push({ index: number(row, 'r'), cells });
      }
      if (!entries.length) continue;
      const widths = Array(maxCol + 1).fill(70);
      const hidden = new Set();
      for (const col of all(doc, 'col')) for (let index = Math.max(0, number(col, 'min', 1) - 1); index < Math.min(widths.length, number(col, 'max')); index++) {
        widths[index] = Math.max(20, Math.min(400, number(col, 'width', 10) * 5.25));
        if (attr(col, 'hidden') === '1') hidden.add(index);
      }
      const merges = all(doc, 'mergeCell').map(m => attr(m, 'ref').split(':').map(parseCellAddress));
      for (const [start, end] of merges) {
        if (!start || !end) continue;
        if (start.row !== end.row) warn('Excel의 세로 병합 셀은 첫 번째 행에 표시합니다.');
        const entry = entries.find(row => row.index === start.row);
        if (entry?.cells[start.col]) entry.cells[start.col].span = Math.min(maxCol, end.col) - start.col + 1;
      }
      const visible = widths.map((_, i) => i).filter(i => !hidden.has(i));
      if (!visible.length) continue;
      if (visible.length > 40) throw new Error('한 시트에서 표시되는 열은 40개까지 지원합니다. 필요한 열만 남긴 사본으로 변환하세요.');
      const rows = entries.map(entry => {
        const row = [];
        for (let i = 0; i < visible.length; i++) {
          const col = visible[i];
          const cell = { ...entry.cells[col], text: entry.cells[col]?.text || '' };
          const end = col + (cell.span || 1);
          cell.span = 1;
          while (i + 1 < visible.length && visible[i + 1] < end) { cell.span++; i++; }
          row.push(cell);
        }
        return row;
      });
      if (all(doc, 'drawing').length || all(doc, 'legacyDrawing').length) warn('Excel의 차트·그림·도형은 포함되지 않습니다. 셀 내용과 표를 변환합니다.');
      if (all(doc, 'f').length) warn('Excel 수식은 파일에 저장된 계산 결과를 사용하며 다시 계산하지 않습니다.');
      model.sections.push({ name, width: visible.length > 6 ? 842 : 595, height: visible.length > 6 ? 595 : 842, margin: 30,
        blocks: [{ kind: 'text', text: name, size: 14 }, { kind: 'table', widths: visible.map(i => widths[i]), rows }] });
    }
  }

  if (extension === '.pptx') {
    const presentation = xml('ppt/presentation.xml');
    const rels = relationships('ppt/presentation.xml');
    const size = first(presentation, 'sldSz');
    const width = number(size, 'cx', 12192000) / 12700;
    const height = number(size, 'cy', 6858000) / 12700;
    let index = 0;
    for (const slide of all(presentation, 'sldId')) {
      const part = rels.get([...slide.attributes].find(a => a.localName === 'id' && a.namespaceURI)?.value);
      const doc = xml(part);
      const links = relationships(part);
      const blocks = [];
      const background = hex(attr(first(first(doc, 'bg'), 'srgbClr'), 'val'));
      for (const shape of [...first(doc, 'spTree')?.children || []]) {
        if (['nvGrpSpPr', 'grpSpPr'].includes(shape.localName)) continue;
        if (shape.localName === 'grpSp') { warn('PPT의 그룹 도형은 지원하지 않습니다. 그룹을 해제한 파일로 변환하세요.'); continue; }
        const transform = first(shape, 'xfrm');
        if (!transform) { warn('마스터에 배치된 PPT 요소는 일부 표시되지 않습니다.'); continue; }
        const offset = first(transform, 'off');
        const extent = first(transform, 'ext');
        const box = { x: number(offset, 'x') / 12700, y: number(offset, 'y') / 12700,
          width: number(extent, 'cx') / 12700, height: number(extent, 'cy') / 12700 };
        if (box.y >= height || box.x >= width) continue;
        if (shape.localName === 'pic') {
          const picture = image(links.get(attr(first(shape, 'blip'), 'embed')), box);
          if (picture) blocks.push(picture);
          if (first(shape, 'srcRect')) warn('PPT 그림 자르기와 회전은 원본과 다를 수 있습니다.');
        } else if (shape.localName === 'sp') {
          const props = children(shape, 'spPr')[0];
          const fill = hex(attr(first(children(props, 'solidFill')[0], 'srgbClr'), 'val'));
          if (fill) blocks.push({ kind: 'rect', fill, ...box });
          let y = box.y + 4;
          for (const p of all(first(shape, 'txBody'), 'p')) {
            const r = first(p, 'rPr') || first(p, 'defRPr');
            const size = Math.max(5, number(r, 'sz', 1800) / 100);
            const value = all(p, 't').map(text).join('');
            blocks.push({ kind: 'text', ...box, x: box.x + 5, y, width: Math.max(10, box.width - 10), text: value, size,
              color: hex(attr(first(r, 'srgbClr'), 'val')), align: ({ ctr: 'center', r: 'right' })[attr(first(p, 'pPr'), 'algn')] || 'left' });
            y += size * 1.4 * Math.max(1, Math.ceil(value.length * size * .6 / Math.max(10, box.width - 10)));
          }
        } else warn('PPT의 표·차트·SmartArt는 지원하지 않습니다.');
        if (number(transform, 'rot')) warn('회전한 PPT 요소의 배치는 원본과 다를 수 있습니다.');
      }
      model.sections.push({ name: `Slide ${++index}`, width, height, margin: 0, fixed: true, background, blocks });
    }
  }

  if (extension === '.hwpx') {
    const content = xml('Contents/content.hpf');
    const manifest = new Map(all(first(content, 'manifest'), 'item').map(n => [attr(n, 'id'), attr(n, 'href')]));
    const resolveHwpx = href => files[href] ? href : resolveDocumentPart('Contents/content.hpf', href);
    const sections = all(first(content, 'spine'), 'itemref').map(n => resolveHwpx(manifest.get(attr(n, 'idref')))).filter(p => /section[^/]*\.xml$/i.test(p || ''));
    if (!sections.length) throw new Error('한글 문서의 본문 순서 정보를 찾지 못했습니다.');
    for (const part of sections) {
      const doc = xml(part);
      const page = first(doc, 'pagePr');
      const blocks = [];
      const value = p => children(p, 'run').map(run => children(run, 't').map(text).join('')).join('');
      for (const p of children(doc.documentElement, 'p')) {
        if (attr(p, 'pageBreak') === '1') blocks.push({ kind: 'break' });
        blocks.push({ kind: 'text', text: value(p), size: 11 });
        for (const table of all(p, 'tbl')) blocks.push({ kind: 'table', rows: children(table, 'tr').map(row => children(row, 'tc').map(cell => ({
          text: all(cell, 'p').map(value).join('\n'), span: Math.max(1, number(first(cell, 'cellSpan'), 'colSpan', 1)),
        }))) });
        for (const pic of all(p, 'pic')) {
          const id = attr(first(pic, 'img'), 'binaryItemIDRef');
          const size = first(pic, 'sz');
          const picture = image(resolveHwpx(manifest.get(id)), { width: number(size, 'width') / 100, height: number(size, 'height') / 100 });
          if (picture) blocks.push(picture);
        }
      }
      model.sections.push({ name: 'HWPX', width: number(page, 'width', 59528) / 100, height: number(page, 'height', 84188) / 100, margin: 45, blocks });
    }
    warn('한글의 본문·기본 표·그림을 변환합니다. 원본 글꼴·세부 서식·떠 있는 개체 배치는 달라질 수 있습니다.');
  }
  if (!model.sections.length || !model.sections.some(s => s.blocks.some(b => b.kind === 'image' || b.kind === 'table' || b.text?.trim()))) throw new Error('변환할 내용이 없습니다.');
  if (model.sections.length > 300) throw new Error('문서는 300쪽 또는 300시트까지 지원합니다.');
  model.warnings = [...warnings];
  return model;
}

export function parseCellAddress(value) {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(value || '');
  if (!match) return null;
  let col = 0;
  for (const letter of match[1].toUpperCase()) col = col * 26 + letter.charCodeAt(0) - 64;
  return { col: col - 1, row: Number(match[2]) };
}

export function formatSpreadsheetNumber(value, id, custom = '', date1904 = false) {
  if (value === '' || !Number.isFinite(Number(value))) return value;
  const n = Number(value);
  if (id >= 14 && id <= 17 || /[yd]/i.test(custom.replace(/"[^"]*"|\[[^\]]*\]/g, ''))) {
    const epoch = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30);
    const date = new Date(epoch + (n + (!date1904 && n < 60 ? 1 : 0)) * 86400000);
    return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
  }
  if (id >= 18 && id <= 21) {
    const seconds = Math.round((n % 1) * 86400);
    const hours = Math.floor(seconds / 3600) % 24;
    const minutes = Math.floor(seconds / 60) % 60;
    return `${String(id < 20 ? hours % 12 || 12 : hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}${[19,21].includes(id) ? ':' + String(seconds % 60).padStart(2, '0') : ''}${id < 20 ? hours < 12 ? ' AM' : ' PM' : ''}`;
  }
  if (id === 9 || id === 10 || custom.includes('%')) return `${(n * 100).toFixed(id === 10 || /\.00/.test(custom) ? 2 : 0)}%`;
  const currency = custom.match(/[$€£₩¥]/)?.[0];
  if (currency) return currency + n.toLocaleString('en-US', { minimumFractionDigits: /\.00/.test(custom) ? 2 : 0, maximumFractionDigits: /\.00/.test(custom) ? 2 : 0 });
  if ([2, 4].includes(id) || /\.00/.test(custom)) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: id === 4 || custom.includes(',') });
  if (id === 3 || custom.includes('#,##0')) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return value;
}

import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const ink = value => {
  const hex = /^[a-f\d]{6}$/i.test(value || '') ? value : '202020';
  return rgb(...[0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255));
};
const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\t/g, '    ');
const bounded = (value, fallback, low, high) => Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;

export function wrapDocumentText(text, width, measure) {
  const lines = [];
  for (const paragraph of clean(text).split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      if (measure(line + word) <= width) { line += word; continue; }
      if (line) { lines.push(line.trimEnd()); line = ''; }
      for (const char of word.trimStart()) {
        if (line && measure(line + char) > width) { lines.push(line); line = ''; }
        line += char;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export async function createPdfFromDocument(model, { title = 'Document', fontBytes, report = () => {}, selectedSections } = {}) {
  if (!fontBytes) {
    const response = await fetch('/assets/ocr/SpoqaHanSansRegular.ttf');
    if (!response.ok) throw new Error('PDF 글꼴을 불러오지 못했습니다. 다시 시도하세요.');
    fontBytes = new Uint8Array(await response.arrayBuffer());
  }
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: false });
  const supported = new Set(font.getCharacterSet());
  const warnings = new Set(model.warnings);
  const sections = model.sections.filter((_, index) => !selectedSections || selectedSections.includes(index));
  if (!sections.length) throw new Error('변환할 시트를 선택하세요.');
  let glyphCount = 0;
  const safeText = value => {
    const text = clean(value);
    glyphCount += text.length;
    if (glyphCount > 1500000) throw new Error('문서의 텍스트가 너무 많습니다. 문서를 나눠서 변환하세요.');
    if ([...text].some(c => c !== '\n' && !supported.has(c.codePointAt(0)))) warnings.add('대체 글꼴에 없는 일부 문자는 □로 표시됩니다.');
    return [...text].map(c => c === '\n' || supported.has(c.codePointAt(0)) ? c : '□').join('');
  };
  let page;
  let width;
  let height;
  let margin;
  let y;
  const newPage = () => {
    if (pdf.getPageCount() >= 300) throw new Error('결과 PDF는 300쪽까지 지원합니다. 문서를 나눠서 변환하세요.');
    page = pdf.addPage([width, height]);
    y = margin;
  };
  const ensure = amount => { if (y + amount > height - margin && y > margin) newPage(); };
  const drawLine = (line, x, top, size, available, align, color) => {
    const measured = font.widthOfTextAtSize(line, size);
    const delta = align === 'center' ? Math.max(0, (available - measured) / 2) : align === 'right' ? Math.max(0, available - measured) : 0;
    if (line) page.drawText(line, { x: x + delta, y: height - top - size, size, font, color: ink(color) });
  };
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex];
    width = bounded(section.width, 595, 200, 2000);
    height = bounded(section.height, 842, 200, 2000);
    margin = bounded(section.margin, 40, 0, Math.min(width, height) / 4);
    newPage();
    if (section.background) page.drawRectangle({ x: 0, y: 0, width, height, color: ink(section.background) });
    for (const block of section.blocks) {
      if (block.kind === 'break') { if (y > margin) newPage(); continue; }
      if (block.kind === 'rect') {
        page.drawRectangle({ x: block.x, y: height - block.y - block.height, width: Math.max(0, block.width), height: Math.max(0, block.height), color: ink(block.fill) });
      } else if (block.kind === 'text') {
        let size = bounded(block.size, 11, 5, 72);
        const x = section.fixed ? bounded(block.x, margin, 0, width) : margin;
        const available = Math.max(10, section.fixed ? Math.min(block.width || width, width - x) : width - margin * 2);
        const content = safeText(block.text);
        let lines = wrapDocumentText(content, available, line => font.widthOfTextAtSize(line, size));
        let top = section.fixed ? Math.max(0, block.y || 0) : y;
        if (section.fixed) {
          const space = Math.max(5, Math.min(block.height || height, height - top));
          while (size > 5 && lines.length * size * 1.4 > space) {
            size = Math.max(5, size - .5);
            lines = wrapDocumentText(content, available, line => font.widthOfTextAtSize(line, size));
          }
        }
        for (const line of lines) {
          if (!section.fixed) { ensure(size * 1.5); top = y; }
          if (top + size > height - margin) { warnings.add('일부 슬라이드 텍스트가 페이지 범위를 넘어 표시되지 않습니다.'); break; }
          drawLine(line, x, top, size, available, block.align, block.color);
          top += size * 1.4;
          if (!section.fixed) y = top;
        }
        if (!section.fixed) y += 6;
      } else if (block.kind === 'image') {
        let embedded;
        try { embedded = block.bytes[0] === 0x89 ? await pdf.embedPng(block.bytes) : await pdf.embedJpg(block.bytes); }
        catch { warnings.add('손상되었거나 지원하지 않는 그림이 제외되었습니다.'); continue; }
        const requestedWidth = block.width > 0 ? block.width : embedded.width * .75;
        const requestedHeight = block.height > 0 ? block.height : requestedWidth * embedded.height / embedded.width;
        const scale = section.fixed ? 1 : Math.min(1, (width - 2 * margin) / requestedWidth, (height - 2 * margin) / requestedHeight);
        const w = requestedWidth * scale;
        const h = requestedHeight * scale;
        if (!section.fixed) ensure(h + 8);
        page.drawImage(embedded, { x: section.fixed ? block.x : margin, y: height - (section.fixed ? block.y : y) - h, width: w, height: h });
        if (!section.fixed) y += h + 8;
      } else if (block.kind === 'table') {
        const columns = Math.max(1, ...block.rows.map(row => row.reduce((sum, c) => sum + (c.span || 1), 0)));
        const rawWidths = Array.from({ length: columns }, (_, index) => bounded(block.widths?.[index], 70, 20, 400));
        const scale = (width - margin * 2) / rawWidths.reduce((a, b) => a + b, 0);
        const widths = rawWidths.map(w => w * scale);
        const size = widths.some(w => w < 25) ? 7 : 9;
        const lineHeight = size * 1.4;
        for (const row of block.rows) {
          let col = 0;
          const cells = row.map(cell => {
            const span = Math.max(1, Math.min(columns - col, cell.span || 1));
            const w = widths.slice(col, col + span).reduce((a, b) => a + b, 0);
            col += span;
            return { ...cell, width: w, lines: wrapDocumentText(safeText(cell.text), Math.max(3, w - 8), line => font.widthOfTextAtSize(line, size)) };
          });
          const rowLines = Math.max(1, ...cells.map(c => c.lines.length));
          let offset = 0;
          while (offset < rowLines) {
            const fullHeight = (rowLines - offset) * lineHeight + 8;
            if (fullHeight <= height - margin * 2) ensure(fullHeight);
            else ensure(lineHeight + 8);
            const count = Math.min(rowLines - offset, Math.max(1, Math.floor((height - margin - y - 8) / lineHeight)));
            const rowHeight = count * lineHeight + 8;
            let x = margin;
            for (const cell of cells) {
              page.drawRectangle({ x, y: height - y - rowHeight, width: cell.width, height: rowHeight,
                borderColor: ink('B8BDC4'), borderWidth: .4, ...(cell.fill ? { color: ink(cell.fill) } : {}) });
              cell.lines.slice(offset, offset + count).forEach((line, index) => drawLine(line, x + 4, y + 4 + index * lineHeight, size, cell.width - 8, cell.align, cell.color));
              x += cell.width;
            }
            y += rowHeight;
            offset += count;
            if (offset < rowLines) newPage();
          }
        }
        y += 10;
      }
    }
    report((sectionIndex + 1) / sections.length);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  pdf.setTitle(title);
  pdf.setCreator('DaydayPDF');
  const bytes = await pdf.save();
  return { bytes, pageCount: pdf.getPageCount(), warnings: [...warnings] };
}

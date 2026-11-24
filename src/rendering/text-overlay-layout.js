export function createTextOverlayLayout({ document, fontFamilyOf }) {
  const cache = new Map();
  return function layout(object, pageWidth, pageHeight, shape = false) {
    const size = Number.isFinite(object.size) ? object.size : 16;
    const width = object.fw === undefined ? null : object.fw * pageWidth * (shape ? .84 : 1);
    const height = object.fh === undefined ? null : object.fh * pageHeight * (shape ? .84 : 1);
    const family = fontFamilyOf(object), text = String(object.text || '');
    const align = object.align || (shape ? 'center' : 'left');
    const valign = object.valign || (shape ? 'middle' : 'top');
    const key = JSON.stringify([text, family, size, !!object.bold, width, height, align, valign, shape, width === null ? [pageWidth, object.fx] : null]);
    if (cache.has(key)) return cache.get(key);
    const host = document.createElement('div'), box = document.createElement('div'), content = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;contain:layout style paint;';
    host.style.width = pageWidth + 'px'; host.style.height = pageHeight + 'px';
    box.style.cssText = 'position:absolute;top:0;margin:0;padding:0;border:0;box-sizing:content-box;';
    Object.assign(box.style, { left: (object.fx || 0) * pageWidth + 'px', width: width === null ? 'auto' : width + 'px',
      height: height === null ? 'auto' : height + 'px', display: 'flex', flexDirection: 'column',
      justifyContent: valign === 'middle' ? 'center' : valign === 'bottom' ? 'flex-end' : 'flex-start',
      fontFamily: family, fontWeight: object.bold ? '700' : '400', fontSize: size + 'px',
      lineHeight: '1.2', textAlign: align });
    content.style.cssText = 'margin:0;padding:0;border:0;flex-shrink:0;white-space:pre-wrap;';
    content.style.wordBreak = !shape && width !== null ? 'break-all' : 'normal';
    if (shape) content.style.overflowWrap = 'anywhere';
    const node = document.createTextNode(text); content.appendChild(node); box.appendChild(content);
    host.appendChild(box); document.body.appendChild(host);
    try {
      const rect = box.getBoundingClientRect(), range = document.createRange(), lines = [];
      const context = document.createElement('canvas').getContext('2d');
      const font = (object.bold ? '700 ' : '') + size + 'px ' + family;
      context.font = font;
      const metrics = context.measureText('Ag한글');
      const ascent = Number.isFinite(metrics.fontBoundingBoxAscent) ? metrics.fontBoundingBoxAscent : size * .95;
      let offset = 0, line = null;
      for (const character of text) {
        range.setStart(node, offset); offset += character.length; range.setEnd(node, offset);
        const boxes = range.getClientRects(), r = boxes[0];
        if (!r || character === '\n' || character === '\r') { line = null; continue; }
        const top = r.top - rect.top;
        if (!line || Math.abs(line.top - top) > .25) {
          line = { text: '', x: r.left - rect.left, y: top + ascent, top }; lines.push(line);
        }
        line.x = Math.min(line.x, r.left - rect.left);
        line.text += character;
      }
      const result = { width: width ?? rect.width, height: height ?? rect.height, font, lines };
      if (cache.size >= 256) cache.delete(cache.keys().next().value);
      cache.set(key, result); return result;
    } finally { host.remove(); }
  };
}

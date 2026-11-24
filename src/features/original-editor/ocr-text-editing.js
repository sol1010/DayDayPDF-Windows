export function isInvisiblePdfText(style) {
  return style.renderMode === 3 || (style.renderMode === 0 && style.alpha === 0);
}

export function ocrPdfItemBounds(item, fontStyle) {
  const [a, b, c, d, e, f] = item.transform || [];
  const horizontal = Math.hypot(a, b), vertical = Math.hypot(c, d);
  if (!(horizontal > 0 && vertical > 0 && item.width > 0)) return null;
  const ascent = Number.isFinite(fontStyle?.ascent) ? fontStyle.ascent : 1;
  const descent = Number.isFinite(fontStyle?.descent) ? fontStyle.descent : -0.25;
  const right = [a / horizontal * item.width, b / horizontal * item.width];
  const points = [descent, ascent].flatMap(y => [
    [e + c * y, f + d * y], [e + c * y + right[0], f + d * y + right[1]],
  ]);
  return [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])),
    Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
}

export function removeTextForReplacement(F, page, index) {
  const original = F.FPDFPage_GetObject(page, index);
  if (!original || F.FPDFPageObj_GetType(original) !== 1) throw new Error('텍스트를 찾지 못했습니다');
  if (!F.FPDFPage_RemoveObject(page, original)) {
    throw new Error('원본 텍스트 제거 실패');
  }
  F.FPDFPageObj_Destroy(original);
}

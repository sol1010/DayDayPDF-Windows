
export function analyzeOcrVisualSelection(image, analyzeOcrGlyph) {
  const { width, height, data } = image;
  const margin = 7;
  if (width < 20 || height < 20 || width * height > 16000000)
    throw new Error('OCR 선택 영역의 크기를 처리할 수 없습니다');
  const region = analyzeOcrGlyph(image, { bbox: {
    x0: margin, y0: margin, x1: width - margin, y1: height - margin,
  } });
  for (let y = 0; y < region.h; y++) for (let x = 0; x < region.w; x++) {
    const i = y * region.w + x, source = ((y + region.y0) * width + x + region.x0) * 4;
    if (!region.sprite[i * 4 + 3]) continue;
    let alpha = 0;
    for (let c = 0; c < 3; c++) {
      const paper = region.paper[i * 4 + c], delta = data[source + c] - paper;
      alpha = Math.max(alpha, delta < 0 ? -delta / Math.max(1, paper) : delta / Math.max(1, 255 - paper));
    }
    for (let c = 0; c < 3; c++) {
      const paper = region.paper[i * 4 + c];
      region.sprite[i * 4 + c] = paper + (data[source + c] - paper) / Math.max(.001, alpha);
    }
    region.sprite[i * 4 + 3] = Math.round(Math.min(1, alpha) * 255);
  }
  return region;
}

export function ocrVisualCanvases(image, region, canvasFactory) {
  const erase = canvasFactory(image.width, image.height), ink = canvasFactory(image.width, image.height);
  const ec = erase.getContext('2d'), ic = ink.getContext('2d');
  const ep = ec.createImageData(image.width, image.height), ip = ic.createImageData(image.width, image.height);
  for (let y = 0; y < region.h; y++) for (let x = 0; x < region.w; x++) {
    const i = y * region.w + x, target = ((y + region.y0) * image.width + x + region.x0) * 4;
    if (region.mask[i]) ep.data.set(region.paper.subarray(i * 4, i * 4 + 4), target);
    ip.data.set(region.sprite.subarray(i * 4, i * 4 + 4), target);
  }
  ec.putImageData(ep, 0, 0); ic.putImageData(ip, 0, 0);
  return { erase, ink, patch: { pixels: ep, protectedBounds: [] } };
}

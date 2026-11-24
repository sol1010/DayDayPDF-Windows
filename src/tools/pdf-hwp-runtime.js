import { createImageHwp, HWP_IMAGE_LIMITS } from './hwp-image-writer.js';

export function hwpRasterPlan(viewport, dpi = 200) {
  const { width, height } = viewport;
  if (![width, height].every(value => Number.isFinite(value) && value >= 1 && value <= HWP_IMAGE_LIMITS.maxPagePoints)) {
    throw new Error('HWP로 저장할 수 없는 용지 크기입니다. 최대 한 변 1m까지 지원합니다.');
  }
  const requested = [150, 200, 300].includes(dpi) ? dpi : 200;
  const scale = Math.min(requested / 72, 6000 / Math.max(width, height), Math.sqrt(16000000 / (width * height)));
  return { width, height, scale, pixelWidth: Math.floor(width * scale), pixelHeight: Math.floor(height * scale) };
}

export async function renderPdfToHwp(pdf, { dpi = 200, report = () => {} } = {}) {
  if (pdf.numPages > HWP_IMAGE_LIMITS.pages) throw new Error(`1~${HWP_IMAGE_LIMITS.pages}페이지 PDF를 선택하세요.`);
  const pages = [];
  let total = 0;
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      report((i - 1) / pdf.numPages * .88, i, pdf.numPages, 'render');
      const page = await pdf.getPage(i);
      const canvas = document.createElement('canvas');
      try {
        const plan = hwpRasterPlan(page.getViewport({ scale: 1 }), dpi);
        canvas.width = plan.pixelWidth; canvas.height = plan.pixelHeight;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('페이지 이미지를 만들 수 없습니다.');
        await page.render({ canvasContext: context, viewport: page.getViewport({ scale: plan.scale }), background: '#ffffff' }).promise;
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('페이지 이미지를 만들 수 없습니다.');
        total += blob.size;
        if (total > HWP_IMAGE_LIMITS.imageBytes) throw new Error('페이지 이미지 용량이 120MB를 넘었습니다. PDF를 나누거나 화질을 낮춰 변환하세요.');
        pages.push({ ...plan, extension: 'png', image: new Uint8Array(await blob.arrayBuffer()) });
      } finally {
        canvas.width = 1; canvas.height = 1;
        page.cleanup();
      }
    }
    report(.92, pdf.numPages, pdf.numPages, 'pack');
    await new Promise(resolve => setTimeout(resolve, 0));
    return createImageHwp(pages);
  } finally { pages.length = 0; }
}

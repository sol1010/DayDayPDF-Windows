import { zipSync } from 'fflate';
import { analyzePdfForDocuments, createSearchablePdf } from './ocr-runtime.js';
import { DOCUMENT_OUTPUTS } from './document-export-runtime.js';
import { parseOfficeDocument } from './document-import-runtime.js';
import { createPdfFromOffice } from './document-pdf-runtime.js';
import { renderPdfToHwp } from './pdf-hwp-runtime.js';
import { openPdfJs } from './pdf-task-runtime.js';

export async function convertEditorDocument(file, { output, language = 'kor+eng', quality = 'balanced', forceOcr = false, report = () => {}, context } = {}) {
  if (file.size > 100 * 1024 * 1024) throw new Error('100MB 이하 문서를 사용하세요. 큰 PDF는 나눈 뒤 변환하세요.');
  const title = file.name.replace(/\.[^.]+$/, '');
  const done = (bytes, extension, type, warnings = []) => ({ bytes, name: `${title}.${extension}`, type, warnings });
  const check = () => context?.throwIfCancelled();
  check();
  if (output === 'import') {
    const model = parseOfficeDocument(new Uint8Array(await file.arrayBuffer()), file.name);
    const result = await createPdfFromOffice(model, { title, report: ratio => { check(); report(ratio, 'PDF 만드는 중'); } });
    return done(result.bytes, 'pdf', 'application/pdf', result.warnings);
  }
  if (['hwp', 'png', 'jpg'].includes(output)) {
    const pdf = await openPdfJs(new Uint8Array(await file.arrayBuffer()));
    try {
      if (output === 'hwp') return done(await renderPdfToHwp(pdf, {
        report: (ratio, current, total) => { check(); report(ratio, `${current}/${total}페이지 변환 중`); },
      }), 'hwp', 'application/x-hwp');
      const files = {};
      let totalBytes = 0;
      for (let index = 1; index <= pdf.numPages; index++) {
        check();
        const page = await pdf.getPage(index);
        const original = page.getViewport({ scale: 1 });
        const scale = Math.min(300 / 72, 6000 / Math.max(original.width, original.height), Math.sqrt(16000000 / (original.width * original.height)));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        try {
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport, background: '#ffffff' }).promise;
          const type = output === 'png' ? 'image/png' : 'image/jpeg';
          const blob = await new Promise(resolve => canvas.toBlob(resolve, type, .94));
          if (!blob) throw new Error('이미지를 만들지 못했습니다.');
          const bytes = new Uint8Array(await blob.arrayBuffer());
          if (pdf.numPages === 1) return done(bytes, output, type);
          totalBytes += bytes.length;
          if (totalBytes > 256 * 1024 * 1024) throw new Error('이미지 용량이 256MB를 넘었습니다. PDF를 나눠 저장하세요.');
          files[`page-${String(index).padStart(4, '0')}.${output}`] = bytes;
          report(index / pdf.numPages, `${index}/${pdf.numPages}페이지 이미지 만드는 중`);
        } finally { canvas.width = canvas.height = 1; page.cleanup(); }
      }
      return done(zipSync(files, { level: 0 }), 'zip', 'application/zip');
    } finally { await pdf.loadingTask.destroy(); }
  }
  if (!['pdf', 'pptx', 'docx', 'xlsx'].includes(output)) throw new Error('지원하지 않는 변환 형식입니다.');
  const analysis = await analyzePdfForDocuments(file, { language, quality, forceOcr,
    includePageImages: output === 'pptx', context,
    report: (ratio, message) => report(ratio * .85, message) });
  check();
  if (output === 'pdf') return done(await createSearchablePdf(analysis.bytes, analysis.pages, {
    report: (ratio, message) => { check(); report(.85 + ratio * .15, message || '검색 가능한 PDF 만드는 중'); },
  }), 'pdf', 'application/pdf');
  report(.9, '문서 만드는 중');
  return done(DOCUMENT_OUTPUTS[output].create(analysis.pages, { title }), output, DOCUMENT_OUTPUTS[output].type);
}

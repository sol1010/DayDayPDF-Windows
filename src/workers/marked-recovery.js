import { prepareMarkedRestoration } from '../features/recovery/marked-page-filter.js';
import { sanitizeTextObject } from '../core/compatibility.js';

importScripts('/assets/windows-vendor/pdf-lib/1.17.1/pdf-lib.min.js');
self.onmessage = async ({data}) => {
  try {
    const fonts = new Set(data.fonts);
    const result = await prepareMarkedRestoration(data.bytes, self.PDFLib,
      object => sanitizeTextObject(object, {isKnownFont: key => fonts.has(key)}), {expectedPages: data.pages});
    self.postMessage(result, result.restored ? [result.restored.bytes.buffer] : []);
  } catch { self.postMessage(null); }
};

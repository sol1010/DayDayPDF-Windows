export const PDFJS_VERSION = '6.2.108';
export const PDFJS_CDN_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/`;
export const PDFIUM_CDN = 'https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@2.15.0/dist/';
export const WINDOWS_PDFIUM_BASE = 'assets/windows-vendor/pdfium/2.15.0/';
export const WINDOWS_FONT_BASE = 'assets/windows-vendor/fonts/';
export const GF_SHA = 'ade3d1533e06b2b1462ffcde8e08b129627ca360';

export const ARROW_HEAD_SIZE_MIN = 4;
export const ARROW_HEAD_SIZE_MAX = 160;

export const THUMB_DISPLAY_MIN = 84;
export const THUMB_DISPLAY_MAX = 168;
export const THUMB_RENDER_MAX = 168;

export function cacheByteLimit(deviceMemory, lowMemoryMiB, normalMemoryMiB) {
  return ((deviceMemory || 8) <= 4 ? lowMemoryMiB : normalMemoryMiB) * 1024 * 1024;
}

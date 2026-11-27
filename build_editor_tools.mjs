import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
export async function buildEditorTools(destination) {
  const web = resolve(destination);
  await mkdir(resolve(web, 'assets/editor-tools'), { recursive: true });
  await build({ entryPoints: [resolve(root, 'src/tools/editor-document-runtime.js')],
    outfile: resolve(web, 'assets/editor-tools/runtime.js'), bundle: true, minify: true,
    platform: 'browser', format: 'esm', target: 'es2022', legalComments: 'linked' });
  await build({ entryPoints: [resolve(root, 'src/tools/editor-security-runtime.js')],
    outfile: resolve(web, 'assets/editor-tools/security.js'), bundle: true, minify: true,
    platform: 'browser', format: 'esm', target: 'es2022', legalComments: 'linked' });
  await build({ entryPoints: [resolve(root, 'src/workers/marked-recovery.js')],
    outfile: resolve(web, 'assets/editor-tools/marked-recovery.js'), bundle: true, minify: true,
    platform: 'browser', format: 'iife', target: 'es2022', legalComments: 'linked' });
  const copies = [
    ['node_modules/qpdf-run/src/worker.js', 'assets/qpdf/qpdf-worker.js'],
    ['node_modules/qpdf-run/vendor/qpdf/lib/qpdf.js', 'assets/qpdf/qpdf.js'],
    ['node_modules/qpdf-run/vendor/qpdf/lib/qpdf.wasm', 'assets/qpdf/qpdf.wasm'],
    ['assets/ocr', 'assets/ocr'],
    ['assets/document-licenses', 'licenses/document-tools'],
    ['LICENSE', 'licenses/DayDayPDF-GPL-3.0.txt'],
    ['THIRD_PARTY_NOTICES.txt', 'THIRD_PARTY_NOTICES.txt'],
    ['node_modules/tesseract.js/dist/tesseract.esm.min.js', 'assets/ocr/tesseract.esm.min.js'],
    ['node_modules/tesseract.js/dist/worker.min.js', 'assets/ocr/worker.min.js'],
    ['node_modules/tesseract.js/dist/tesseract.min.js.LICENSE.txt', 'assets/ocr/tesseract.min.js.LICENSE.txt'],
    ['node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt', 'assets/ocr/worker.min.js.LICENSE.txt'],
    ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'].map(name => [`node_modules/tesseract.js-core/${name}`, `assets/ocr/core/${name}`]),
  ];
  for (const [source, target] of copies) {
    await mkdir(dirname(resolve(web, target)), { recursive: true });
    await cp(resolve(root, source), resolve(web, target), { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('출력할 WebApp 폴더를 지정하세요.');
  await buildEditorTools(process.argv[2]);
}

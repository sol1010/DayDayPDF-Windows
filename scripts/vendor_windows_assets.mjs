import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorRoot = resolve(root, 'assets', 'windows-vendor');

const copies = Object.freeze([
  ['node_modules/pdf-lib/dist/pdf-lib.min.js', 'pdf-lib/1.17.1/pdf-lib.min.js'],
  ['node_modules/pdf-lib/LICENSE.md', 'pdf-lib/1.17.1/LICENSE.md'],
  ['node_modules/pdf-lib/package.json', 'pdf-lib/1.17.1/package.json'],
  ['node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js', 'fontkit/1.1.1/fontkit.umd.min.js'],
  ['node_modules/@pdf-lib/fontkit/package.json', 'fontkit/1.1.1/package.json'],
  ['node_modules/@embedpdf/pdfium/dist/index.browser.js', 'pdfium/2.15.0/index.browser.js'],
  ['node_modules/@embedpdf/pdfium/dist/pdfium.wasm', 'pdfium/2.15.0/pdfium.wasm'],
  ['node_modules/@embedpdf/pdfium/LICENSE', 'pdfium/2.15.0/LICENSE'],
  ['node_modules/@embedpdf/pdfium/LICENSE.pdfium', 'pdfium/2.15.0/LICENSE.pdfium'],
  ['node_modules/@embedpdf/pdfium/package.json', 'pdfium/2.15.0/package.json'],
]);

const googleFontsRevision = 'e1118da94a8cb00cf6d06cdac9ef13eb1e5c6ab7';
const downloads = Object.freeze([
  ['https://cdn.jsdelivr.net/gh/spoqa/spoqa-han-sans@3.3.0/Subset/SpoqaHanSans/SpoqaHanSansRegular.ttf', 'fonts/SpoqaHanSansRegular.ttf'],
  ['https://cdn.jsdelivr.net/gh/spoqa/spoqa-han-sans@3.3.0/Subset/SpoqaHanSans/SpoqaHanSansBold.ttf', 'fonts/SpoqaHanSansBold.ttf'],
  [`https://cdn.jsdelivr.net/gh/google/fonts@${googleFontsRevision}/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf`, 'fonts/NotoSansKR-wght.ttf'],
  [`https://cdn.jsdelivr.net/gh/google/fonts@${googleFontsRevision}/ofl/nanumgothic/NanumGothic-Regular.ttf`, 'fonts/NanumGothic-Regular.ttf'],
  [`https://cdn.jsdelivr.net/gh/google/fonts@${googleFontsRevision}/ofl/nanumgothic/NanumGothic-Bold.ttf`, 'fonts/NanumGothic-Bold.ttf'],
  [`https://cdn.jsdelivr.net/gh/google/fonts@${googleFontsRevision}/ofl/nanummyeongjo/NanumMyeongjo-Regular.ttf`, 'fonts/NanumMyeongjo-Regular.ttf'],
  [`https://cdn.jsdelivr.net/gh/google/fonts@${googleFontsRevision}/ofl/nanummyeongjo/NanumMyeongjo-Bold.ttf`, 'fonts/NanumMyeongjo-Bold.ttf'],
  [`https://cdn.jsdelivr.net/gh/google/fonts@${googleFontsRevision}/ofl/nanumpenscript/NanumPenScript-Regular.ttf`, 'fonts/NanumPenScript-Regular.ttf'],
  [`https://cdn.jsdelivr.net/gh/google/fonts@${googleFontsRevision}/ofl/roboto/Roboto%5Bwdth,wght%5D.ttf`, 'fonts/Roboto-wdth-wght.ttf'],
  [`https://cdn.jsdelivr.net/gh/google/fonts@${googleFontsRevision}/apache/robotoslab/RobotoSlab%5Bwght%5D.ttf`, 'fonts/RobotoSlab-wght.ttf'],
]);

async function ensureParent(path) {
  await mkdir(dirname(path), { recursive: true });
}

for (const [sourceRelative, targetRelative] of copies) {
  const target = resolve(vendorRoot, targetRelative);
  await ensureParent(target);
  await copyFile(resolve(root, sourceRelative), target);
}

for (const [url, targetRelative] of downloads) {
  const target = resolve(vendorRoot, targetRelative);
  await ensureParent(target);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  await writeFile(target, new Uint8Array(await response.arrayBuffer()));
}

await copyFile(resolve(root, 'THIRD_PARTY_NOTICES.txt'), resolve(vendorRoot, 'licenses/THIRD_PARTY_NOTICES.txt'));

const targets = [...copies.map(([, target]) => target), ...downloads.map(([, target]) => target)].sort();
const manifest = [];
for (const relativePath of targets) {
  const bytes = await readFile(resolve(vendorRoot, relativePath));
  manifest.push({
    path: relativePath.replaceAll('\\', '/'),
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
await writeFile(
  resolve(vendorRoot, 'manifest.json'),
  `${JSON.stringify({ generatedBy: 'npm run vendor:windows', files: manifest }, null, 2)}\n`,
  'utf8',
);
process.stdout.write(`Windows 로컬 자산 준비 완료: ${manifest.length}개 파일\n`);

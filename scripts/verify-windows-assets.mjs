import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../assets/windows-vendor/', import.meta.url);
const { files } = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
for (const file of files) {
  const bytes = await readFile(new URL(file.path, root));
  assert.equal(bytes.length, file.bytes, file.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
}
const notices = await readFile(new URL('../../THIRD_PARTY_NOTICES.txt', root), 'utf8');
assert.equal((await readFile(new URL('licenses/THIRD_PARTY_NOTICES.txt', root), 'utf8')).replaceAll('\r\n', '\n'),
  notices.replaceAll('\r\n', '\n'), 'Bundled notices must match THIRD_PARTY_NOTICES.txt');
for (const file of ['LICENSE_QUICKJS', 'LICENSE_PDFJS_QUICKJS']) {
  assert.match(await readFile(new URL('../pdfjs/6.2.108/wasm/' + file, root), 'utf8'), /Permission is hereby granted/);
}

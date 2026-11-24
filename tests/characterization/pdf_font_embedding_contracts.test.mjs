import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { createAlignedSubsetFontkit } from '../../src/adapters/pdf-lib-font-adapter.js';

const liberationSansPath = new URL(
  '../../assets/pdfjs/6.2.108/standard_fonts/LiberationSans-Regular.ttf',
  import.meta.url,
);

test('only used TrueType glyphs are embedded while PDF font metadata stays complete', async () => {
  const bytes = await readFile(liberationSansPath);
  const document = await PDFDocument.create();
  document.registerFontkit(createAlignedSubsetFontkit(fontkit));
  const font = await document.embedFont(bytes, {
    subset: true,
    customName: 'ABCDEF+LiberationSans',
  });
  const page = document.addPage([420, 160]);
  page.drawText('DaydayPDF Font Aa 123', {
    x: 32, y: 82, size: 24, font, color: rgb(0.08, 0.1, 0.12),
  });

  const saved = await document.save({ useObjectStreams: false });
  const raw = Buffer.from(saved).toString('latin1');
  assert.match(raw, /\/Subtype \/Type0/);
  assert.match(raw, /\/Encoding \/Identity-H/);
  assert.match(raw, /\/ToUnicode \d+ 0 R/);
  assert.match(raw, /\/FontFile2 \d+ 0 R/);
  assert.match(raw, /\/BaseFont \/ABCDEF\+LiberationSans/);

  const fullDocument = await PDFDocument.create();
  fullDocument.registerFontkit(fontkit);
  const fullFont = await fullDocument.embedFont(bytes, { subset: false, customName: 'LiberationSans' });
  fullDocument.addPage([420, 160]).drawText('DaydayPDF Font Aa 123', {
    x: 32, y: 82, size: 24, font: fullFont, color: rgb(0.08, 0.1, 0.12),
  });
  const fullSaved = await fullDocument.save({ useObjectStreams: false });
  assert.ok(saved.length < fullSaved.length / 4,
    `subset ${saved.length}B should be much smaller than full font ${fullSaved.length}B`);

  const reopened = await PDFDocument.load(saved);
  assert.equal(reopened.getPageCount(), 1);
});

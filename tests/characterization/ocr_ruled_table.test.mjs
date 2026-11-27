import test from 'node:test';
import assert from 'node:assert/strict';
import { ruledTableLayout, restoreTableLines, tableReadingOrder } from '../../src/tools/ocr-table-layout.js';

function sample(columns, rows, letters = true) {
  const width = 160, height = 20 * (rows + 1), data = new Uint8ClampedArray(width * height * 4).fill(255);
  const pixel = (x, y, gray) => data.fill(gray, (width * y + x) * 4, (width * y + x) * 4 + 3);
  for (let row = 0; row < rows; row++) {
    for (let x = 0; x < width; x++) pixel(x, row * 20 + 18, 190);
    if (letters) for (const start of columns) for (let y = 5; y < 13; y++)
      for (let x = start; x < start + 12; x++) pixel(x, row * 20 + y, 50);
  }
  return { data, width, height };
}

test('table segmentation requires ruled rows with text and a clear column gap', () => {
  assert.equal(ruledTableLayout(sample([10,100], 2)), null);
  assert.equal(ruledTableLayout(sample([], 14, false)), null);
  const table = ruledTableLayout(sample([10,100], 14));
  assert.equal(table.scale, 1);
  assert.ok(table.split > 22 && table.split < 100);
  assert.equal(ruledTableLayout(sample([10], 14)).split, 0);
});

test('interleaved column results preserve row order and original word bounds', () => {
  const line = (text, x, y) => ({ text, bbox: {x0:x, x1:x+10, y0:y, y1:y+10}, words:[] });
  const a = line('수량', 80, 12), b = line('01', 4, 10), c = line('02', 4, 45);
  assert.deepEqual(tableReadingOrder([a,c,b]).map(l=>l.text), ['01','수량','02']);
  const [mapped] = restoreTableLines([{...a, words:[{text:'수량', bbox:a.bbox}]}], 2, 3);
  assert.deepEqual(mapped.words[0].bbox, {x0:160,y0:36,x1:180,y1:66});
});

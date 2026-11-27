export function ruledTableLayout({ data, width, height }) {
  const step = Math.max(1, Math.floor(width / 500));
  const samples = Math.ceil(width / step);
  const text = new Uint8Array(height);
  const ruled = new Uint8Array(height);
  const rules = [];
  let start = -1;
  for (let y = 0; y <= height; y++) {
    let dark = 0, run = 0, longest = 0;
    if (y < height) for (let x = 0; x < width; x += step) {
      const gray = data[(width * y + x) * 4];
      if (gray < 150) dark++;
      run = gray < 242 ? run + 1 : 0;
      if (run > longest) longest = run;
    }
    if (longest >= samples * .38) {
      ruled[y] = 1;
      if (start < 0) start = y;
    } else {
      if (start >= 0 && y - start <= Math.max(4, height * .006)) rules.push((start + y) >> 1);
      start = -1;
      if (y < height && dark >= Math.max(3, samples * .009)) text[y] = 1;
    }
  }
  if (rules.length < 4) return null;
  const glyphs = [];
  for (let i = 1; i < rules.length; i++) {
    const gap = rules[i] - rules[i - 1];
    let band = 0, longest = 0;
    for (let y = rules[i - 1] + 1; y < rules[i]; y++) {
      band = text[y] ? band + 1 : 0;
      longest = Math.max(longest, band);
    }
    if (longest >= 6 && longest <= gap * .8) glyphs.push(longest);
  }
  if (glyphs.length < 3 || glyphs.length < (rules.length - 1) * .6) return null;
  glyphs.sort((a, b) => a - b);
  const glyphHeight = glyphs[Math.floor(glyphs.length / 2)];
  const scale = glyphHeight >= 30 ? .5 : 1;
  if (glyphs.length < 10) return { scale };

  let top = rules[0];
  while (top > 0 && !text[top]) top--;
  while (top > 0 && text[top]) top--;
  const blank = y => {
    for (let x = 0; x < width; x++) if (data[4 * (y * width + x)] < 248) return false;
    return true;
  };
  const limit = Math.max(0, top - glyphHeight);
  while (top > limit && !blank(top)) top--;
  let bottom = rules.at(-1);
  while (bottom < height && !blank(bottom)) bottom++;
  if (!blank(top) || bottom - rules.at(-1) > glyphHeight) return { scale };
  const columns = new Uint32Array(width);
  let total = 0;
  for (let y = top; y < bottom; y++) {
    if (ruled[y]) continue;
    for (let x = 0; x < width; x++) if (data[(y * width + x) * 4] < 235) {
      columns[x]++;
      total++;
    }
  }
  let leftInk = 0, gap = 0, best = glyphHeight, split = 0;
  for (let x = 0; x < width; x++) {
    if (!columns[x]) { gap++; continue; }
    if (gap > best && leftInk > total * .25 && leftInk < total * .75) {
      best = gap;
      split = x - Math.ceil(gap / 2);
    }
    gap = 0;
    leftInk += columns[x];
  }
  return { scale, split, top, bottom };
}

export function tableReadingOrder(lines) {
  const center = line => (line.bbox.y0 + line.bbox.y1) / 2;
  const ordered = [...lines].sort((a, b) => center(a) - center(b));
  const rows = [];
  for (const line of ordered) {
    const row = rows.at(-1), anchor = row?.[0];
    if (anchor && center(line) - center(anchor) < .5 * Math.min(line.bbox.y1 - line.bbox.y0, anchor.bbox.y1 - anchor.bbox.y0))
      row.push(line);
    else rows.push([line]);
  }
  return rows.flatMap(row => row.sort((a, b) => a.bbox.x0 - b.bbox.x0));
}

export function restoreTableLines(lines, scaleX, scaleY) {
  const box = b => ({ x0: b.x0 * scaleX, y0: b.y0 * scaleY, x1: b.x1 * scaleX, y1: b.y1 * scaleY });
  return lines.map(line => ({ ...line, bbox: box(line.bbox),
    words: line.words.map(word => ({ ...word, bbox: box(word.bbox) })) }));
}

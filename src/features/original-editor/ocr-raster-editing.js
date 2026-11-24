const median = values => values.length ? [...values].sort((a, b) => a - b)[values.length >> 1] : 0;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const chars = text => Array.from(String(text).normalize('NFC'));
const blank = c => /\s/u.test(c);

function ocrEditUnavailable(reason) {
  const error = new Error('이 OCR 텍스트는 수정할 수 없습니다. 원본 모양을 유지하기 어렵습니다');
  error.code = 'OCR_EDIT_UNAVAILABLE';
  error.reason = reason;
  return error;
}

export function ocrEditDiff(before, after) {
  const a = chars(before), b = chars(after);
  if (a.length > 1000 || b.length > 1000) throw new Error('한 번에 수정할 수 있는 문장은 1,000자까지입니다');
  const rows = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = 0; i <= a.length; i++) rows[i][0] = i;
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1,
      rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const result = [];
  let i = a.length, j = b.length;
  while (i || j) {
    if (i && j && rows[i][j] === rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      result.push({ old: --i, next: --j, same: a[i] === b[j] });
    } else if (i && rows[i][j] === rows[i - 1][j] + 1) result.push({ old: --i, next: null, same: false });
    else result.push({ old: null, next: --j, same: false });
  }
  return result.reverse();
}

export function ocrSymbolsForText(text, data) {
  const lines = (data.blocks || []).flatMap(block => (block.paragraphs || []).flatMap(paragraph => paragraph.lines || []))
    .filter(line => line.words?.some(word => word.symbols?.some(s => s.text && !blank(s.text))));
  if (lines.length !== 1) throw ocrEditUnavailable('multiple-or-missing-lines');
  const symbols = lines.flatMap(line => (line.words || []).flatMap(word => word.symbols || []))
    .filter(s => s.text && !blank(s.text) && s.bbox && s.bbox.x1 > s.bbox.x0 && s.bbox.y1 > s.bbox.y0);
  const expected = chars(text).filter(c => !blank(c));
  const actual = symbols.flatMap(s => chars(s.text));
  if (actual.length !== symbols.length || expected.length !== symbols.length)
    throw ocrEditUnavailable('ambiguous-symbols');
  const errors = expected.filter((c, i) => c !== actual[i]).length;
  if (errors || symbols.some(s => Number.isFinite(s.confidence) && s.confidence < 80))
    throw ocrEditUnavailable('unreliable-recognition');
  let cursor = 0;
  return chars(text).map(c => blank(c) ? { char: c, bbox: null }
    : { char: c, bbox: { ...symbols[cursor++].bbox } });
}

export function ocrRasterFrame(item, style, bounds, scale = 4) {
  const transform = item?.transform;
  let ux = 1, uy = 0, origin = [bounds[0], bounds[3]], width = bounds[2] - bounds[0], height = bounds[3] - bounds[1];
  if (transform) {
    const [a, b, c, d, e, f] = transform, h = Math.hypot(c, d), w = Math.hypot(a, b);
    if (w > 0 && h > 0) {
      ux = a / w; uy = b / w;
      if (Math.abs(ux * c / h + uy * d / h) > .03) throw ocrEditUnavailable('skewed-text');
      const ascent = style?.ascent ?? 1, descent = style?.descent ?? -.25;
      origin = [e + c * ascent, f + d * ascent];
      width = item.width; height = h * (ascent - descent);
    }
  }
  if (!(width > 0 && height > 0) || height > 200) throw ocrEditUnavailable('invalid-line-region');
  const pad = 4;
  origin = [origin[0] - ux * pad - uy * pad, origin[1] - uy * pad + ux * pad];
  return { origin, ux, uy, scale, width: Math.ceil((width + pad * 2) * scale),
    height: Math.ceil((height + pad * 2) * scale) };
}

export function ocrRasterPoint(frame, x, y) {
  return [frame.origin[0] + (frame.ux * x + frame.uy * y) / frame.scale,
    frame.origin[1] + (frame.uy * x - frame.ux * y) / frame.scale];
}

export function ocrRasterTransform(frame, viewportTransform) {
  const [a, b, c, d, e, f] = viewportTransform, det = a * d - b * c;
  const inverse = [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
  const { ux, uy, scale: s, origin: [x, y] } = frame;
  const m = [ux * s, uy * s, uy * s, -ux * s, -(ux * x + uy * y) * s, (-uy * x + ux * y) * s];
  return [m[0] * inverse[0] + m[2] * inverse[1], m[1] * inverse[0] + m[3] * inverse[1],
    m[0] * inverse[2] + m[2] * inverse[3], m[1] * inverse[2] + m[3] * inverse[3],
    m[0] * inverse[4] + m[2] * inverse[5] + m[4], m[1] * inverse[4] + m[3] * inverse[5] + m[5]];
}

export async function recognizeOcrEditLine(canvas) {
  const libraryPath = '/assets/ocr/tesseract.esm.min.js';
  const module = await import(libraryPath), library = module.default || module;
  let worker, failure;
  try {
    for (const name of ['simd-lstm', 'lstm']) {
      try {
        worker = await library.createWorker(['kor', 'eng'], library.OEM.LSTM_ONLY, {
          workerPath: '/assets/ocr/worker.min.js',
          corePath: `/assets/ocr/core/tesseract-core-${name}.wasm.js`,
          langPath: '/assets/ocr/tessdata_best', gzip: true,
        });
        break;
      } catch (error) { failure = error; }
    }
    if (!worker) throw failure;
    await worker.setParameters({ tessedit_pageseg_mode: String(library.PSM.SINGLE_LINE),
      preserve_interword_spaces: '1', user_defined_dpi: '288' });
    const result = await worker.recognize(canvas, { rotateAuto: false }, { blocks: true, text: true });
    return result.data;
  } finally { await worker?.terminate(); }
}

function ocrPaperSurface(image, x0, y0, w, h) {
  const { data, width, height } = image;
  if (y0 < 3 || y0 + h + 3 > height) throw ocrEditUnavailable('missing-paper-margin');
  const pixel = (x, y, c) => data[(y * width + x) * 4 + c];
  const band = ys => [0, 1, 2].map(c => {
    const values = Array.from({ length: w }, (_, x) => median(ys.map(y => pixel(x0 + x, y, c))));
    const mean = values.reduce((a, b) => a + b, 0) / w, center = (w - 1) / 2;
    let numerator = 0, denominator = 0;
    for (let x = 0; x < w; x++) { numerator += (x - center) * (values[x] - mean); denominator += (x - center) ** 2; }
    const slope = numerator / Math.max(1, denominator);
    const at = x => mean + (x - center) * slope;
    if (Math.abs(slope * (w - 1)) > 32 || ys.some(y => values.some((_, x) => Math.abs(pixel(x0 + x, y, c) - at(x)) > 12)))
      throw ocrEditUnavailable('contaminated-paper-samples');
    return at;
  });
  const top = band([y0 - 3, y0 - 2, y0 - 1]), bottom = band([y0 + h, y0 + h + 1, y0 + h + 2]);
  if ([0, 1, 2].some(c => [0, w - 1].some(x => Math.abs(top[c](x) - bottom[c](x)) > 40)))
    throw ocrEditUnavailable('inconsistent-paper');
  const at = (x, y, c) => top[c](x) * (1 - (y + 2) / (h + 3)) + bottom[c](x) * (y + 2) / (h + 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x !== 0 && x !== w - 1 && y !== 0 && y !== h - 1) continue;
    if ([0, 1, 2].some(c => Math.abs(pixel(x0 + x, y0 + y, c) - at(x, y, c)) > 12))
      throw ocrEditUnavailable('touching-ink-or-background');
  }
  return at;
}

export function analyzeOcrGlyph(image, entry) {
  if (!entry.bbox) return { ...entry, blank: true };
  const { data, width, height } = image, box = entry.bbox;
  const x0 = clamp(Math.floor(box.x0) - 3, 0, width - 1), x1 = clamp(Math.ceil(box.x1) + 3, x0 + 1, width);
  const y0 = clamp(Math.floor(box.y0) - 3, 0, height - 1), y1 = clamp(Math.ceil(box.y1) + 3, y0 + 1, height);
  const w = x1 - x0, h = y1 - y0;
  const background = ocrPaperSurface(image, x0, y0, w, h);
  const paper = new Uint8ClampedArray(w * h * 4), contrast = new Float32Array(w * h);
  const pixel = (x, y, c) => data[(clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)) * 4 + c];
  let maximum = 0;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      let distance = 0;
      for (let c = 0; c < 3; c++) {
        paper[i * 4 + c] = Math.round(background(x, y, c));
        distance += (pixel(x0 + x, y0 + y, c) - paper[i * 4 + c]) ** 2;
      }
      paper[i * 4 + 3] = 255;
      contrast[i] = Math.sqrt(distance / 3); maximum = Math.max(maximum, contrast[i]);
    }
  }
  if (maximum < 24) throw ocrEditUnavailable('insufficient-ink-contrast');
  const mask = new Uint8Array(w * h), foreground = [];
  for (let i = 0; i < mask.length; i++) {
    mask[i] = contrast[i] > Math.max(5, maximum * .045) ? 1 : 0;
    if (contrast[i] >= maximum * .85) foreground.push(i);
  }
  const color = [0, 1, 2].map(c => median(foreground.map(i => pixel(x0 + i % w, y0 + Math.floor(i / w), c))));
  const sprite = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < mask.length; i++) if (mask[i]) {
    let numerator = 0, denominator = 0;
    for (let c = 0; c < 3; c++) {
      const delta = color[c] - paper[i * 4 + c];
      numerator += delta * (pixel(x0 + i % w, y0 + Math.floor(i / w), c) - paper[i * 4 + c]);
      denominator += delta * delta;
      sprite[i * 4 + c] = color[c];
    }
    sprite[i * 4 + 3] = Math.round(clamp(numerator / Math.max(1, denominator), 0, 1) * 255);
  }
  const eraseMask = mask.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x])
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
      if (x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h) eraseMask[(y + dy) * w + x + dx] = 1;
  return { ...entry, x0, y0, w, h, paper, mask: eraseMask, sprite, color };
}

function traceGlyph(context, glyph) {
  context.beginPath();
  for (const { command, args } of glyph.path.commands) {
    if (['moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'closePath'].includes(command)) context[command](...args);
  }
  context.fill();
}

function normalizedMask(glyph, canvasFactory, fontGlyph = null) {
  const canvas = canvasFactory(40, 40), context = canvas.getContext('2d', { willReadFrequently: true });
  if (fontGlyph) {
    const b = fontGlyph.bbox, sx = 36 / Math.max(1, b.maxX - b.minX), sy = 36 / Math.max(1, b.maxY - b.minY);
    context.setTransform(sx, 0, 0, -sy, 2 - b.minX * sx, 2 + b.maxY * sy);
    traceGlyph(context, fontGlyph);
  } else {
    const source = canvasFactory(glyph.w, glyph.h), ctx = source.getContext('2d');
    const pixels = ctx.createImageData(glyph.w, glyph.h);
    pixels.data.set(glyph.sprite); ctx.putImageData(pixels, 0, 0);
    const b = glyph.bbox;
    context.drawImage(source, b.x0 - glyph.x0, b.y0 - glyph.y0, b.x1 - b.x0, b.y1 - b.y0, 2, 2, 36, 36);
  }
  const pixels = context.getImageData(0, 0, 40, 40).data;
  return Float32Array.from({ length: 1600 }, (_, i) => pixels[i * 4 + 3] / 255);
}

export function ocrMaskDistance(a, b) {
  let best = Infinity;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    let intersection = 0, total = 0;
    for (let y = 1; y < 39; y++) for (let x = 1; x < 39; x++) {
      const av = a[y * 40 + x], bv = b[(y + dy) * 40 + x + dx];
      intersection += Math.min(av, bv); total += av + bv;
    }
    best = Math.min(best, 1 - 2 * intersection / Math.max(.001, total));
  }
  return best;
}

export async function matchOcrRasterFont(model, { hint, fonts, fetchFont, fontkit, canvasFactory, report = () => {} }) {
  const korean = /[\uac00-\ud7a3]/.test(model.text);
  const defaults = korean ? ['notosanskr', 'nanum', 'myeongjo', 'kopubbatang', 'spoqa', 'ibmplexsanskr']
    : ['arimo', 'roboto', 'notoserif', 'librebaskerville', 'opensans', 'lato'];
  const keys = [...new Set([hint?.key, ...defaults])].filter(key => fonts[key] && (!korean || fonts[key].supportsKo));
  const seen = new Set();
  const samples = model.glyphs.filter(g => !g.blank && /[\p{L}\p{N}]/u.test(g.char) &&
    !seen.has(g.char) && seen.add(g.char)).slice(0, 10);
  if (!samples.length) throw ocrEditUnavailable('missing-font-samples');
  const masks = samples.map(g => normalizedMask(g, canvasFactory));
  let best = null;
  for (let ki = 0; ki < keys.length; ki++) {
    const key = keys[ki]; report(`${ki + 1}/${keys.length} 글꼴 비교 중`);
    for (const bold of [false, true]) {
      try {
        const record = await fetchFont(key, bold), base = fontkit.create(record.bytes);
        const variable = base.variationAxes?.wght;
        if (variable && bold) continue;
        for (const weight of variable ? [300, 400, 500, 600, 700] : [bold ? 700 : 400]) {
          const font = variable ? base.getVariation({ wght: weight }) : base;
          let score = 0, count = 0;
          for (let i = 0; i < samples.length; i++) {
            const g = font.glyphForCodePoint(samples[i].char.codePointAt(0));
            if (!g.id) continue;
            score += ocrMaskDistance(masks[i], normalizedMask(null, canvasFactory, g)); count++;
          }
          if (count !== samples.length) continue;
          score /= count;
          if (!best || score < best.score) best = { key, weight, bold: weight >= 600, font, record, score, match: 'visual' };
        }
      } catch (error) { console.warn(`[DaydayPDF:OCR font] ${key}`, error); }
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (!best) throw new Error('비교할 글꼴을 불러오지 못했습니다. 인터넷 연결을 확인하세요');
  return best;
}

export function calibrateOcrLayout(model, match) {
  const { font } = match;
  const sizes = model.glyphs.filter(g => !g.blank && /[\p{L}\p{N}]/u.test(g.char)).map(g => {
    const b = font.glyphForCodePoint(g.char.codePointAt(0)).bbox;
    return (g.bbox.y1 - g.bbox.y0) / Math.max(1, b.maxY - b.minY) * font.unitsPerEm;
  });
  const size = median(sizes);
  if (!(size > 0)) throw ocrEditUnavailable('invalid-font-size');
  const scale = size / font.unitsPerEm;
  const baseline = median(model.glyphs.filter(g => !g.blank).map(g =>
    g.bbox.y1 + font.glyphForCodePoint(g.char.codePointAt(0)).bbox.minY * scale));
  const glyphs = model.glyphs.map(g => ({ ...g }));
  for (const g of glyphs) if (!g.blank) {
    const fg = font.glyphForCodePoint(g.char.codePointAt(0));
    g.origin = g.bbox.x0 - fg.bbox.minX * scale;
  }
  for (let i = 0; i < glyphs.length; i++) if (glyphs[i].blank) {
    let prev = i - 1, next = i + 1;
    while (prev >= 0 && glyphs[prev].blank) prev--;
    while (next < glyphs.length && glyphs[next].blank) next++;
    const start = prev >= 0 ? glyphs[prev].origin + font.glyphForCodePoint(glyphs[prev].char.codePointAt(0)).advanceWidth * scale : 0;
    const end = next < glyphs.length ? glyphs[next].origin : start + (next - prev - 1) * size * .3;
    glyphs[i].origin = start + (end - start) * (i - prev - 1) / Math.max(1, next - prev - 1);
  }
  for (let i = 0; i < glyphs.length; i++) glyphs[i].advance = i + 1 < glyphs.length
    ? glyphs[i + 1].origin - glyphs[i].origin : font.glyphForCodePoint(glyphs[i].char.codePointAt(0)).advanceWidth * scale;
  const tracking = median(glyphs.slice(0, -1).filter(g => !g.blank).map(g =>
    g.advance - font.glyphForCodePoint(g.char.codePointAt(0)).advanceWidth * scale));
  return { ...model, glyphs, match, size, baseline, tracking };
}

export function assertOcrFontFit(scores) {
  if (!scores.length || scores.some(score => !Number.isFinite(score) || score > .42) ||
      scores.reduce((a, b) => a + b, 0) / scores.length > .28)
    throw ocrEditUnavailable('insufficient-font-match');
}

export function validateOcrAppearance(model, canvasFactory) {
  const { font } = model.match, scale = model.size / font.unitsPerEm, scores = [];
  for (const glyph of model.glyphs.filter(g => !g.blank)) {
    const fg = font.glyphForCodePoint(glyph.char.codePointAt(0));
    if (!fg.id) throw ocrEditUnavailable('missing-original-glyph');
    if (!/[\p{L}\p{N}]/u.test(glyph.char)) continue;
    scores.push(ocrMaskDistance(normalizedMask(glyph, canvasFactory), normalizedMask(null, canvasFactory, fg)));
    const sizeRatio = (glyph.bbox.y1 - glyph.bbox.y0) / Math.max(1, (fg.bbox.maxY - fg.bbox.minY) * scale);
    const baseline = glyph.bbox.y1 + fg.bbox.minY * scale;
    if (sizeRatio < .72 || sizeRatio > 1.35 || Math.abs(baseline - model.baseline) > model.size * .18)
      throw ocrEditUnavailable('inconsistent-character-geometry');
  }
  assertOcrFontFit(scores);
}

export function refineOcrGlyphBoxes(model, font) {
  const { image } = model, { width, height, data } = image;
  const limit = Math.min(width, model.recognitionWidth || width), columns = new Uint32Array(limit);
  const ink = new Uint8Array(width * height);
  for (let x = 0; x < limit; x++) {
    const top = [0, 1, 2].map(c => median([1, 2, 3, 4].map(y => data[(y * width + x) * 4 + c])));
    const bottom = [0, 1, 2].map(c => median([1, 2, 3, 4].map(y => data[((height - 1 - y) * width + x) * 4 + c])));
    for (let y = 5; y < height - 5; y++) {
      const t = y / (height - 1);
      let contrast = 0;
      for (let c = 0; c < 3; c++) contrast += (data[(y * width + x) * 4 + c] - (top[c] * (1 - t) + bottom[c] * t)) ** 2;
      if (contrast > 3 * 18 ** 2) { ink[y * width + x] = 1; columns[x]++; }
    }
  }
  const occupied = Array.from(columns, (count, x) => count > 1 ? x : -1).filter(x => x >= 0);
  if (!occupied.length) throw ocrEditUnavailable('missing-printed-ink');
  const symbols = chars(model.text), fg = symbols.map(c => font.glyphForCodePoint(c.codePointAt(0)));
  const advance = fg.map(g => g.advanceWidth), total = advance.reduce((a, b) => a + b, 0);
  const first = fg[0].bbox.minX || 0, last = fg.at(-1).bbox.maxX || fg.at(-1).advanceWidth;
  const unit = (occupied.at(-1) + 1 - occupied[0]) / (total - first - fg.at(-1).advanceWidth + last);
  const left = occupied[0] - first * unit;
  const ideals = [left];
  for (const a of advance) ideals.push(ideals.at(-1) + a * unit);
  const radius = Math.max(6, Math.round(font.unitsPerEm * unit * .32));
  let states = [{ x: clamp(Math.floor(left), 0, limit - 1), cost: 0, path: [] }];
  const prefix = new Uint32Array(limit + 1);
  for (let x = 0; x < limit; x++) prefix[x + 1] = prefix[x] + columns[x];
  for (let i = 1; i <= symbols.length; i++) {
    const expected = advance[i - 1] * unit;
    const lo = i === symbols.length ? clamp(Math.ceil(ideals[i]), 0, limit) : clamp(Math.round(ideals[i]) - radius, 0, limit);
    const hi = i === symbols.length ? lo : clamp(Math.round(ideals[i]) + radius, 0, limit);
    const next = [];
    for (let x = lo; x <= hi; x++) {
      let best = null;
      for (const prior of states) {
        const w = x - prior.x;
        if (w <= 0 || w < expected * .35 || w > expected * 1.9) continue;
        const cut = (columns[x - 1] || 0) + (columns[x] || 0);
        const gapInk = blank(symbols[i - 1]) ? (prefix[x] - prefix[prior.x]) / Math.max(1, w) : 0;
        const cost = prior.cost + ((w - expected) / Math.max(1, expected)) ** 2 * 2 + cut / height * 10 + gapInk;
        if (!best || cost < best.cost) best = { x, cost, path: [...prior.path, prior.x] };
      }
      if (best) next.push(best);
    }
    if (!next.length) throw ocrEditUnavailable('inseparable-spacing');
    states = next;
  }
  const best = states.sort((a, b) => a.cost - b.cost)[0], boundaries = [...best.path, best.x];
  return symbols.map((char, i) => {
    if (blank(char)) return { char, bbox: null };
    let x0 = limit, x1 = 0, y0 = height, y1 = 0;
    for (let x = boundaries[i]; x < boundaries[i + 1]; x++) for (let y = 5; y < height - 5; y++) {
      if (!ink[y * width + x]) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
    }
    if (x1 <= x0 || y1 <= y0) throw ocrEditUnavailable('missing-character-ink');
    return { char, bbox: { x0, y0, x1, y1 } };
  });
}

export function composeOcrRasterEdit(model, newText, canvasFactory, { restyle = false, color = null } = {}) {
  const next = chars(newText), { font } = model.match, scale = model.size / font.unitsPerEm;
  const edits = ocrEditDiff(model.text, newText), placements = [];
  let shift = 0, cursor = model.glyphs[0]?.origin || 0;
  for (let i = 0; i < edits.length;) {
    if (edits[i].same) {
      const edit = edits[i++], old = model.glyphs[edit.old];
      placements.push({ char: next[edit.next], old: edit.old, x: old.origin + shift, changed: restyle });
      cursor = old.origin + shift + old.advance;
      continue;
    }
    const group = [];
    while (i < edits.length && !edits[i].same) group.push(edits[i++]);
    const old = group.filter(e => e.old !== null).map(e => model.glyphs[e.old]);
    const added = group.filter(e => e.next !== null);
    const start = old.length ? old[0].origin + shift : cursor;
    const oldWidth = old.reduce((sum, g) => sum + g.advance, 0);
    let advance = 0;
    for (let j = 0; j < added.length; j++) {
      const char = next[added[j].next], fg = font.glyphForCodePoint(char.codePointAt(0));
      if (!blank(char) && !fg.id) throw new Error('선택한 글꼴에 입력한 글자가 없습니다');
      const x = old.length === added.length ? old[j].origin + shift : start + advance;
      placements.push({ char, old: added[j].old, x, changed: true });
      advance += old.length === added.length ? old[j].advance : fg.advanceWidth * scale + model.tracking;
    }
    shift += advance - oldWidth; cursor = start + advance;
  }
  const canvas = canvasFactory(model.image.width, model.image.height), context = canvas.getContext('2d');
  const patch = context.createImageData(canvas.width, canvas.height);
  const retained = new Set(placements.filter(p => !p.changed && p.old !== null &&
    Math.abs(p.x - model.glyphs[p.old].origin) < .01).map(p => p.old));
  const kept = [...retained].map(i => model.glyphs[i].bbox).filter(Boolean);
  for (let gi = 0; gi < model.glyphs.length; gi++) {
    const g = model.glyphs[gi];
    if (g.blank || retained.has(gi)) continue;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const si = y * g.w + x;
      const px = g.x0 + x, py = g.y0 + y;
      if (g.mask[si] && !kept.some(b => px >= b.x0 - 1 && px <= b.x1 && py >= b.y0 - 1 && py <= b.y1))
        patch.data.set(g.paper.subarray(si * 4, si * 4 + 4), (py * canvas.width + px) * 4);
    }
  }
  context.putImageData(patch, 0, 0);
  const boxes = [];
  for (const placement of placements) {
    const old = placement.old === null ? null : model.glyphs[placement.old];
    if (blank(placement.char)) { boxes.push({ char: placement.char, bbox: null }); continue; }
    if (!placement.changed && old) {
      const dx = placement.x - old.origin;
      boxes.push({ char: placement.char, bbox: { ...old.bbox, x0: old.bbox.x0 + dx, x1: old.bbox.x1 + dx } });
      if (retained.has(placement.old)) continue;
      const sprite = canvasFactory(old.w, old.h), sc = sprite.getContext('2d'), pixels = sc.createImageData(old.w, old.h);
      pixels.data.set(old.sprite); sc.putImageData(pixels, 0, 0);
      context.drawImage(sprite, old.x0 + dx, old.y0);
    } else {
      const fg = font.glyphForCodePoint(placement.char.codePointAt(0)), b = fg.bbox;
      const reference = old && !old.blank ? old : model.glyphs.filter(g => !g.blank)
        .reduce((a, b) => Math.abs(a.origin - placement.x) < Math.abs(b.origin - placement.x) ? a : b);
      const fill = color || `rgb(${reference.color.join(',')})`;
      const rb = font.glyphForCodePoint(reference.char.codePointAt(0)).bbox;
      const localScale = restyle ? scale : clamp((reference.bbox.y1 - reference.bbox.y0) / Math.max(1, rb.maxY - rb.minY), scale * .65, scale * 1.4);
      const baseline = restyle ? model.baseline : reference.bbox.y1 + rb.minY * localScale;
      const origin = placement.x + (restyle ? 0 : rb.minX * (scale - localScale));
      const bbox = { x0: origin + b.minX * localScale, x1: origin + b.maxX * localScale,
        y0: baseline - b.maxY * localScale, y1: baseline - b.minY * localScale };
      if (bbox.x0 < 0 || bbox.x1 > canvas.width || bbox.y0 < 0 || bbox.y1 > canvas.height)
        throw new Error('수정한 글자가 원래 문장 영역을 벗어납니다. 내용을 줄여 주세요');
      context.save(); context.fillStyle = fill;
      context.setTransform(localScale, 0, 0, -localScale, origin, baseline);
      traceGlyph(context, fg); context.restore();
      boxes.push({ char: placement.char, bbox });
    }
  }
  if (boxes.some(g => g.bbox && (g.bbox.x0 < 0 || g.bbox.x1 > canvas.width)))
    throw new Error('수정한 글자가 원래 문장 영역을 벗어납니다. 내용을 줄여 주세요');
  const originalRight = Math.max(...model.glyphs.filter(g => !g.blank).map(g => g.bbox.x1));
  for (let i = 0; i < placements.length; i++) {
    const placement = placements[i], b = boxes[i]?.bbox;
    if (!b || (retained.has(placement.old) && !placement.changed)) continue;
    if (kept.some(k => Math.min(k.x1, b.x1) - Math.max(k.x0, b.x0) > 1 && Math.min(k.y1, b.y1) - Math.max(k.y0, b.y0) > 1))
      throw new Error('수정한 글자가 옆 글자와 겹칩니다. 내용을 조정해 주세요');
    let occupied = 0;
    for (let x = Math.max(Math.ceil(originalRight + 2), Math.floor(b.x0)); x < Math.ceil(b.x1); x++) {
      for (let y = Math.floor(b.y0); y < Math.ceil(b.y1); y++) {
        const t = y / Math.max(1, model.image.height - 1);
        let delta = 0;
        for (let c = 0; c < 3; c++) {
          const top = model.image.data[x * 4 + c], bottom = model.image.data[((model.image.height - 1) * canvas.width + x) * 4 + c];
          delta += (model.image.data[(y * canvas.width + x) * 4 + c] - (top * (1 - t) + bottom * t)) ** 2;
        }
        if (delta > 3 * 35 ** 2) occupied++;
      }
    }
    if (occupied > 8) throw new Error('수정한 글자가 주변 내용과 겹칩니다. 내용을 줄여 주세요');
  }
  const rendered = context.getImageData(0, 0, canvas.width, canvas.height);
  const flattened = context.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    if (kept.some(b => x >= b.x0 - 1 && x <= b.x1 && y >= b.y0 - 1 && y <= b.y1)) continue;
    let touched = false;
    for (let dy = -1; dy <= 1 && !touched; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (x + dx >= 0 && x + dx < canvas.width && y + dy >= 0 && y + dy < canvas.height &&
        rendered.data[((y + dy) * canvas.width + x + dx) * 4 + 3]) { touched = true; break; }
    }
    if (!touched) continue;
    const offset = (y * canvas.width + x) * 4, alpha = rendered.data[offset + 3] / 255;
    for (let c = 0; c < 3; c++) flattened.data[offset + c] =
      Math.round(rendered.data[offset + c] * alpha + model.image.data[offset + c] * (1 - alpha));
    flattened.data[offset + 3] = 255;
  }
  context.putImageData(flattened, 0, 0);
  return { canvas, pixels: flattened, protectedBounds: kept, glyphs: boxes, text: newText };
}

export function opaqueOcrPatchImages(model, patch, canvasFactory) {
  const { width, height } = model.image, pixels = patch.pixels.data, columns = new Uint8Array(width);
  for (let x = 0; x < width; x++) {
    if (patch.protectedBounds.some(b => x >= b.x0 - 1 && x <= b.x1)) continue;
    for (let y = 0; y < height; y++) if (pixels[(y * width + x) * 4 + 3]) { columns[x] = 1; break; }
  }
  const parts = [];
  for (let x = 0; x < width;) {
    if (!columns[x]) { x++; continue; }
    const x0 = x;
    while (x < width && columns[x]) x++;
    const x1 = x;
    let y0 = height, y1 = 0;
    for (let xx = x0; xx < x1; xx++) for (let y = 0; y < height; y++) if (pixels[(y * width + xx) * 4 + 3]) {
      y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
    }
    const canvas = canvasFactory(x1 - x0, y1 - y0), context = canvas.getContext('2d');
    const image = context.createImageData(canvas.width, canvas.height);
    for (let y = y0; y < y1; y++) for (let xx = x0; xx < x1; xx++) {
      const source = (y * width + xx) * 4, target = ((y - y0) * canvas.width + xx - x0) * 4;
      image.data.set((pixels[source + 3] ? pixels : model.image.data).subarray(source, source + 3), target);
      image.data[target + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    parts.push({ canvas, x: x0, y: y0 });
  }
  return parts;
}

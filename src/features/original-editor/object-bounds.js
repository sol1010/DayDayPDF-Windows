function intersect(a, b) {
  const left = Math.max(a[0], b[0]), bottom = Math.max(a[1], b[1]);
  const right = Math.min(a[2], b[2]), top = Math.min(a[3], b[3]);
  return left <= right && bottom <= top ? [left, bottom, right, top] : null;
}

function union(a, b) {
  if (!a) return b;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

function transformBounds([l, b, r, t], [a, s, c, d, x, y]) {
  return [
    x + Math.min(a*l, a*r) + Math.min(c*b, c*t), y + Math.min(s*l, s*r) + Math.min(d*b, d*t),
    x + Math.max(a*l, a*r) + Math.max(c*b, c*t), y + Math.max(s*l, s*r) + Math.max(d*b, d*t),
  ];
}

function compose([a,b,c,d,e,f], [g,h,i,j,k,l]) {
  return [a*g+c*h, b*g+d*h, a*i+c*j, b*i+d*j, a*k+c*l+e, b*k+d*l+f];
}

function clippedBounds(lib, mod, object, buf, bounds) {
  const clip = lib.FPDFPageObj_GetClipPath(object);
  const count = clip ? lib.FPDFClipPath_CountPaths(clip) : 0;
  for (let i = 0; i < count; i++) {
    let left = Infinity, bottom = Infinity, right = -Infinity, top = -Infinity;
    const segments = lib.FPDFClipPath_CountPathSegments(clip, i);
    if (segments === 0) return null;
    for (let j = 0; j < segments; j++) {
      const segment = lib.FPDFClipPath_GetPathSegment(clip, i, j);
      if (!lib.FPDFPathSegment_GetPoint(segment, buf, buf + 4)) { left = Infinity; break; }
      const x = mod.HEAPF32[buf / 4], y = mod.HEAPF32[buf / 4 + 1];
      left = Math.min(left, x); bottom = Math.min(bottom, y);
      right = Math.max(right, x); top = Math.max(top, y);
    }
    if (left === Infinity) continue;
    bounds = intersect(bounds, [left, bottom, right, top]);
    if (!bounds) return null;
  }
  return bounds;
}

export function pdfObjectBounds(lib, mod, object, type, buf, parent = null, limit = null) {
  if (!lib.FPDFPageObj_GetBounds(object, buf, buf+4, buf+8, buf+12)) return null;
  let bounds = Array.from(new Float32Array(mod.HEAPU8.buffer, buf, 4));
  if (!parent && type !== 5 && type !== 3) return bounds;
  bounds = clippedBounds(lib, mod, object, buf, bounds);
  if (!bounds) return null;
  if (parent) bounds = intersect(transformBounds(bounds, parent), limit);
  if (!bounds || type !== 5 || !lib.FPDFPageObj_GetMatrix(object, buf)) return bounds;
  const matrix = Array.from(new Float32Array(mod.HEAPU8.buffer, buf, 6));
  const toPage = parent ? compose(parent, matrix) : matrix;
  const count = lib.FPDFFormObj_CountObjects(object);
  if (count < 0) return bounds;
  let visible = null;
  for (let i = 0; i < count; i++) {
    const child = lib.FPDFFormObj_GetObject(object, i);
    if (!child) continue;
    const box = pdfObjectBounds(lib, mod, child, lib.FPDFPageObj_GetType(child), buf, toPage, bounds);
    if (box) {
      visible = union(visible, box);
      if (visible.every((value, index) => value === bounds[index])) break;
    }
  }
  return visible;
}

export function transformPdfObject(lib, object, matrix) {
  lib.FPDFPageObj_Transform(object, ...matrix);
  const type = lib.FPDFPageObj_GetType(object);
  if (type === 5 || type === 3) lib.FPDFPageObj_TransformClipPath(object, ...matrix);
}

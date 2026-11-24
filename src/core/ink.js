export const INK_BRUSHES = Object.freeze({
  pen: { width: 2.5, color: '#243d51', opacity: 1 },
  pencil: { width: 2, color: '#454545', opacity: .8 },
  marker: { width: 9, color: '#2462af', opacity: .9 },
  highlighter: { width: 18, color: '#ffd43b', opacity: .35 },
});
export const INK_POINT_LIMIT = 4096;

function simplifySamples(points, tolerance = .2) {
  if (points.length < 3) return points;
  const keep = new Set([0, points.length - 1]), stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop(), a = points[first], b = points[last];
    const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
    let farthest = -1, error = tolerance;
    for (let i = first + 1; i < last; i++) {
      const p = points[i], t = length2 ? Math.max(0, Math.min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length2)) : 0;
      const distance = Math.hypot(p[0]-a[0]-dx*t, p[1]-a[1]-dy*t);
      const pressureError = Math.abs((p[2] ?? .5) - ((a[2] ?? .5)*(1-t)+(b[2] ?? .5)*t)) * 10;
      if (Math.max(distance, pressureError) > error) { error = Math.max(distance, pressureError); farthest = i; }
    }
    if (farthest >= 0) { keep.add(farthest); stack.push([first,farthest],[farthest,last]); }
  }
  return points.filter((_, i) => keep.has(i));
}

export function createInkObject(samples, pageWidth, pageHeight, style = {}) {
  if (!(pageWidth > 0 && pageHeight > 0)) return null;
  const valid = samples.filter(p => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!valid.length) return null;
  const stride = Math.max(1, Math.ceil((valid.length - 1) / (INK_POINT_LIMIT - 1)));
  const points = simplifySamples(valid.filter((_, i) => i % stride === 0 || i === valid.length - 1));
  const brush = Object.hasOwn(INK_BRUSHES, style.brush) ? style.brush : 'pen';
  const sw = Math.max(.1, Math.min(40, +style.sw || INK_BRUSHES[brush].width));
  const pad = sw * .8 + .5;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const [x, y] of points) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  left -= pad; top -= pad; right += pad; bottom += pad;
  const inkW = right - left, inkH = bottom - top;
  return {
    type: 'ink', brush, sw, stroke: style.stroke || INK_BRUSHES[brush].color,
    strokeOp: Math.max(.01, Math.min(1, style.strokeOp ?? INK_BRUSHES[brush].opacity)),
    fx: left / pageWidth, fy: top / pageHeight, fw: inkW / pageWidth, fh: inkH / pageHeight,
    inkW, inkH,
    points: points.map(([x, y, p = .5]) => [+(x - left).toFixed(3), +(y - top).toFixed(3), +Math.max(.05, Math.min(1, p)).toFixed(3)]),
  };
}

function smooth(points) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    out.push(a.map((n, k) => n * .75 + b[k] * .25), a.map((n, k) => n * .25 + b[k] * .75));
  }
  out.push(points.at(-1));
  return out;
}

export function inkGeometry(object, width = object.inkW, height = object.inkH) {
  if (!object.points?.length || !(object.inkW > 0 && object.inkH > 0)) return [];
  const sx = width / object.inkW, sy = height / object.inkH;
  const brush = object.brush || 'pen', sw = Math.max(.1, +object.sw || 1);
  const points = smooth(object.points.slice(0, INK_POINT_LIMIT));
  const radius = (point, i) => sw / 2 * (brush === 'pen' ? .4 + .6 * (point[2] ?? .5) * 2 :
    brush === 'pencil' ? .45 + .2 * Math.sin(i * 2.399) + .35 * (point[2] ?? .5) : 1);
  const polygons = [];
  const oval = (p, r) => Array.from({ length: 12 }, (_, i) => {
    const angle = i * Math.PI / 6;
    return [p[0] + Math.cos(angle) * r, p[1] + Math.sin(angle) * r];
  });
  for (let i = 0; i < points.length; i++) {
    const p = points[i], r = radius(p, i);
    if (brush === 'marker') {
      polygons.push([[p[0] - r, p[1] - r * .35], [p[0] + r, p[1] - r * .35],
        [p[0] + r, p[1] + r * .35], [p[0] - r, p[1] + r * .35]]);
    } else polygons.push(oval(p, r));
    if (!i) continue;
    const a = points[i - 1], ra = radius(a, i - 1), dx = p[0] - a[0], dy = p[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length < .001) continue;
    if (brush === 'marker') {
      const corners = [a, p].flatMap(q => [[q[0]-r,q[1]-r*.35],[q[0]+r,q[1]-r*.35],[q[0]+r,q[1]+r*.35],[q[0]-r,q[1]+r*.35]]);
      corners.sort((u, v) => u[0] - v[0] || u[1] - v[1]);
      const cross = (u, v, w) => (v[0]-u[0])*(w[1]-u[1])-(v[1]-u[1])*(w[0]-u[0]);
      const half = list => { const h=[]; for (const q of list) { while(h.length>1 && cross(h.at(-2),h.at(-1),q)<=0)h.pop(); h.push(q); } return h.slice(0,-1); };
      polygons.push([...half(corners), ...half([...corners].reverse())]);
    } else {
      const nx = -dy / length, ny = dx / length;
      polygons.push([[a[0]-nx*ra,a[1]-ny*ra],[p[0]-nx*r,p[1]-ny*r],
        [p[0]+nx*r,p[1]+ny*r],[a[0]+nx*ra,a[1]+ny*ra]]);
    }
  }
  return polygons.map(polygon => polygon.map(([x, y]) => [x * sx, y * sy]));
}

export function inkSvgPath(polygons) {
  return polygons.map(polygon => polygon.map(([x, y], i) =>
    `${i ? 'L' : 'M'}${+x.toFixed(3)},${+y.toFixed(3)}`).join(' ') + ' Z').join(' ');
}

export function resizeObjectBox(start, direction, dx, dy, proportional = false) {
  const angle = (start.rot || 0) * Math.PI / 180;
  const c = Math.cos(angle), s = Math.sin(angle);
  const px = dx * c + dy * s, py = -dx * s + dy * c;
  const dir = direction.replace(/[ewns]/g, side =>
    start.flipX && side === 'e' ? 'w' : start.flipX && side === 'w' ? 'e' :
    start.flipY && side === 'n' ? 's' : start.flipY && side === 's' ? 'n' : side);
  const hx = dir.includes('e') ? 1 : dir.includes('w') ? -1 : 0;
  const hy = dir.includes('s') ? 1 : dir.includes('n') ? -1 : 0;
  let w = start.w + hx * px, h = start.h + hy * py;
  if (proportional && hx && hy && start.w * start.w + start.h * start.h > 0) {
    const scale = 1 + (px * start.w * hx + py * start.h * hy) /
      (start.w * start.w + start.h * start.h);
    w = start.w * scale; h = start.h * scale;
  }
  const ox = hx * (w - start.w) / 2, oy = hy * (h - start.h) / 2;
  const cx = start.l + start.w / 2 + ox * c - oy * s;
  const cy = start.t + start.h / 2 + ox * s + oy * c;
  return { l: cx - Math.abs(w) / 2, t: cy - Math.abs(h) / 2,
    w: Math.abs(w), h: Math.abs(h),
    flipX: !!start.flipX !== (w < 0), flipY: !!start.flipY !== (h < 0) };
}

export function objectReflectionMatrix(cx, cy, degrees, flipX, flipY) {
  const angle = degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const x = flipX ? -1 : 1, y = flipY ? -1 : 1;
  const a = x * c * c + y * s * s, b = (x - y) * c * s;
  const d = x * s * s + y * c * c;
  return [a, b, b, d, cx - a * cx - b * cy, cy - b * cx - d * cy];
}

export function originalResizeMatrix(start, next, toDisplay, toPage) {
  if (!start.w || !start.h || !next.w || !next.h) return null;
  const sx = next.w / start.w * (next.flipX ? -1 : 1);
  const sy = next.h / start.h * (next.flipY ? -1 : 1);
  const tx = next.l + (next.flipX ? next.w : 0);
  const ty = next.t + (next.flipY ? next.h : 0);
  const map = (x, y) => {
    const p = toDisplay(x, y);
    return toPage(tx + (p[0] - start.l) * sx, ty + (p[1] - start.t) * sy);
  };
  const o = map(0, 0), x = map(1, 0), y = map(0, 1);
  return [x[0] - o[0], x[1] - o[1], y[0] - o[0], y[1] - o[1], ...o];
}

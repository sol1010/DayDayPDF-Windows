export function objRotation(object) {
  const value = +(object && object.rot);
  return Number.isFinite(value) ? value : 0;
}

export function normRotation(degrees) {
  const value = degrees % 360;
  return Math.abs(value) < 0.01 ? 0 : (value < 0 ? value + 360 : value);
}

export function rotateScreenDelta(dx, dy, degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [dx * cosine - dy * sine, dx * sine + dy * cosine];
}

export function rotateScreenPoint(x, y, centerX, centerY, degrees) {
  const [dx, dy] = rotateScreenDelta(x - centerX, y - centerY, degrees);
  return [centerX + dx, centerY + dy];
}

export function rotatePolylinePoints(points, width, height, degrees) {
  if (!points.length) return [];
  const pageWidth = Math.max(1, +width || 1), pageHeight = Math.max(1, +height || 1);
  const xs = points.map(point => point[0] * pageWidth);
  const ys = points.map(point => point[1] * pageHeight);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  return points.map((point, index) => {
    const [x, y] = rotateScreenPoint(xs[index], ys[index], centerX, centerY, degrees);
    return [x / pageWidth, y / pageHeight];
  });
}

export function constrainPolylineVertex(points, index, point, closed = false) {
  const anchorIndex = index > 0 ? index - 1 : closed ? points.length - 1 : 1;
  const anchor = points[anchorIndex];
  return anchor ? [anchor[0], point[1]] : [...point];
}

export function unrotFrac(dx, dy, totalRotation) {
  if (totalRotation === 90) return [dy, 1 - dx];
  if (totalRotation === 180) return [1 - dx, 1 - dy];
  if (totalRotation === 270) return [1 - dy, dx];
  return [dx, dy];
}

export function rotFrac(u, v, totalRotation) {
  if (totalRotation === 90) return [1 - v, u];
  if (totalRotation === 180) return [1 - u, 1 - v];
  if (totalRotation === 270) return [v, 1 - u];
  return [u, v];
}

export function pagePtToFrac(page, view, totalRotation, x, y) {
  const pageWidth = view[2] - view[0];
  const pageHeight = view[3] - view[1];
  const u = (x - view[0]) / pageWidth;
  const v = 1 - (y - view[1]) / pageHeight;
  let [dx, dy] = rotFrac(u, v, totalRotation);
  if (page.resize) {
    const sideways = totalRotation === 90 || totalRotation === 270;
    const width = sideways ? pageHeight : pageWidth;
    const height = sideways ? pageWidth : pageHeight;
    const [tw, th] = page.resize, fit = Math.min(tw / width, th / height);
    dx = ((tw - width * fit) / 2 + dx * width * fit) / tw;
    dy = ((th - height * fit) / 2 + dy * height * fit) / th;
  }
  if (page.crop) {
    dx = (dx - page.crop[0]) / page.crop[2];
    dy = (dy - page.crop[1]) / page.crop[3];
  }
  return [dx, dy];
}

export function pageFracToPt(page, view, totalRotation, dx, dy) {
  if (page.crop) {
    dx = page.crop[0] + dx * page.crop[2];
    dy = page.crop[1] + dy * page.crop[3];
  }
  const width = view[2] - view[0], height = view[3] - view[1];
  if (page.resize) {
    const sideways = totalRotation === 90 || totalRotation === 270;
    const dw = sideways ? height : width, dh = sideways ? width : height;
    const [tw, th] = page.resize, fit = Math.min(tw / dw, th / dh);
    dx = (dx * tw - (tw - dw * fit) / 2) / (dw * fit);
    dy = (dy * th - (th - dh * fit) / 2) / (dh * fit);
  }
  const [u, v] = unrotFrac(dx, dy, totalRotation);
  return [view[0] + u * width, view[1] + (1 - v) * height];
}

export function regionPdfBounds(page, view, rotation, fx, fy, fw, fh) {
  const a = pageFracToPt(page, view, rotation, fx, fy);
  const b = pageFracToPt(page, view, rotation, fx + fw, fy + fh);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

export function pageRectToDispRect(page, view, totalRotation, box) {
  const corners = [
    [box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]],
  ].map(([x, y]) => pagePtToFrac(page, view, totalRotation, x, y));
  const xs = corners.map(corner => corner[0]);
  const ys = corners.map(corner => corner[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    l: left,
    t: top,
    w: Math.max(...xs) - left,
    h: Math.max(...ys) - top,
  };
}

export function cropToViewportPoints(crop, viewportWidth, viewportHeight) {
  const [x, y, width, height] = crop;
  return [
    [x * viewportWidth, y * viewportHeight],
    [(x + width) * viewportWidth, (y + height) * viewportHeight],
  ];
}

export function cropSelectionRectFromPoints(start, end, viewportWidth, viewportHeight) {
  if (!(viewportWidth > 0) || !(viewportHeight > 0))
    throw new RangeError('자르기 미리보기 크기가 올바르지 않습니다');
  const clampX = value => Math.max(0, Math.min(viewportWidth, Number.isFinite(+value) ? +value : 0));
  const clampY = value => Math.max(0, Math.min(viewportHeight, Number.isFinite(+value) ? +value : 0));
  const sx = clampX(start?.[0]);
  const sy = clampY(start?.[1]);
  const ex = clampX(end?.[0]);
  const ey = clampY(end?.[1]);
  return {
    x: Math.min(sx, ex),
    y: Math.min(sy, ey),
    w: Math.abs(ex - sx),
    h: Math.abs(ey - sy),
  };
}

export function tappedCropSelectionRect(point, viewportWidth, viewportHeight) {
  if (!(viewportWidth > 0) || !(viewportHeight > 0))
    throw new RangeError('자르기 미리보기 크기가 올바르지 않습니다');
  const width = Math.min(viewportWidth, Math.max(48, viewportWidth * .56));
  const height = Math.min(viewportHeight, Math.max(48, viewportHeight * .42));
  const px = Math.max(0, Math.min(viewportWidth, Number.isFinite(+point?.[0]) ? +point[0] : 0));
  const py = Math.max(0, Math.min(viewportHeight, Number.isFinite(+point?.[1]) ? +point[1] : 0));
  return {
    x: Math.max(0, Math.min(viewportWidth - width, px - width / 2)),
    y: Math.max(0, Math.min(viewportHeight - height, py - height / 2)),
    w: width,
    h: height,
  };
}

export function pdfRectToViewport(viewport, rectangle) {
  if (!viewport || !Array.isArray(rectangle) || rectangle.length < 4)
    throw new TypeError('viewport와 PDF 사각형이 필요합니다');
  if (typeof viewport.convertToViewportRectangle === 'function')
    return viewport.convertToViewportRectangle(rectangle);

  const point = (x, y) => {
    if (typeof viewport.convertToViewportPoint === 'function')
      return viewport.convertToViewportPoint(x, y);
    const transform = viewport.transform;
    if (!Array.isArray(transform) && !ArrayBuffer.isView(transform))
      throw new TypeError('viewport 좌표 변환 함수를 찾지 못했습니다');
    if (transform.length < 6) throw new TypeError('viewport transform이 올바르지 않습니다');
    return [
      transform[0] * x + transform[2] * y + transform[4],
      transform[1] * x + transform[3] * y + transform[5],
    ];
  };
  const first = point(rectangle[0], rectangle[1]);
  const second = point(rectangle[2], rectangle[3]);
  return [first[0], first[1], second[0], second[1]];
}

export function pdfPointBounds(a, b) {
  return {
    x: Math.min(a[0], b[0]),
    y: Math.min(a[1], b[1]),
    w: Math.abs(b[0] - a[0]),
    h: Math.abs(b[1] - a[1]),
  };
}

export function resizedCropGeometry(resize, crop = null) {
  const [fullWidth, fullHeight] = resize;
  const [x, y, width, height] = crop || [0, 0, 1, 1];
  const visibleWidth = fullWidth * width;
  const visibleHeight = fullHeight * height;
  const left = fullWidth * x;
  const top = fullHeight * y;
  return {
    fullWidth,
    fullHeight,
    width: visibleWidth,
    height: visibleHeight,
    left,
    top,
    bottom: fullHeight - top - visibleHeight,
  };
}

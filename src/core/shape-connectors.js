export const CONNECTABLE_SHAPE_TYPES = Object.freeze(['rect', 'ellipse', 'triangle', 'star']);
export const CONNECTOR_STYLES = Object.freeze(['straight', 'angled', 'curve', 'step']);
export const CONNECTOR_ANCHORS = Object.freeze(['side-midpoints', 'edge']);
export const ARROW_END_TYPES = Object.freeze([
  'none', 'circle-filled', 'circle-open', 'square', 'arrow-filled', 'arrow-open',
]);

const CONNECTABLE = new Set(CONNECTABLE_SHAPE_TYPES);

export function isConnectableShape(object) {
  return !!object && CONNECTABLE.has(object.type);
}

export function shapeUnitPolygon(type) {
  if (type === 'triangle') return [[0, -.5], [.5, .5], [-.5, .5]];
  if (type === 'star') {
    const points = [];
    for (let index = 0; index < 10; index++) {
      const radius = index % 2 ? .22 : .5;
      const angle = -Math.PI / 2 + index * Math.PI / 5;
      points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
    return points;
  }
  return [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]];
}

function rotate(x, y, degrees) {
  if (!degrees) return [x, y];
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  return [x * cosine - y * sine, x * sine + y * cosine];
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function polygonRayScale(dx, dy, points) {
  let nearest = Infinity;
  for (let index = 0; index < points.length; index++) {
    const a = points[index], b = points[(index + 1) % points.length];
    const sx = b[0] - a[0], sy = b[1] - a[1];
    const denominator = cross(dx, dy, sx, sy);
    if (Math.abs(denominator) < 1e-9) continue;
    const rayScale = cross(a[0], a[1], sx, sy) / denominator;
    const edgeScale = cross(a[0], a[1], dx, dy) / denominator;
    if (rayScale >= 0 && edgeScale >= -1e-7 && edgeScale <= 1 + 1e-7)
      nearest = Math.min(nearest, rayScale);
  }
  return Number.isFinite(nearest) ? nearest : 0;
}

export function shapeBoundaryPoint(shape, towardX, towardY, width = 1, height = 1) {
  if (!isConnectableShape(shape)) return null;
  const pageWidth = Math.max(1e-6, +width || 1), pageHeight = Math.max(1e-6, +height || 1);
  const objectWidth = Math.max(1e-6, Math.abs(+shape.fw || 0) * pageWidth);
  const objectHeight = Math.max(1e-6, Math.abs(+shape.fh || 0) * pageHeight);
  const centerX = (+shape.fx + (+shape.fw || 0) / 2) * pageWidth;
  const centerY = (+shape.fy + (+shape.fh || 0) / 2) * pageHeight;
  let dx = (+towardX || 0) * pageWidth - centerX;
  let dy = (+towardY || 0) * pageHeight - centerY;
  [dx, dy] = rotate(dx, dy, -(+shape.rot || 0));
  if (Math.hypot(dx, dy) < 1e-7) dx = -1;

  const halfWidth = objectWidth / 2, halfHeight = objectHeight / 2;
  let scale;
  if (shape.type === 'ellipse') {
    scale = 1 / Math.sqrt((dx * dx) / (halfWidth * halfWidth) + (dy * dy) / (halfHeight * halfHeight));
  } else {
    const points = shapeUnitPolygon(shape.type).map(([x, y]) => [x * objectWidth * (shape.flipX ? -1 : 1), y * objectHeight * (shape.flipY ? -1 : 1)]);
    scale = polygonRayScale(dx, dy, points);
  }
  if (!Number.isFinite(scale) || scale <= 0) scale = 0;
  let localX = dx * scale, localY = dy * scale;
  [localX, localY] = rotate(localX, localY, +shape.rot || 0);
  return [(centerX + localX) / pageWidth, (centerY + localY) / pageHeight];
}

export function shapeSideMidpoint(shape, towardX, towardY, width = 1, height = 1) {
  if (!isConnectableShape(shape)) return null;
  const pageWidth = Math.max(1e-6, +width || 1), pageHeight = Math.max(1e-6, +height || 1);
  const objectWidth = Math.max(1e-6, Math.abs(+shape.fw || 0) * pageWidth);
  const objectHeight = Math.max(1e-6, Math.abs(+shape.fh || 0) * pageHeight);
  const centerX = (+shape.fx + (+shape.fw || 0) / 2) * pageWidth;
  const centerY = (+shape.fy + (+shape.fh || 0) / 2) * pageHeight;
  let dx = (+towardX || 0) * pageWidth - centerX;
  let dy = (+towardY || 0) * pageHeight - centerY;
  [dx, dy] = rotate(dx, dy, -(+shape.rot || 0));
  let directionX = 0, directionY = 0;
  if (Math.abs(dx) / objectWidth >= Math.abs(dy) / objectHeight)
    directionX = dx >= 0 ? 1 : -1;
  else directionY = dy >= 0 ? 1 : -1;
  [directionX, directionY] = rotate(directionX, directionY, +shape.rot || 0);
  const reach = Math.max(pageWidth, pageHeight, objectWidth, objectHeight) * 4;
  return shapeBoundaryPoint(shape,
    (centerX + directionX * reach) / pageWidth,
    (centerY + directionY * reach) / pageHeight,
    pageWidth, pageHeight);
}

export function shapeSideMidpoints(shape, width = 1, height = 1) {
  if (!isConnectableShape(shape)) return [];
  const pageWidth = Math.max(1e-6, +width || 1), pageHeight = Math.max(1e-6, +height || 1);
  const centerX = (+shape.fx + (+shape.fw || 0) / 2) * pageWidth;
  const centerY = (+shape.fy + (+shape.fh || 0) / 2) * pageHeight;
  const reach = Math.max(pageWidth, pageHeight) * 4;
  return [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([x, y]) => {
    const [dx, dy] = rotate(x, y, +shape.rot || 0);
    return shapeBoundaryPoint(shape,
      (centerX + dx * reach) / pageWidth,
      (centerY + dy * reach) / pageHeight,
      pageWidth, pageHeight);
  }).filter(Boolean);
}

export function shapeAnchorVector(shape, towardX, towardY, width = 1, height = 1) {
  if (!isConnectableShape(shape)) return null;
  const pageWidth = Math.max(1e-6, +width || 1), pageHeight = Math.max(1e-6, +height || 1);
  const objectWidth = Math.max(1e-6, Math.abs(+shape.fw || 0) * pageWidth);
  const objectHeight = Math.max(1e-6, Math.abs(+shape.fh || 0) * pageHeight);
  const centerX = (+shape.fx + (+shape.fw || 0) / 2) * pageWidth;
  const centerY = (+shape.fy + (+shape.fh || 0) / 2) * pageHeight;
  let dx = (+towardX || 0) * pageWidth - centerX;
  let dy = (+towardY || 0) * pageHeight - centerY;
  [dx, dy] = rotate(dx, dy, -(+shape.rot || 0));
  if (Math.hypot(dx, dy) < 1e-7) dx = -objectWidth;
  return [dx / objectWidth * (shape.flipX ? -1 : 1), dy / objectHeight * (shape.flipY ? -1 : 1)];
}

export function shapeBoundaryNormal(shape, anchorX, anchorY, width = 1, height = 1) {
  if (!isConnectableShape(shape)) return null;
  const pageWidth = Math.max(1e-6, +width || 1), pageHeight = Math.max(1e-6, +height || 1);
  const objectWidth = Math.max(1e-6, Math.abs(+shape.fw || 0) * pageWidth);
  const objectHeight = Math.max(1e-6, Math.abs(+shape.fh || 0) * pageHeight);
  const centerX = (+shape.fx + (+shape.fw || 0) / 2) * pageWidth;
  const centerY = (+shape.fy + (+shape.fh || 0) / 2) * pageHeight;
  let [localX, localY] = rotate(
    (+anchorX || 0) * pageWidth - centerX,
    (+anchorY || 0) * pageHeight - centerY,
    -(+shape.rot || 0));
  let normalX = localX, normalY = localY;
  if (shape.type === 'ellipse') {
    const halfWidth = objectWidth / 2, halfHeight = objectHeight / 2;
    normalX = localX / (halfWidth * halfWidth);
    normalY = localY / (halfHeight * halfHeight);
  } else {
    const polygon = shapeUnitPolygon(shape.type).map(([x, y]) =>
      [x * objectWidth * (shape.flipX ? -1 : 1), y * objectHeight * (shape.flipY ? -1 : 1)]);
    let nearest = Infinity;
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index], b = polygon[(index + 1) % polygon.length];
      const edgeX = b[0] - a[0], edgeY = b[1] - a[1];
      const edgeLength2 = edgeX * edgeX + edgeY * edgeY;
      if (edgeLength2 < 1e-12) continue;
      const ratio = Math.max(0, Math.min(1,
        ((localX - a[0]) * edgeX + (localY - a[1]) * edgeY) / edgeLength2));
      const nearX = a[0] + edgeX * ratio, nearY = a[1] + edgeY * ratio;
      const distance2 = (localX - nearX) ** 2 + (localY - nearY) ** 2;
      if (distance2 >= nearest) continue;
      nearest = distance2;
      normalX = edgeY; normalY = -edgeX;
      if (normalX * localX + normalY * localY < 0) {
        normalX *= -1; normalY *= -1;
      }
    }
  }
  [normalX, normalY] = rotate(normalX, normalY, +shape.rot || 0);
  const length = Math.hypot(normalX, normalY);
  return length > 1e-9 ? [normalX / length, normalY / length] : null;
}

function clearConnectorExit(arrow) {
  delete arrow._connectorExitX;
  delete arrow._connectorExitY;
}

function setConnectorExit(arrow, x, y) {
  Object.defineProperties(arrow, {
    _connectorExitX: { value: x, writable: true, configurable: true, enumerable: false },
    _connectorExitY: { value: y, writable: true, configurable: true, enumerable: false },
  });
}

function connectorAnchorTarget(shape, arrow, width, height) {
  if (Number.isFinite(+arrow.connectorAnchorX) && Number.isFinite(+arrow.connectorAnchorY)) {
    const pageWidth = Math.max(1e-6, +width || 1), pageHeight = Math.max(1e-6, +height || 1);
    const objectWidth = Math.max(1e-6, Math.abs(+shape.fw || 0) * pageWidth);
    const objectHeight = Math.max(1e-6, Math.abs(+shape.fh || 0) * pageHeight);
    const centerX = (+shape.fx + (+shape.fw || 0) / 2) * pageWidth;
    const centerY = (+shape.fy + (+shape.fh || 0) / 2) * pageHeight;
    const [dx, dy] = rotate(+arrow.connectorAnchorX * objectWidth * (shape.flipX ? -1 : 1),
      +arrow.connectorAnchorY * objectHeight * (shape.flipY ? -1 : 1), +shape.rot || 0);
    return [(centerX + dx) / pageWidth, (centerY + dy) / pageHeight];
  }
  const style = CONNECTOR_STYLES.includes(arrow.connectorStyle) ? arrow.connectorStyle : 'straight';
  if (style === 'curve' && Number.isFinite(+arrow.connectorControlX) &&
      Number.isFinite(+arrow.connectorControlY))
    return [+arrow.connectorControlX, +arrow.connectorControlY];
  if (style === 'angled' && Number.isFinite(+arrow.connectorBendX) &&
      Number.isFinite(+arrow.connectorBendY))
    return [+arrow.connectorBendX, +arrow.connectorBendY];
  if (style === 'step' && Number.isFinite(+arrow.connectorStep)) {
    const points = connectorRoutePolyline(arrow, +arrow.x1 || 0, +arrow.y1 || 0);
    if (points.length > 2) return points[1];
  }
  return [arrow.x2, arrow.y2];
}

export function syncAttachedArrow(page, arrow, width = 1, height = 1) {
  if (arrow?.type !== 'arrow') return false;
  if (!page || !arrow.attachTo) {
    clearConnectorExit(arrow);
    return false;
  }
  const shape = (page.texts || []).find(object =>
    isConnectableShape(object) && object.linkId === arrow.attachTo);
  if (!shape) {
    clearConnectorExit(arrow);
    delete arrow.attachTo;
    delete arrow.attachPoint;
    return false;
  }
  if (arrow.attachPoint !== 'start') {
    [arrow.x1, arrow.x2] = [arrow.x2, arrow.x1];
    [arrow.y1, arrow.y2] = [arrow.y2, arrow.y1];
    arrow.attachPoint = 'start';
  }
  const anchor = CONNECTOR_ANCHORS.includes(arrow.connectorAnchor)
    ? arrow.connectorAnchor : 'side-midpoints';
  const toward = connectorAnchorTarget(shape, arrow, width, height);
  const point = anchor === 'side-midpoints'
    ? shapeSideMidpoint(shape, toward[0], toward[1], width, height)
    : shapeBoundaryPoint(shape, toward[0], toward[1], width, height);
  if (!point) return false;
  arrow.x1 = point[0];
  arrow.y1 = point[1];
  const pageWidth = Math.max(1e-6, +width || 1), pageHeight = Math.max(1e-6, +height || 1);
  const normal = shapeBoundaryNormal(shape, point[0], point[1], pageWidth, pageHeight);
  if (arrow.connectorStyle === 'angled' && normal) {
    const alongX = ((+arrow.x2 || 0) - point[0]) * pageWidth * normal[0];
    const alongY = ((+arrow.y2 || 0) - point[1]) * pageHeight * normal[1];
    let axis = Math.abs(normal[1]) > Math.abs(normal[0]) ? 'y' : 'x';
    if (axis === 'x' && alongX <= 1e-7 && alongY > 1e-7) axis = 'y';
    else if (axis === 'y' && alongY <= 1e-7 && alongX > 1e-7) axis = 'x';
    arrow.connectorAxis = axis;
  }
  const tailDistance = Math.hypot(
    ((+arrow.x2 || 0) - point[0]) * pageWidth,
    ((+arrow.y2 || 0) - point[1]) * pageHeight);
  const shapeWidth = Math.abs(+shape.fw || 0) * pageWidth;
  const shapeHeight = Math.abs(+shape.fh || 0) * pageHeight;
  const preferredExit = Math.max(8, Math.min(22, Math.min(shapeWidth, shapeHeight) * .18));
  const exitDistance = Math.min(preferredExit, tailDistance * .4);
  if (normal && exitDistance > .5) {
    setConnectorExit(arrow,
      Math.max(0, Math.min(1, point[0] + normal[0] * exitDistance / pageWidth)),
      Math.max(0, Math.min(1, point[1] + normal[1] * exitDistance / pageHeight)));
  } else clearConnectorExit(arrow);
  arrow.rot = 0;
  return true;
}

export function rotateConnectorJoints(object, width = 1, height = 1, degrees = 0, pivot = 'center') {
  if (!object || (object.type !== 'line' && object.type !== 'arrow')) return object;
  const pageWidth = Math.max(1e-6, +width || 1), pageHeight = Math.max(1e-6, +height || 1);
  const x1 = Number.isFinite(+object.x1) ? +object.x1 : 0;
  const y1 = Number.isFinite(+object.y1) ? +object.y1 : 0;
  const x2 = Number.isFinite(+object.x2) ? +object.x2 : 0;
  const y2 = Number.isFinite(+object.y2) ? +object.y2 : 0;
  const pivotX = (pivot === 'start' ? x1 : (x1 + x2) / 2) * pageWidth;
  const pivotY = (pivot === 'start' ? y1 : (y1 + y2) / 2) * pageHeight;
  const rotatePair = (xKey, yKey) => {
    if (!Number.isFinite(+object[xKey]) || !Number.isFinite(+object[yKey])) return;
    const [dx, dy] = rotate(+object[xKey] * pageWidth - pivotX,
      +object[yKey] * pageHeight - pivotY, degrees);
    object[xKey] = (pivotX + dx) / pageWidth;
    object[yKey] = (pivotY + dy) / pageHeight;
  };
  if (pivot !== 'start') rotatePair('x1', 'y1');
  rotatePair('x2', 'y2');
  rotatePair('connectorControlX', 'connectorControlY');
  rotatePair('connectorBendX', 'connectorBendY');
  object.rot = 0;
  return object;
}

function connectorRoutePolyline(object, x1, y1, curveSegments = 24) {
  const x2 = +object?.x2 || 0, y2 = +object?.y2 || 0;
  const style = CONNECTOR_STYLES.includes(object.connectorStyle) ? object.connectorStyle : 'straight';
  const dx = x2 - x1, dy = y2 - y1;
  if (style === 'straight') return [[x1, y1], [x2, y2]];
  if (style === 'angled') {
    if (!['x', 'y'].includes(object.connectorAxis)) object.connectorAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    const horizontal = object.connectorAxis === 'x';
    const bendX = Number.isFinite(+object.connectorBendX)
      ? +object.connectorBendX : horizontal ? x2 : x1;
    const bendY = Number.isFinite(+object.connectorBendY)
      ? +object.connectorBendY : horizontal ? y1 : y2;
    return [[x1, y1], [bendX, bendY], [x2, y2]];
  }
  if (style === 'curve') {
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const controlX = Number.isFinite(+object.connectorControlX)
      ? +object.connectorControlX : horizontal ? x1 + dx / 2 : x1;
    const controlY = Number.isFinite(+object.connectorControlY)
      ? +object.connectorControlY : horizontal ? y1 : y1 + dy / 2;
    const points = [];
    const count = Math.max(8, Math.min(64, Math.round(+curveSegments || 24)));
    for (let index = 0; index <= count; index++) {
      const t = index / count, u = 1 - t;
      points.push([
        u * u * x1 + 2 * u * t * controlX + t * t * x2,
        u * u * y1 + 2 * u * t * controlY + t * t * y2,
      ]);
    }
    return points;
  }
  if (style === 'step') {
    const ratio = Number.isFinite(+object.connectorStep)
      ? Math.max(-2, Math.min(3, +object.connectorStep)) : .5;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const middle = x1 + dx * ratio;
      return [[x1, y1], [middle, y1], [middle, y2], [x2, y2]];
    }
    const middle = y1 + dy * ratio;
    return [[x1, y1], [x1, middle], [x2, middle], [x2, y2]];
  }
  return [[x1, y1], [x2, y2]];
}

export function connectorPolyline(object, curveSegments = 24) {
  const x1 = +object?.x1 || 0, y1 = +object?.y1 || 0;
  const x2 = +object?.x2 || 0, y2 = +object?.y2 || 0;
  if (object?.type !== 'arrow') return [[x1, y1], [x2, y2]];
  const hasExit = Number.isFinite(object._connectorExitX) && Number.isFinite(object._connectorExitY) &&
    Math.hypot(object._connectorExitX - x1, object._connectorExitY - y1) > 1e-9;
  if (!hasExit || object.connectorStyle === 'angled') return connectorRoutePolyline(object, x1, y1, curveSegments);
  return [[x1, y1], ...connectorRoutePolyline(
    object, object._connectorExitX, object._connectorExitY, curveSegments)];
}

export function arrowBodyEndInset(object, headSize = 10) {
  if (object?.type !== 'arrow') return 0;
  const size = Math.max(0, +headSize || 0);
  switch (object.arrowEndType || 'arrow-filled') {
    case 'circle-filled': return size * .38;
    case 'circle-open': return size * .34;
    case 'square': return size * .35;
    case 'arrow-filled': return size * Math.max(0, Math.cos((+object.arrowHeadRotation || 0) * Math.PI / 180));
    default: return 0;
  }
}

export function arrowBodyPolyline(object, points, headSize = 10, headRotation = +object?.arrowHeadRotation || 0) {
  const kind = object?.arrowEndType || 'arrow-filled';
  if (object?.type !== 'arrow' || !['circle-filled', 'circle-open', 'square'].includes(kind))
    return trimPolylineEnd(points, arrowBodyEndInset(object, headSize));
  const list = (points || []).map(point => [+point[0] || 0, +point[1] || 0]);
  const extent = Math.max(0, +headSize || 0) * (kind === 'square' ? .35 : kind === 'circle-open' ? .34 : .38);
  if (list.length < 2 || extent <= 0) return list;
  const { end, angle } = connectorEndDirection(list);
  const orientation = kind === 'square' ? angle + headRotation * Math.PI / 180 : 0;
  const cosine = Math.cos(orientation), sine = Math.sin(orientation);
  const local = list.map(([x, y]) => {
    const dx = x - end[0], dy = y - end[1];
    return [dx * cosine + dy * sine, -dx * sine + dy * cosine];
  });
  const inside = ([x, y]) => kind === 'square'
    ? Math.max(Math.abs(x), Math.abs(y)) <= extent
    : x * x + y * y <= extent * extent;
  if (inside(local[0])) return [];

  for (let index = 1; index < list.length; index++) {
    const a = local[index - 1], b = local[index];
    const delta = [b[0] - a[0], b[1] - a[1]];
    let entry = null;
    if (kind === 'square') {
      let near = 0, far = 1;
      for (let axis = 0; axis < 2; axis++) {
        if (Math.abs(delta[axis]) < 1e-9) {
          if (Math.abs(a[axis]) > extent) far = -1;
        } else {
          const t1 = (-extent - a[axis]) / delta[axis];
          const t2 = (extent - a[axis]) / delta[axis];
          near = Math.max(near, Math.min(t1, t2));
          far = Math.min(far, Math.max(t1, t2));
        }
      }
      if (near <= far) entry = near;
    } else {
      const length2 = delta[0] ** 2 + delta[1] ** 2;
      if (length2 < 1e-18) continue;
      const dot = a[0] * delta[0] + a[1] * delta[1];
      const discriminant = dot * dot - length2 * (a[0] ** 2 + a[1] ** 2 - extent ** 2);
      if (discriminant >= 0) entry = (-dot - Math.sqrt(discriminant)) / length2;
    }
    if (entry === null || entry < -1e-9 || entry > 1 + 1e-9) continue;
    const t = Math.max(0, Math.min(1, entry));
    const from = list[index - 1], to = list[index];
    return [...list.slice(0, index), [
      from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t,
    ]];
  }
  return list;
}

export function trimPolylineEnd(points, distance) {
  const out = (points || []).map(point => [+point[0] || 0, +point[1] || 0]);
  let remaining = Math.max(0, +distance || 0);
  if (remaining <= 0 || out.length < 2) return out;
  while (out.length > 1) {
    const end = out.at(-1), before = out.at(-2);
    const dx = end[0] - before[0], dy = end[1] - before[1];
    const length = Math.hypot(dx, dy);
    if (length > remaining && length > 1e-9) {
      const ratio = remaining / length;
      out[out.length - 1] = [end[0] - dx * ratio, end[1] - dy * ratio];
      return out;
    }
    remaining -= length;
    out.pop();
  }
  return out;
}

export function connectorEndDirection(points) {
  const list = (points || []).map(point => [+point[0] || 0, +point[1] || 0]);
  const end = list.at(-1) || [0, 0];
  let before = end;
  for (let index = list.length - 2; index >= 0; index--) {
    if (Math.hypot(end[0] - list[index][0], end[1] - list[index][1]) <= 1e-9) continue;
    before = list[index];
    break;
  }
  return { end, before, angle: Math.atan2(end[1] - before[1], end[0] - before[0]) };
}

export function arrowMarkerStrokeWidth(object, headSize = 10, scale = 1) {
  const size = Math.max(0, +headSize || 0);
  const stroke = Math.max(0, +object?.sw || 0) * Math.max(0, +scale || 0);
  return Math.max(1, Math.min(size / 3, stroke));
}

export function arrowHeadResizeVectors(object) {
  if (object?.type !== 'arrow') return [];
  switch (object.arrowEndType || 'arrow-filled') {
    case 'none': return [];
    case 'circle-filled': return [[-.38, -.38], [-.38, .38]];
    case 'circle-open': return [[-.34, -.34], [-.34, .34]];
    case 'square': return [[-.35, -.35], [-.35, .35]];
    default: return [[-1, -.5], [-1, .5]];
  }
}

export function arrowHeadSizeDelta(vector, dx, dy, scale = 1) {
  const length2 = vector[0] ** 2 + vector[1] ** 2;
  if (length2 < 1e-9) return 0;
  return (dx * vector[0] + dy * vector[1]) / length2 / Math.max(.01, +scale || 1);
}

export function syncPageConnectors(page, width = 1, height = 1) {
  let count = 0;
  for (const object of page?.texts || [])
    if (syncAttachedArrow(page, object, width, height)) count++;
  return count;
}

export function detachDanglingConnectors(objects) {
  const live = new Set((objects || [])
    .filter(isConnectableShape)
    .map(object => object.linkId)
    .filter(Boolean));
  for (const object of objects || [])
    if (object.type === 'arrow' && object.attachTo && !live.has(object.attachTo)) {
      delete object.attachTo;
      delete object.attachPoint;
    }
  return objects;
}

export function detachedObjectCopy(object) {
  const copy = {
    ...object,
    ...(Array.isArray(object?.points)
      ? { points: object.points.map(point => [...point]) }
      : {}),
    _id: undefined,
  };
  delete copy.linkId;
  delete copy.attachTo;
  delete copy.attachPoint;
  return copy;
}

export function copyConnectedObjectBundle(page, object, createId) {
  if (!page || !object || !isConnectableShape(object) || !object.linkId)
    return [detachedObjectCopy(object)];
  const linked = (page.texts || []).filter(candidate =>
    candidate.type === 'arrow' && candidate.attachTo === object.linkId);
  if (!linked.length) return [detachedObjectCopy(object)];
  const copiedPage = {
    texts: [object, ...linked].map(candidate => {
      const copy = {
        ...candidate,
        ...(Array.isArray(candidate.points)
          ? { points: candidate.points.map(point => [...point]) }
          : {}),
        _id: undefined,
      };
      delete copy._w1;
      return copy;
    }),
  };
  rekeyPageConnections(copiedPage, createId);
  return copiedPage.texts;
}

export function translateObjectBundle(objects, primaryIndex = 0, requestedX = 0, requestedY = 0,
  maxPrimaryX = .9, maxPrimaryY = .9) {
  if (!Array.isArray(objects) || !objects.length) return { dx: 0, dy: 0 };
  const index = Math.max(0, Math.min(objects.length - 1, +primaryIndex || 0));
  const primary = objects[index];
  let dx = Number.isFinite(+requestedX) ? +requestedX : 0;
  let dy = Number.isFinite(+requestedY) ? +requestedY : 0;
  if (primary?.type === 'polyline' && Array.isArray(primary.points) && primary.points.length) {
    const xs = primary.points.map(point => +point[0] || 0);
    const ys = primary.points.map(point => +point[1] || 0);
    dx = Math.max(-Math.min(...xs), Math.min(1 - Math.max(...xs), dx));
    dy = Math.max(-Math.min(...ys), Math.min(1 - Math.max(...ys), dy));
  } else if (primary?.type !== 'line' && primary?.type !== 'arrow') {
    const x = Number.isFinite(+primary?.fx) ? +primary.fx : 0;
    const y = Number.isFinite(+primary?.fy) ? +primary.fy : 0;
    dx = Math.min(maxPrimaryX, x + dx) - x;
    dy = Math.min(maxPrimaryY, y + dy) - y;
  }
  for (const object of objects) {
    if (object?.type === 'polyline' && Array.isArray(object.points)) {
      object.points = object.points.map(point => [
        (+point[0] || 0) + dx,
        (+point[1] || 0) + dy,
      ]);
    } else if (object?.type === 'line' || object?.type === 'arrow') {
      object.x1 = (+object.x1 || 0) + dx;
      object.y1 = (+object.y1 || 0) + dy;
      object.x2 = (+object.x2 || 0) + dx;
      object.y2 = (+object.y2 || 0) + dy;
      if (Number.isFinite(+object.connectorControlX))
        object.connectorControlX = +object.connectorControlX + dx;
      if (Number.isFinite(+object.connectorControlY))
        object.connectorControlY = +object.connectorControlY + dy;
      if (Number.isFinite(+object.connectorBendX))
        object.connectorBendX = +object.connectorBendX + dx;
      if (Number.isFinite(+object.connectorBendY))
        object.connectorBendY = +object.connectorBendY + dy;
    } else {
      object.fx = (+object.fx || 0) + dx;
      object.fy = (+object.fy || 0) + dy;
    }
  }
  return { dx, dy };
}

const finiteNumber = value => value !== null && value !== '' && Number.isFinite(+value);

export function objectScaleSnapshot(object, fallbackWidth = .01, fallbackHeight = .01) {
  if (object?.type === 'polyline' && Array.isArray(object.points)) {
    return { kind: 'polyline', points: object.points.map(point => [
      +point[0] || 0, +point[1] || 0,
    ]) };
  }
  if (object?.type === 'line' || object?.type === 'arrow') {
    const snapshot = {
      kind: 'connector', x1: +object.x1 || 0, y1: +object.y1 || 0,
      x2: +object.x2 || 0, y2: +object.y2 || 0,
    };
    for (const key of ['connectorControlX', 'connectorControlY', 'connectorBendX', 'connectorBendY'])
      if (finiteNumber(object[key])) snapshot[key] = +object[key];
    return snapshot;
  }
  return {
    kind: 'box', fx: +object?.fx || 0, fy: +object?.fy || 0,
    fw: finiteNumber(object?.fw) ? +object.fw : Math.max(1e-6, +fallbackWidth || .01),
    fh: finiteNumber(object?.fh) ? +object.fh : Math.max(1e-6, +fallbackHeight || .01),
    size: finiteNumber(object?.size) ? +object.size : null,
    flipX: !!object?.flipX, flipY: !!object?.flipY,
  };
}

export function applyObjectScaleSnapshot(object, snapshot, anchorX, anchorY, scale) {
  if (!object || !snapshot) return object;
  const x0 = Number.isFinite(+anchorX) ? +anchorX : 0;
  const y0 = Number.isFinite(+anchorY) ? +anchorY : 0;
  const ratio = Number.isFinite(+scale) ? +scale : 1;
  const scaled = (value, anchor) => anchor + (value - anchor) * ratio;
  if (snapshot.kind === 'polyline') {
    object.points = snapshot.points.map(point => [
      scaled(point[0], x0), scaled(point[1], y0),
    ]);
    return object;
  }
  if (snapshot.kind === 'connector') {
    object.x1 = scaled(snapshot.x1, x0); object.y1 = scaled(snapshot.y1, y0);
    object.x2 = scaled(snapshot.x2, x0); object.y2 = scaled(snapshot.y2, y0);
    for (const [key, anchor] of [
      ['connectorControlX', x0], ['connectorControlY', y0],
      ['connectorBendX', x0], ['connectorBendY', y0],
    ]) {
      if (finiteNumber(snapshot[key])) object[key] = scaled(+snapshot[key], anchor);
      else delete object[key];
    }
    return object;
  }
  object.fw = snapshot.fw * Math.abs(ratio);
  object.fh = snapshot.fh * Math.abs(ratio);
  object.fx = scaled(snapshot.fx + snapshot.fw / 2, x0) - object.fw / 2;
  object.fy = scaled(snapshot.fy + snapshot.fh / 2, y0) - object.fh / 2;
  object.flipX = !!snapshot.flipX !== (ratio < 0);
  object.flipY = !!snapshot.flipY !== (ratio < 0);
  if (snapshot.size !== null) object.size = snapshot.size * Math.abs(ratio);
  return object;
}

export function connectedDeletionSet(objects, selectedObjects) {
  const deletion = new Set(selectedObjects || []);
  const linkedShapeIds = new Set([...deletion]
    .filter(isConnectableShape)
    .map(object => object.linkId)
    .filter(Boolean));
  if (!linkedShapeIds.size) return deletion;
  for (const object of objects || [])
    if (object?.type === 'arrow' && linkedShapeIds.has(object.attachTo)) deletion.add(object);
  return deletion;
}

export function rekeyPageConnections(page, createId) {
  const remap = new Map();
  for (const object of page?.texts || []) {
    if (!isConnectableShape(object) || !object.linkId) continue;
    const oldId = object.linkId;
    const newId = createId();
    remap.set(oldId, newId);
    object.linkId = newId;
  }
  for (const object of page?.texts || []) {
    if (object.type !== 'arrow' || !object.attachTo) continue;
    const next = remap.get(object.attachTo);
    if (next) object.attachTo = next;
    else {
      delete object.attachTo;
      delete object.attachPoint;
    }
  }
  return page;
}

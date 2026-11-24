const OBJECT_TYPES = new Set(['text', 'rect', 'ellipse', 'triangle', 'star', 'line', 'arrow', 'polyline', 'ink', 'img']);
const ARROW_HEAD_SIZE_MIN = 4;
const ARROW_HEAD_SIZE_MAX = 160;

function clonePageObject(object) {
  return {
    ...object,
    ...(Array.isArray(object.points)
      ? { points: object.points.map(point => [...point]) }
      : {}),
    _id: undefined,
  };
}

export function clonePage(page) {
  return {
    ...page,
    texts: page.texts.map(clonePageObject),
    blank: page.blank ? [...page.blank] : undefined,
    resize: page.resize ? [...page.resize] : undefined,
    crop: page.crop ? [...page.crop] : undefined,
  };
}

export function detachClonePage(page) {
  const clone = { ...page, texts: (page.texts || []).map(clonePageObject) };
  if (page.blank) clone.blank = [...page.blank];
  if (page.resize) clone.resize = [...page.resize];
  if (page.crop) clone.crop = [...page.crop];
  delete clone._w1;
  delete clone._h1;
  return clone;
}

export function toDetachedDocumentDto(documentState) {
  return {
    name: documentState.name,
    dirty: documentState.dirty,
    atSavedState: documentState._atSavedState === true,
    fileHandle: documentState.fileHandle || null,
    ...(documentState.openedWithPassword ? { openedWithPassword: true } : {}),
    pages: documentState.pages.map(detachClonePage),
    selected: [...(documentState.selected || [])],
    zoom: documentState.zoom,
    fitWidth: documentState.fitWidth,
    currentPage: documentState.currentPage,
    lastSelected: documentState.lastSelected,
    scrollTop: documentState.scrollTop,
    undoStack: (documentState.undoStack || []).map(snapshot => ({
      pages: (snapshot.pages || []).map(detachClonePage),
      atSavedState: snapshot.atSavedState === true,
    })),
    redoStack: (documentState.redoStack || []).map(snapshot => ({
      pages: (snapshot.pages || []).map(detachClonePage),
      atSavedState: snapshot.atSavedState === true,
    })),
  };
}

export function toAutosaveDocumentDto(documentState) {
  return {
    name: documentState.name,
    dirty: documentState.dirty,
    handle: documentState.fileHandle || null,
    ...(documentState.openedWithPassword ? { openedWithPassword: true } : {}),
    scrollTop: Math.max(0, +documentState.scrollTop || 0),
    pages: documentState.pages.map(page => ({
      src: page.src || null,
      idx: page.idx,
      rot: page.rot || 0,
      blank: page.blank || null,
      resize: page.resize || null,
      crop: page.crop || null,
      texts: page.texts.map(object => {
        const clone = {
          ...object,
          points: Array.isArray(object.points) ? object.points.map(point => [...point]) : object.points,
        };
        delete clone._id;
        delete clone._w1;
        return clone;
      }),
    })),
  };
}

export function clampStrokeWidth(value) {
  return Math.round(Math.max(0.1, Math.min(40, Number.isFinite(+value) ? +value : 0.1)) * 10) / 10;
}

export function sanitizeTextObject(value, {
  isKnownFont = () => false,
  clampStrokeWidth: normalizeStrokeWidth = clampStrokeWidth,
} = {}) {
  if (!value || typeof value !== 'object') return null;
  const out = {};
  const hex = candidate => /^#[0-9a-f]{3,8}$/i.test(String(candidate)) ? String(candidate) : null;
  const number = (candidate, fallback) => Number.isFinite(+candidate) ? +candidate : fallback;
  if (value.type !== undefined) {
    if (!OBJECT_TYPES.has(value.type)) return null;
    out.type = value.type;
  }
  for (const key of ['fx', 'fy', 'fw', 'fh', 'x1', 'y1', 'x2', 'y2', 'size', 'sw', 'rot',
                     'colorOp', 'strokeOp', 'fillOp', 'clipIdx', 'arrowHeadSize', 'arrowHeadRotation',
                     'connectorControlX', 'connectorControlY', 'connectorStep',
                     'connectorAnchorX', 'connectorAnchorY', 'connectorBendX', 'connectorBendY']) {
    if (value[key] !== undefined) out[key] = number(value[key], 0);
  }
  if (out.sw !== undefined) out.sw = normalizeStrokeWidth(out.sw);
  if (out.arrowHeadSize !== undefined)
    out.arrowHeadSize = Math.max(ARROW_HEAD_SIZE_MIN, Math.min(ARROW_HEAD_SIZE_MAX, out.arrowHeadSize));
  if (value.text !== undefined) out.text = String(value.text);
  if (value.color !== undefined) out.color = hex(value.color) || '#000000';
  if (value.stroke !== undefined) out.stroke = hex(value.stroke) || '#d32f2f';
  if (value.fill !== undefined) out.fill = hex(value.fill) || '';
  if (value.font !== undefined) out.font = isKnownFont(value.font) ? value.font : 'spoqa';
  for (const key of ['flipX', 'flipY']) if (value[key] !== undefined) out[key] = value[key] === true;
  if (value.bold !== undefined) out.bold = !!value.bold;
  if (value.strokeOn !== undefined) out.strokeOn = !!value.strokeOn;
  if (value.align !== undefined) out.align = ['left', 'center', 'right'].includes(value.align) ? value.align : undefined;
  if (value.valign !== undefined) out.valign = ['top', 'middle', 'bottom'].includes(value.valign) ? value.valign : undefined;
  if (value.data !== undefined) {
    if (!/^data:image\//.test(String(value.data))) return null;
    out.data = value.data;
  }
  if (value.blend === 'multiply') out.blend = 'multiply';
  if (value.type === 'ink') {
    if (!Array.isArray(value.points) || !Number.isFinite(+value.inkW) || !Number.isFinite(+value.inkH) || !(+value.inkW > 0 && +value.inkH > 0)) return null;
    out.inkW = Math.max(.1, Math.min(100000, +value.inkW));
    out.inkH = Math.max(.1, Math.min(100000, +value.inkH));
    out.brush = ['pen', 'pencil', 'marker', 'highlighter'].includes(value.brush) ? value.brush : 'pen';
    out.points = value.points.slice(0, 4096).filter(p => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]))
      .map(p => [Math.max(0, Math.min(out.inkW, +p[0])), Math.max(0, Math.min(out.inkH, +p[1])),
        Math.max(.05, Math.min(1, number(p[2], .5)))]);
    if (!out.points.length || !(out.fw >= 0 && out.fh >= 0)) return null;
  }
  if (value.type === 'polyline') {
    if (!Array.isArray(value.points)) return null;
    out.points = value.points.slice(0, 200).map(point => {
      if (!Array.isArray(point) || point.length < 2) return null;
      const x = number(point[0], NaN), y = number(point[1], NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return [Math.max(-2, Math.min(3, x)), Math.max(-2, Math.min(3, y))];
    }).filter(Boolean);
    if (out.points.length < 2) return null;
    out.closed = value.closed !== false;
  }
  if (value.type === 'line') out.lineCap = value.lineCap === 'square' ? 'square' : 'round';
  for (const key of ['linkId', 'attachTo']) {
    if (value[key] === undefined) continue;
    const id = String(value[key]);
    if (/^[a-z0-9-]{8,100}$/i.test(id)) out[key] = id;
  }
  if (['x', 'y'].includes(value.connectorAxis)) out.connectorAxis = value.connectorAxis;
  if (value.attachPoint === 'start') out.attachPoint = 'start';
  if (['side-midpoints', 'edge'].includes(value.connectorAnchor)) out.connectorAnchor = value.connectorAnchor;
  if (['straight', 'angled', 'curve', 'step'].includes(value.connectorStyle)) out.connectorStyle = value.connectorStyle;
  if (['none', 'circle-filled', 'circle-open', 'square', 'arrow-filled', 'arrow-open'].includes(value.arrowEndType))
    out.arrowEndType = value.arrowEndType;
  if (value.clipSrc !== undefined) out.clipSrc = value.clipSrc;
  if ([0, 90, 180, 270].includes(value.clipRotation)) out.clipRotation = value.clipRotation;
  if (value.clipOpaque === true) out.clipOpaque = true;
  if (value.clipFragment === true) out.clipFragment = true;
  if (value.clipAlpha === true) out.clipAlpha = true;
  if (out.clipOpaque && Array.isArray(value.clipErasures)) {
    const numbers = (list, count) => Array.isArray(list) && list.length === count &&
      list.every(n => Number.isFinite(n) && Math.abs(n) <= 1e9);
    const strokes = value.clipErasures.filter(s => s && numbers(s.matrix,6) &&
      ['round','square','soft','chisel'].includes(s.tip) && Number.isFinite(s.sw) && s.sw > 0 &&
      Array.isArray(s.points) && s.points.length > 0 && s.points.length <= 4096 &&
      s.points.every(p => numbers(p,2)));
    if (strokes.length) out.clipErasures = strokes.map(({ matrix, points, tip, sw }) =>
      ({ matrix:[...matrix], points:points.map(p => [...p]), tip, sw }));
  }
  if (Array.isArray(value.clipBox)) out.clipBox = value.clipBox.slice(0, 4).map(item => number(item, 0));
  return out;
}

export function remapTransferPageDto(page, resolveSource, sanitizeObject, trusted) {
  const clone = detachClonePage(page);
  clone.src = page.src ? (resolveSource(page.src) || null) : null;
  clone.texts = (page.texts || []).map(object => (
    trusted ? { ...object, _id: undefined } : sanitizeObject(object)
  )).filter(Boolean).map(object => {
    if (object.clipSrc === undefined) return object;
    const nextSource = resolveSource(object.clipSrc);
    if (nextSource) object.clipSrc = nextSource;
    else {
      delete object.clipSrc;
      delete object.clipIdx;
      delete object.clipBox;
      delete object.clipRotation;
      delete object.clipOpaque;
      delete object.clipFragment;
      delete object.clipAlpha;
      delete object.clipErasures;
    }
    return object;
  });
  return clone;
}

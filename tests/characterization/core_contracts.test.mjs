import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  GF_SHA, PDFIUM_CDN, PDFJS_CDN_BASE, PDFJS_VERSION,
  THUMB_DISPLAY_MAX, THUMB_DISPLAY_MIN, THUMB_RENDER_MAX, cacheByteLimit,
} from '../../src/core/config.js';
import { hexA, hexToRgbComponents, opOf } from '../../src/core/color.js';
import {
  constrainPolylineVertex, cropSelectionRectFromPoints, cropToViewportPoints, normRotation, objRotation, pagePtToFrac, pageRectToDispRect,
  pdfPointBounds, pdfRectToViewport, regionPdfBounds, resizedCropGeometry, rotateScreenDelta, rotateScreenPoint, rotFrac, unrotFrac,
  rotatePolylinePoints, tappedCropSelectionRect,
} from '../../src/core/geometry.js';
import { makeRenderKey, makeThumbKey } from '../../src/core/render-keys.js';
import { parseRange } from '../../src/core/range.js';
import { collectPageSourceRefs } from '../../src/core/source-references.js';
import {
  clampStrokeWidth, clonePage, detachClonePage, remapTransferPageDto, sanitizeTextObject,
  toAutosaveDocumentDto, toDetachedDocumentDto,
} from '../../src/core/compatibility.js';
import {
  markChanged, markSaved, restoreSaveCheckpoint, snapshotSaveCheckpoint,
} from '../../src/core/history-dirty.js';
import {
  applyObjectScaleSnapshot, ARROW_END_TYPES, arrowBodyEndInset, arrowBodyPolyline, arrowHeadResizeVectors, arrowHeadSizeDelta, arrowMarkerStrokeWidth,
  connectedDeletionSet, connectorEndDirection, connectorPolyline, copyConnectedObjectBundle,
  detachedObjectCopy, objectScaleSnapshot, rekeyPageConnections, shapeAnchorVector,
  rotateConnectorJoints, shapeBoundaryPoint, shapeSideMidpoints, syncPageConnectors, translateObjectBundle,
  trimPolylineEnd,
} from '../../src/core/shape-connectors.js';

const coreFiles = [
  'config.js', 'color.js', 'geometry.js', 'render-keys.js', 'range.js',
  'source-references.js', 'compatibility.js', 'startup-guard.js',
  'history-dirty.js', 'shape-connectors.js',
];

test('dirty state follows the saved history checkpoint instead of undo depth', () => {
  const document = { dirty: false, _atSavedState: true, undoStack: [], redoStack: [] };
  const savedA = { pages: ['A'], atSavedState: snapshotSaveCheckpoint(document) };

  document.undoStack.push(savedA);
  markChanged(document);
  assert.equal(document.dirty, true);

  const editedB = { pages: ['B'], atSavedState: snapshotSaveCheckpoint(document) };
  assert.equal(restoreSaveCheckpoint(document, document.undoStack.pop()), true);
  assert.equal(document.dirty, false, 'undo to the saved state clears the red indicator');
  assert.equal(restoreSaveCheckpoint(document, editedB), true);
  assert.equal(document.dirty, true, 'redo away from the saved state restores the indicator');

  document.undoStack.push(savedA);
  markSaved(document);
  assert.equal(document.undoStack[0].atSavedState, false, 'saving invalidates an older save point');
  const savedB = { pages: ['B'], atSavedState: snapshotSaveCheckpoint(document) };
  markChanged(document);
  assert.equal(restoreSaveCheckpoint(document, savedB), true);
  assert.equal(document.dirty, false, 'undo to a later save point also clears the indicator');
  assert.equal(restoreSaveCheckpoint(document, document.undoStack[0]), true);
  assert.equal(document.dirty, true, 'undo past the latest save point stays dirty');

  const recoveredUnsaved = { dirty: true, _atSavedState: false, undoStack: [], redoStack: [] };
  assert.equal(snapshotSaveCheckpoint(recoveredUnsaved), false);
  assert.equal(recoveredUnsaved.dirty, true, 'recovered unsaved data remains dirty without history');
});

test('core modules do not depend on DOM, browser storage, or PDF engines', async () => {
  for (const name of coreFiles) {
    const source = await readFile(new URL(`../../src/core/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\b(?:document|window|navigator|localStorage|indexedDB|PDFLib|pdfjsLib|sources)\b/, name);
    assert.doesNotMatch(source, /^\s*import\s/m, name);
  }
});

test('version and memory limits retain their exact values', () => {
  assert.equal(PDFJS_VERSION, '6.2.108');
  assert.equal(PDFJS_CDN_BASE, 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/');
  assert.equal(PDFIUM_CDN, 'https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@2.15.0/dist/');
  assert.equal(GF_SHA, 'ade3d1533e06b2b1462ffcde8e08b129627ca360');
  assert.deepEqual([THUMB_DISPLAY_MIN, THUMB_DISPLAY_MAX, THUMB_RENDER_MAX], [84, 168, 168]);
  assert.equal(cacheByteLimit(undefined, 48, 96), 96 * 1024 * 1024);
  assert.equal(cacheByteLimit(4, 48, 96), 48 * 1024 * 1024);
  assert.equal(cacheByteLimit(8, 64, 128), 128 * 1024 * 1024);
});

test('color and legacy opacity conversions retain table outputs', () => {
  assert.deepEqual(hexToRgbComponents('#ff8000'), [1, 128 / 255, 0]);
  assert.deepEqual(hexToRgbComponents('#000000'), [0, 0, 0]);
  assert.equal(hexA('#123456', undefined), 'rgba(18,52,86,1)');
  assert.equal(hexA('#abcdef', 0.25), 'rgba(171,205,239,0.25)');
  assert.equal(opOf({ colorOp: 0, op: 0.8 }, 'colorOp'), 0);
  assert.equal(opOf({ op: 0.8 }, 'colorOp'), 0.8);
  assert.equal(opOf({}, 'fillOp'), 1);
});

test('page clones preserve compatibility fields without sharing mutable arrays', () => {
  const source = {
    src: 7, idx: 2, rot: 90, blank: [612, 792], resize: [500, 700],
    crop: [0.1, 0.2, 0.7, 0.6], _w1: 99, _h1: 88,
    texts: [{ _id: 12, type: 'text', text: '원본' }],
  };
  const regular = clonePage(source);
  const detached = detachClonePage(source);
  assert.deepEqual(regular.texts, [{ _id: undefined, type: 'text', text: '원본' }]);
  assert.equal(regular._w1, 99);
  assert.equal(detached._w1, undefined);
  assert.equal(detached._h1, undefined);
  assert.notEqual(regular.texts, source.texts);
  assert.notEqual(regular.blank, source.blank);
  assert.notEqual(detached.crop, source.crop);
});

test('sanitizer retains valid compatibility data and rejects unsafe input', () => {
  const options = {
    isKnownFont: font => font === 'spoqa',
  };
  assert.equal(sanitizeTextObject(null, options), null);
  assert.equal(sanitizeTextObject({ type: 'script' }, options), null);
  assert.equal(sanitizeTextObject({ type: 'img', data: 'javascript:alert(1)' }, options), null);

  const sanitized = sanitizeTextObject({
    type: 'rect', fx: '0.25', fy: 'bad', sw: 99, rot: '-90',
    text: 42, size: '18', colorOp: '.7', color: 'red',
    stroke: '#ABCDEF', fill: '#1234', font: 'unknown',
    bold: 1, strokeOn: 0, align: 'bogus', valign: 'middle', blend: 'screen',
    clipSrc: 'i2', clipIdx: '3', clipBox: ['1', 'bad', 3, 4, 5],
  }, options);
  assert.deepEqual(sanitized, {
    type: 'rect', fx: 0.25, fy: 0, sw: 40, rot: -90, text: '42', size: 18,
    colorOp: .7, clipIdx: 3,
    color: '#000000', stroke: '#ABCDEF', fill: '#1234', font: 'spoqa',
    bold: true, strokeOn: false, align: undefined, valign: 'middle',
    clipSrc: 'i2', clipBox: [1, 0, 3, 4],
  });
  assert.equal(clampStrokeWidth('1.26'), 1.3);
  assert.equal(clampStrokeWidth('bad'), 0.1);
  assert.equal(sanitizeTextObject({ font: 'unknown' }).font, 'spoqa');
  assert.equal(sanitizeTextObject({ type: 'arrow', arrowEndType: 'none' }).arrowEndType, 'none');
  assert.deepEqual(sanitizeTextObject({
    type: 'arrow', linkId: 'shape-link-123', attachTo: 'shape-link-456', attachPoint: 'start',
    connectorStyle: 'curve', arrowEndType: 'circle-open', arrowHeadSize: 100,
    connectorControlX: '.7', connectorControlY: '.2', connectorStep: '.25',
    connectorAnchor: 'edge', connectorAnchorX: '.5', connectorAnchorY: '-.2',
    connectorBendX: '.6', connectorBendY: '.4',
  }), { type: 'arrow', linkId: 'shape-link-123', attachTo: 'shape-link-456', attachPoint: 'start',
    connectorStyle: 'curve', arrowEndType: 'circle-open', arrowHeadSize: 100,
    connectorControlX: .7, connectorControlY: .2, connectorStep: .25,
    connectorAnchor: 'edge', connectorAnchorX: .5, connectorAnchorY: -.2,
    connectorBendX: .6, connectorBendY: .4 });
  assert.equal(sanitizeTextObject({ type: 'arrow', arrowHeadSize: 999 }).arrowHeadSize, 160);
  assert.deepEqual(sanitizeTextObject({
    type: 'polyline', points: [['.1', '.2'], [.4, .5], [9, -9]],
    closed: true, stroke: '#123456', sw: 2, lineJoin: 'miter',
  }), {
    type: 'polyline', points: [[.1, .2], [.4, .5], [3, -2]], closed: true,
    stroke: '#123456', sw: 2,
  });
  assert.equal(sanitizeTextObject({ type: 'line', lineCap: 'square' }).lineCap, 'square');
  assert.equal(sanitizeTextObject({ type: 'line', lineCap: 'bad' }).lineCap, 'round');
});

test('shape connectors anchor arrow starts, preserve four controllable routes, detach single copies, and rekey page copies', () => {
  const shape = { type: 'rect', fx: .4, fy: .4, fw: .2, fh: .2, linkId: 'shape-link-123' };
  assert.deepEqual(shapeBoundaryPoint(shape, .9, .5, 100, 100).map(v => +v.toFixed(3)), [.6, .5]);
  assert.deepEqual(shapeSideMidpoints(shape, 100, 100).map(point =>
    point.map(value => +value.toFixed(3))), [[.5, .4], [.6, .5], [.5, .6], [.4, .5]]);
  const ellipse = { ...shape, type: 'ellipse' };
  assert.deepEqual(shapeBoundaryPoint(ellipse, .5, .1, 100, 100).map(v => +v.toFixed(3)), [.5, .4]);

  const arrow = { type: 'arrow', x1: .9, y1: .5, x2: 0, y2: 0, attachTo: shape.linkId };
  const page = { texts: [shape, arrow] };
  assert.equal(syncPageConnectors(page, 100, 100), 1);
  assert.deepEqual([arrow.x1, arrow.y1].map(v => +v.toFixed(3)), [.6, .5]);
  assert.deepEqual([arrow.x2, arrow.y2], [.9, .5]);
  assert.equal(arrow.attachPoint, 'start');
  const attachedPath = connectorPolyline(arrow);
  assert.equal(attachedPath.length, 3);
  assert.deepEqual(attachedPath[0].map(v => +v.toFixed(3)), [.6, .5]);
  assert.ok(attachedPath[1][0] > attachedPath[0][0]);
  assert.equal(+attachedPath[1][1].toFixed(3), .5);
  assert.equal(Object.keys(arrow).includes('_connectorExitX'), false);
  const edgeVector = shapeAnchorVector(shape, .6, .46, 100, 100);
  Object.assign(arrow, { connectorAnchor: 'edge', connectorAnchorX: edgeVector[0],
    connectorAnchorY: edgeVector[1] });
  syncPageConnectors(page, 100, 100);
  assert.deepEqual([arrow.x1, arrow.y1].map(v => +v.toFixed(3)), [.6, .46]);
  const edgePath = connectorPolyline(arrow);
  assert.ok(edgePath[1][0] > edgePath[0][0]);
  assert.equal(+edgePath[1][1].toFixed(3), .46);
  assert.deepEqual(connectorPolyline({ type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1, connectorStyle: 'straight' }), [[0, 0], [1, 1]]);
  assert.deepEqual(connectorPolyline({ type: 'arrow', x1: 1, y1: .5, x2: 0, y2: 0,
    connectorStyle: 'angled' }), [[1, .5], [0, .5], [0, 0]]);
  assert.deepEqual(connectorPolyline({ type: 'arrow', x1: 1, y1: .5, x2: 0, y2: 0,
    connectorStyle: 'angled', connectorBendX: .72, connectorBendY: .44 }),
  [[1, .5], [.72, .44], [0, 0]]);
  const curve = connectorPolyline({ type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1,
    connectorStyle: 'curve', connectorControlX: .8, connectorControlY: .1 });
  assert.equal(curve.length, 25);
  assert.deepEqual(curve[12], [.65, .3]);
  assert.deepEqual(connectorPolyline({ type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1,
    connectorStyle: 'step', connectorStep: .25 }), [[0, 0], [.25, 0], [.25, 1], [1, 1]]);
  assert.equal(+arrowBodyEndInset({ type: 'arrow', arrowEndType: 'circle-open' }, 10).toFixed(2), 3.4);
  assert.equal(arrowBodyEndInset({ type: 'arrow', arrowEndType: 'none' }, 10), 0);
  assert.equal(arrowBodyEndInset({ type: 'arrow', arrowEndType: 'arrow-open' }, 10), 0);
  assert.ok(ARROW_END_TYPES.includes('none'));
  assert.deepEqual(trimPolylineEnd([[0, 0], [4, 0], [4, 6]], 2), [[0, 0], [4, 0], [4, 4]]);
  assert.equal(+connectorEndDirection([[0, 0], [1, 1], [1, 1]]).angle.toFixed(6),
    +(Math.PI / 4).toFixed(6));
  assert.equal(arrowMarkerStrokeWidth({ sw: 2 }, 12, 3), 4);
  assert.equal(arrowMarkerStrokeWidth({ sw: .1 }, 12, 1), 1);
  assert.equal(detachedObjectCopy(shape).linkId, undefined);
  assert.equal(detachedObjectCopy(arrow).attachTo, undefined);
  assert.equal(detachedObjectCopy(arrow).attachPoint, undefined);

  const jointShape = { type: 'rect', fx: .4, fy: .4, fw: .2, fh: .2, linkId: 'joint-link' };
  const fixedJointArrow = { type: 'arrow', x1: .6, y1: .5, x2: .2, y2: .5,
    attachTo: jointShape.linkId, attachPoint: 'start', connectorAnchor: 'side-midpoints',
    connectorStyle: 'angled', connectorBendX: .8, connectorBendY: .5 };
  assert.equal(syncPageConnectors({ texts: [jointShape, fixedJointArrow] }, 100, 100), 1);
  assert.deepEqual([fixedJointArrow.x1, fixedJointArrow.y1].map(value => +value.toFixed(3)), [.6, .5]);

  let sequence = 0;
  rekeyPageConnections(page, () => `copied-link-${++sequence}`);
  assert.equal(shape.linkId, 'copied-link-1');
  assert.equal(arrow.attachTo, 'copied-link-1');

  const multiShape = { type: 'rect', fx: .2, fy: .2, fw: .2, fh: .2, linkId: 'multi-link-1',
    text: '도형 글자', size: 16, color: '#112233', align: 'center', valign: 'middle' };
  const multiBundle = copyConnectedObjectBundle({ texts: [multiShape,
    { type: 'arrow', attachTo: multiShape.linkId, attachPoint: 'start', x1: .4, y1: .3, x2: .7, y2: .2 },
    { type: 'arrow', attachTo: multiShape.linkId, attachPoint: 'start', x1: .3, y1: .4, x2: .2, y2: .8 },
  ] }, multiShape, () => 'multi-link-copy');
  assert.equal(multiBundle.length, 3);
  assert.deepEqual(multiBundle[0].text, '도형 글자');
  assert.deepEqual(multiBundle.slice(1).map(item => item.attachTo), ['multi-link-copy', 'multi-link-copy']);
  const pastedBundle = { texts: multiBundle.map(object => ({ ...object })) };
  rekeyPageConnections(pastedBundle, () => 'multi-link-pasted');
  translateObjectBundle(pastedBundle.texts, 0, .03, .03);
  assert.equal(syncPageConnectors(pastedBundle, 100, 100), 2);
  assert.deepEqual(pastedBundle.texts.slice(1).map(item => item.attachTo),
    ['multi-link-pasted', 'multi-link-pasted']);
  assert.equal(pastedBundle.texts[0].linkId, 'multi-link-pasted');

  for (const [index, arrowEndType] of ARROW_END_TYPES.entries()) {
    const sourceShape = { type: 'rect', fx: .89, fy: .89, fw: .08, fh: .08,
      linkId: `source-link-${index}` };
    const sourceArrow = { type: 'arrow', x1: .89, y1: .93, x2: .55, y2: .31,
      attachTo: sourceShape.linkId, attachPoint: 'start', arrowEndType, arrowHeadSize: 17,
      connectorStyle: 'curve', connectorControlX: .72, connectorControlY: .18, connectorStep: .37 };
    const copied = copyConnectedObjectBundle({ texts: [sourceShape, sourceArrow] }, sourceShape,
      () => `bundle-link-${index}`);
    assert.equal(copied.length, 2);
    assert.equal(copied[0].linkId, `bundle-link-${index}`);
    assert.equal(copied[1].attachTo, copied[0].linkId);
    assert.equal(copied[1].arrowEndType, arrowEndType);
    assert.equal(copied[1].arrowHeadSize, 17);
    assert.equal(copied[1].connectorStyle, 'curve');
    assert.equal(copied[1].connectorStep, .37);
    const before = connectorPolyline(copied[1]);
    const movement = translateObjectBundle(copied, 0, .03, .03);
    assert.deepEqual([+movement.dx.toFixed(4), +movement.dy.toFixed(4)], [.01, .01]);
    assert.deepEqual(connectorPolyline(copied[1]).map(([x, y]) =>
      [+(x - movement.dx).toFixed(9), +(y - movement.dy).toFixed(9)]),
    before.map(([x, y]) => [+x.toFixed(9), +y.toFixed(9)]));
    assert.equal(+copied[1].connectorControlX.toFixed(2), .73);
    assert.equal(+copied[1].connectorControlY.toFixed(2), .19);
  }
});

test('multi-object scaling preserves relative geometry and shape deletion includes every attached arrow', () => {
  const shape = { type: 'rect', fx: .2, fy: .3, fw: .1, fh: .2, size: 12, linkId: 'delete-shape' };
  const arrow = { type: 'arrow', x1: .3, y1: .4, x2: .6, y2: .7,
    connectorStyle: 'curve', connectorControlX: .5, connectorControlY: .2,
    attachTo: shape.linkId };
  const otherArrow = { type: 'arrow', x1: .1, y1: .1, x2: .2, y2: .2, attachTo: 'other-shape' };
  const shapeSnapshot = objectScaleSnapshot(shape);
  const arrowSnapshot = objectScaleSnapshot(arrow);

  applyObjectScaleSnapshot(shape, shapeSnapshot, .1, .2, 2);
  applyObjectScaleSnapshot(arrow, arrowSnapshot, .1, .2, 2);
  assert.deepEqual([shape.fx, shape.fy, shape.fw, shape.fh, shape.size]
    .map(value => +value.toFixed(6)), [.3, .4, .2, .4, 24]);
  assert.deepEqual([arrow.x1, arrow.y1, arrow.x2, arrow.y2,
    arrow.connectorControlX, arrow.connectorControlY].map(value => +value.toFixed(6)),
  [.5, .6, 1.1, 1.2, .9, .2]);

  const deletion = connectedDeletionSet([shape, arrow, otherArrow], [shape]);
  assert.equal(deletion.has(shape), true);
  assert.equal(deletion.has(arrow), true);
  assert.equal(deletion.has(otherArrow), false);
});

test('polyline rotations use page pixels and Shift vertices keep the preceding vertical connection', () => {
  const points = [[.2, .2], [.6, .2], [.6, .4]];
  const original = structuredClone(points);
  const rotated = rotatePolylinePoints(points, 200, 400, 90);
  assert.deepEqual(rotated.map(point => point.map(value => +value.toFixed(6))),
    [[.6, .2], [.6, .4], [.2, .4]]);
  const distance = (a, b) => Math.hypot((a[0] - b[0]) * 200, (a[1] - b[1]) * 400);
  for (const angle of [0, 27, 90, 180, 270, 360, -45]) {
    const next = rotatePolylinePoints(points, 200, 400, angle);
    for (let index = 1; index < points.length; index++)
      assert.ok(Math.abs(distance(points[index - 1], points[index]) -
        distance(next[index - 1], next[index])) < 1e-8);
  }
  assert.deepEqual(rotatePolylinePoints([], 200, 400, 90), []);
  assert.deepEqual(constrainPolylineVertex(points, 1, [.8, .7]), [.2, .7]);
  assert.deepEqual(constrainPolylineVertex(points, 0, [.8, .7]), [.6, .7]);
  assert.deepEqual(constrainPolylineVertex([[.1, .1], [.4, .2], [.9, .8]], 0, [.7, .5], true), [.9, .5]);
  assert.deepEqual(constrainPolylineVertex([], 0, [.8, .7]), [.8, .7]);
  assert.deepEqual(points, original, 'rotation and snapping must not mutate the drag snapshot');
});

test('arrow rotation moves joints in page pixels while an attached start stays fixed', () => {
  const attached = {
    type: 'arrow', x1: .2, y1: .2, x2: .6, y2: .2, rot: 33,
    connectorStyle: 'curve', connectorControlX: .4, connectorControlY: .1,
    connectorBendX: .5, connectorBendY: .15, connectorStep: .35,
    attachTo: 'shape-1', attachPoint: 'start', connectorAnchorX: .5, connectorAnchorY: 0,
  };
  rotateConnectorJoints(attached, 200, 400, 90, 'start');
  assert.deepEqual([attached.x1, attached.y1, attached.x2, attached.y2,
    attached.connectorControlX, attached.connectorControlY,
    attached.connectorBendX, attached.connectorBendY].map(value => +value.toFixed(6)),
  [.2, .2, .2, .4, .4, .3, .3, .35]);
  assert.equal(attached.rot, 0);
  assert.equal(attached.attachTo, 'shape-1');
  assert.equal(attached.attachPoint, 'start');
  assert.deepEqual([attached.connectorAnchorX, attached.connectorAnchorY], [.5, 0]);
  assert.equal(attached.connectorStep, .35);

  const free = { type: 'arrow', x1: .2, y1: .2, x2: .6, y2: .2 };
  rotateConnectorJoints(free, 200, 400, 90);
  assert.deepEqual([free.x1, free.y1, free.x2, free.y2].map(value => +value.toFixed(6)),
    [.4, .1, .4, .3]);
});

test('a manually chosen shape port survives locked bends, route changes, shape rotation and resize', () => {
  const shape = { type: 'rect', fx: .3, fy: .3, fw: .25, fh: .2, linkId: 'manual-port' };
  for (const rotation of [0, 37, 90]) {
    shape.rot = rotation;
    for (const port of shapeSideMidpoints(shape, 800, 1100)) {
      const vector = shapeAnchorVector(shape, port[0], port[1], 800, 1100);
      const arrow = { type: 'arrow', x1: 0, y1: 0, x2: .1, y2: .85,
        attachTo: shape.linkId, attachPoint: 'start', connectorAnchor: 'side-midpoints',
        connectorAnchorX: vector[0], connectorAnchorY: vector[1],
        connectorControlX: .95, connectorControlY: .85,
        connectorBendX: .95, connectorBendY: .85, connectorStep: .25 };
      for (const connectorStyle of ['straight', 'curve', 'angled', 'step']) {
        arrow.connectorStyle = connectorStyle;
        syncPageConnectors({ texts: [shape, arrow] }, 800, 1100);
        assert.ok(Math.hypot(arrow.x1 - port[0], arrow.y1 - port[1]) < 1e-8, connectorStyle);
        assert.deepEqual([arrow.x2, arrow.y2], [.1, .85], 'choosing a port does not move the arrow head');
      }
    }
  }
  Object.assign(shape, { rot: 0, fw: .4, fh: .3 });
  const edgeArrow = { type: 'arrow', x1: 0, y1: 0, x2: .8, y2: .85,
    attachTo: shape.linkId, attachPoint: 'start', connectorStyle: 'curve', connectorAnchor: 'edge',
    connectorAnchorX: -.5, connectorAnchorY: -.25, connectorControlX: .9, connectorControlY: .9 };
  syncPageConnectors({ texts: [shape, edgeArrow] }, 800, 1100);
  assert.deepEqual([edgeArrow.x1, edgeArrow.y1].map(value => +value.toFixed(6)), [.3, .375]);
});

test('arrow head resize vectors cover each ornament and preserve size deltas at every zoom', () => {
  assert.deepEqual(arrowHeadResizeVectors({ type: 'line' }), []);
  for (const arrowEndType of ARROW_END_TYPES) {
    const vectors = arrowHeadResizeVectors({ type: 'arrow', arrowEndType });
    assert.equal(vectors.length, arrowEndType === 'none' ? 0 : 2);
    for (const vector of vectors) {
      assert.ok(vector[0] < 0, 'head-size handles sit behind the endpoint handle');
      for (const zoom of [.5, 1, 2, 4]) {
        assert.ok(Math.abs(arrowHeadSizeDelta(vector, vector[0] * 24 * zoom,
          vector[1] * 24 * zoom, zoom) - 24) < 1e-8);
        assert.ok(Math.abs(arrowHeadSizeDelta(vector, vector[0] * -8 * zoom,
          vector[1] * -8 * zoom, zoom) + 8) < 1e-8);
      }
    }
  }
  assert.equal(arrowHeadSizeDelta([0, 0], 100, 100), 0);
});

test('page range parsing retains normalization and rejection rules', () => {
  for (const [value, max, expected] of [
    ['1,3-5', 5, [0, 2, 3, 4]],
    ['5-3,1,3', 5, [0, 2, 3, 4]],
    ['1,1,2', 5, [0, 1]],
    ['', 5, null],
    ['0', 5, null],
    ['1-6', 5, null],
    ['1,a', 5, null],
  ]) assert.deepEqual(parseRange(value, max), expected, value);
});

test('rotation, coordinate, and crop calculations retain table outputs', () => {
  assert.equal(objRotation({ rot: '90' }), 90);
  assert.equal(objRotation({ rot: 'bad' }), 0);
  assert.equal(normRotation(-90), 270);
  assert.equal(normRotation(720.001), 0);
  assert.deepEqual(rotateScreenDelta(1, 0, 90).map(value => Math.round(value)), [0, 1]);
  assert.deepEqual(rotateScreenPoint(2, 1, 1, 1, 90).map(value => Math.round(value)), [1, 2]);
  assert.deepEqual(unrotFrac(0.2, 0.3, 90), [0.3, 0.8]);
  assert.deepEqual(rotFrac(0.2, 0.3, 270), [0.3, 0.8]);
  assert.deepEqual(pagePtToFrac({}, [0, 0, 200, 100], 0, 50, 25), [0.25, 0.75]);
  assert.deepEqual(pagePtToFrac({ crop: [0.1, 0.2, 0.5, 0.5] }, [0, 0, 200, 100], 0, 50, 50), [0.3, 0.6]);
  assert.deepEqual(pageRectToDispRect({}, [0, 0, 200, 100], 0, [20, 10, 100, 50]), {
    l: 0.1, t: 0.5, w: 0.4, h: 0.4,
  });
  assert.deepEqual(cropToViewportPoints([0.1, 0.2, 0.5, 0.6], 1000, 500), [[100, 100], [600, 400]]);
  assert.deepEqual(cropSelectionRectFromPoints([80, 90], [-20, 250], 200, 180), {
    x: 0, y: 90, w: 80, h: 90,
  });
  assert.deepEqual(cropSelectionRectFromPoints([160, 150], [40, 30], 200, 180), {
    x: 40, y: 30, w: 120, h: 120,
  });
  assert.deepEqual(tappedCropSelectionRect([5, 5], 200, 100), {
    x: 0, y: 0, w: 112.00000000000001, h: 48,
  });
  assert.deepEqual(pdfRectToViewport({
    convertToViewportPoint: (x, y) => [x * 2 + 5, 100 - y * 2],
  }, [10, 20, 30, 40]), [25, 60, 65, 20]);
  assert.deepEqual(pdfRectToViewport({ transform: [2, 0, 0, -2, 5, 100] },
    [10, 20, 30, 40]), [25, 60, 65, 20]);
  assert.deepEqual(pdfPointBounds([600, 100], [100, 400]), { x: 100, y: 100, w: 500, h: 300 });
  assert.deepEqual(resizedCropGeometry([600, 800], [.1, .2, .5, .25]), {
    fullWidth: 600, fullHeight: 800, width: 300, height: 200,
    left: 60, top: 160, bottom: 440,
  });
});

test('render and thumbnail keys retain exact compatibility strings', () => {
  const page = {
    src: 3, idx: 4, rot: 90, resize: [500, 700], blank: undefined,
    crop: [0.1, 0.2, 0.7, 0.6],
    texts: [{ _id: 55, type: 'img', data: 'data:image/png;base64,ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' }],
  };
  assert.equal(makeRenderKey(page, 1.25), '1.25:3:4:90:500x700::0.1,0.2,0.7,0.6');
  assert.equal(makeThumbKey(page), '3:4:90:500x700::0.1,0.2,0.7,0.6:' + JSON.stringify([{
    _id: 0, type: 'img', data: page.texts[0].data.length + ':' + page.texts[0].data.slice(13, 45),
  }]));
});

test('source reachability preserves source checks and caller-owned Set identity', () => {
  const into = new Set([99]);
  const result = collectPageSourceRefs([
    { src: 1, texts: [{ clipSrc: 2 }, { clipSrc: 3 }] },
    { src: null, texts: [{ clipSrc: 4 }] },
  ], into, id => id === 2 || id === 4);
  assert.equal(result, into);
  assert.deepEqual([...result], [99, 1, 2, 4]);
});

test('autosave and detached DTOs retain field names and internal-field filtering', () => {
  const page = {
    src: 1, idx: 0, rot: 0, blank: undefined, resize: undefined, crop: undefined,
    _w1: 612, texts: [{ _id: 9, _w1: 3, type: 'text', text: '저장' }],
  };
  const documentState = {
    name: '문서', dirty: true, fileHandle: null, pages: [page], selected: new Set([0]),
    _atSavedState: false,
    zoom: 1.5, fitWidth: false, currentPage: 0, lastSelected: 0, scrollTop: 20,
    undoStack: [{ pages: [page] }], redoStack: [],
  };
  const autosave = toAutosaveDocumentDto(documentState);
  assert.deepEqual(Object.keys(autosave).sort(), ['dirty', 'handle', 'name', 'pages', 'scrollTop']);
  assert.equal(autosave.scrollTop, 20);
  assert.deepEqual(Object.keys(autosave.pages[0]).sort(), ['blank', 'crop', 'idx', 'resize', 'rot', 'src', 'texts']);
  assert.equal('_id' in autosave.pages[0].texts[0], false);
  assert.equal('_w1' in autosave.pages[0].texts[0], false);

  const detached = toDetachedDocumentDto(documentState);
  assert.deepEqual(Object.keys(detached).sort(), [
    'atSavedState', 'currentPage', 'dirty', 'fileHandle', 'fitWidth', 'lastSelected', 'name',
    'pages', 'redoStack', 'scrollTop', 'selected', 'undoStack', 'zoom',
  ]);
  assert.equal(detached.atSavedState, false);
  assert.equal(detached.undoStack[0].atSavedState, false);
  assert.deepEqual(detached.selected, [0]);
  assert.equal('_w1' in detached.pages[0], false);
});

test('transferred-page remapping keeps trusted and sanitized compatibility paths', () => {
  const page = {
    src: 10, idx: 0, rot: 0,
    texts: [
      { _id: 1, type: 'text', text: 'A', clipSrc: 11, clipIdx: 2, clipBox: [0, 0, 1, 1] },
      { _id: 2, type: 'text', text: 'B', clipSrc: 12, clipIdx: 3, clipBox: [0, 0, 1, 1] },
    ],
  };
  const ids = new Map([[10, 20], [11, 21]]);
  const trusted = remapTransferPageDto(page, id => ids.get(id), value => value, true);
  assert.equal(trusted.src, 20);
  assert.equal(trusted.texts[0].clipSrc, 21);
  assert.equal(trusted.texts[1].clipSrc, undefined);
  assert.equal(trusted.texts[1].clipIdx, undefined);

  const sanitized = remapTransferPageDto(page, id => ids.get(id), value => (
    value.text === 'A' ? { type: 'text', text: value.text, clipSrc: value.clipSrc } : null
  ), false);
  assert.deepEqual(sanitized.texts, [{ type: 'text', text: 'A', clipSrc: 21 }]);
});


test('manually anchored two-leg arrows keep one elbow and a stable port while crossing diagonals', () => {
  const shape = { type: 'rect', fx: .1, fy: .1, fw: .2, fh: .2, linkId: 'stable-port-1' };
  const arrow = { type: 'arrow', x1: .3, y1: .2, x2: .8, y2: .3,
    connectorStyle: 'angled', attachTo: shape.linkId, attachPoint: 'start',
    connectorAnchorX: .5, connectorAnchorY: 0 };
  const page = { texts: [shape, arrow] };
  syncPageConnectors(page, 600, 840);
  const first = connectorPolyline(arrow), port = first[0];
  assert.equal(first.length, 3);
  for (let i = 0; i < 20; i++) {
    arrow.x2 = .8 - i * .01; arrow.y2 = .3 + i * .02;
    syncPageConnectors(page, 600, 840);
    const points = connectorPolyline(arrow);
    assert.equal(points.length, 3);
    assert.deepEqual(points[0], port);
    assert.equal(points[1][0], points[2][0]);
    assert.equal(points[1][1], points[0][1]);
  }
  const restored = sanitizeTextObject({ ...arrow, arrowHeadRotation: 90 });
  assert.equal(restored.connectorAxis, 'x');
  assert.equal(restored.arrowHeadRotation, 90);
  assert.deepEqual(connectorPolyline(restored), connectorPolyline(arrow));
  assert.ok(arrowBodyEndInset(restored, 20) < .001);
});

test('automatic two-leg roots follow a moved shape without pinning or crossing its interior', () => {
  const width = 600, height = 840;
  for (const connectorAnchor of ['side-midpoints', 'edge']) for (const rot of [0, 37, 90]) {
    const shape = { type: 'rect', fx: .1, fy: .4, fw: .12, fh: .1, rot, linkId: 'auto-root' };
    let arrow = { type: 'arrow', x1: 0, y1: 0, x2: .5, y2: .5,
      connectorStyle: 'angled', connectorAnchor, attachTo: shape.linkId, attachPoint: 'start' };
    const page = { texts: [shape, arrow] };
    for (let angle = 0; angle < 360; angle += 15) {
      shape.fx = .5 + .28 * Math.cos(angle * Math.PI / 180) - shape.fw / 2;
      shape.fy = .5 + .28 * Math.sin(angle * Math.PI / 180) - shape.fh / 2;
      syncPageConnectors(page, width, height);
      assert.equal(arrow.connectorAnchorX, undefined, 'automatic root must not become a saved manual port');
      assert.equal(arrow.connectorAnchorY, undefined);
      const points = connectorPolyline(arrow);
      assert.equal(points.length, 3, 'keep exactly two straight legs');
      assert.deepEqual(points.at(-1), [.5, .5], 'moving the shape must not move the arrow head');
      for (let segment = 1; segment < points.length; segment++) for (let step = 1; step < 20; step++) {
        const t = step / 20, a = points[segment - 1], b = points[segment];
        const dx = (a[0] + (b[0] - a[0]) * t - shape.fx - shape.fw / 2) * width;
        const dy = (a[1] + (b[1] - a[1]) * t - shape.fy - shape.fh / 2) * height;
        const [x, y] = rotateScreenDelta(dx, dy, -rot);
        assert.ok(Math.abs(x) >= shape.fw * width / 2 - 1e-7 ||
          Math.abs(y) >= shape.fh * height / 2 - 1e-7,
          `${connectorAnchor}, rotation ${rot}, orbit ${angle}: line crosses shape`);
      }
      if (angle === 180) {
        arrow = sanitizeTextObject(JSON.parse(JSON.stringify(arrow)));
        page.texts[1] = arrow;
      }
    }
  }
});


test('closed arrow heads stop bent and curved bodies at the real outline', () => {
  const path = [[-100, 20], [0, 20], [0, 0]];
  for (const [kind, x] of [['circle-open', -Math.sqrt(34 ** 2 - 20 ** 2)],
    ['circle-filled', -Math.sqrt(38 ** 2 - 20 ** 2)], ['square', -35]]) {
    const object = { type: 'arrow', arrowEndType: kind };
    const clipped = arrowBodyPolyline(object, path, 100);
    assert.equal(clipped.length, 2, 'the elbow inside the head is removed');
    assert.ok(Math.abs(clipped[1][0] - x) < 1e-8);
    assert.equal(clipped[1][1], 20);
    assert.deepEqual(arrowBodyPolyline(object, [[0, 10], [0, 0]], 100), []);
    const longer = [[-100, 80], [-100, 20], [0, 20], [0, 0]];
    assert.deepEqual(arrowBodyPolyline(object, longer, 100).slice(0, 2), longer.slice(0, 2));
  }
  assert.deepEqual(path, [[-100, 20], [0, 20], [0, 0]], 'editing endpoints stay unchanged');
  const curve = connectorPolyline({ type: 'arrow', connectorStyle: 'curve',
    x1: -100, y1: 40, x2: 0, y2: 0, connectorControlX: 0, connectorControlY: 40 });
  const curves = arrowBodyPolyline({ type: 'arrow', arrowEndType: 'circle-open' }, curve, 100);
  assert.ok(Math.abs(Math.hypot(...curves.at(-1)) - 34) < 1e-8);
  for (const point of curves.slice(0, -1)) assert.ok(Math.hypot(...point) >= 34);

  for (const rotation of [0, 17, 45, 100, -35]) {
    const object = { type: 'arrow', arrowEndType: 'square', arrowHeadRotation: rotation };
    const body = arrowBodyPolyline(object, path, 100);
    const angle = (rotation - 90) * Math.PI / 180;
    const extent = ([x, y]) => Math.max(Math.abs(x * Math.cos(angle) + y * Math.sin(angle)),
      Math.abs(-x * Math.sin(angle) + y * Math.cos(angle)));
    assert.ok(Math.abs(extent(body.at(-1)) - 35) < 1e-8, 'rotated square outline');
    for (const p of body.slice(0, -1)) assert.ok(extent(p) >= 35);
    const reflected = arrowBodyPolyline(object, path.map(([x, y]) => [x, -y]), 100, -rotation);
    body.forEach(([x, y], i) => assert.ok(Math.hypot(x - reflected[i][0], y + reflected[i][1]) < 1e-8,
      'PDF and screen coordinates agree'));
    for (const scale of [.25, 2, 4]) {
      const scaled = arrowBodyPolyline(object, path.map(p => p.map(v => v * scale)), 100 * scale);
      body.forEach((p, i) => p.forEach((v, j) => assert.ok(Math.abs(scaled[i][j] / scale - v) < 1e-8)));
    }
  }
  for (const kind of ['none', 'arrow-open'])
    assert.deepEqual(arrowBodyPolyline({ type: 'arrow', arrowEndType: kind }, path, 100), path);
});

test('copied region uses the same fractional bounds in cropped and rotated PDF coordinates', () => {
  const page = { crop: [.073, .12, .81, .73] };
  const view = [10.5, -3.2, 605.82, 838.72];
  const rect = [.243986, .211124, .1452999, .06502998];
  for (const angle of [0, 90, 180, 270]) {
    const pdfBox = regionPdfBounds(page, view, angle, ...rect);
    const display = pageRectToDispRect(page, view, angle, pdfBox);
    [display.l, display.t, display.w, display.h].forEach((value, i) =>
      assert.ok(Math.abs(value - rect[i]) < 1e-12));
    const copied = sanitizeTextObject({ type: 'img', data: 'data:image/png;base64,AA==',
      clipSrc: 1, clipIdx: 0, clipBox: pdfBox, clipOpaque: true, clipRotation: angle });
    assert.equal(copied.clipOpaque, true);
    assert.equal(copied.clipRotation, angle);
    assert.deepEqual(copied.clipBox, pdfBox);
  }
});

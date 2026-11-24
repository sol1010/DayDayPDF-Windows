import test from 'node:test';
import assert from 'node:assert/strict';
import { INK_BRUSHES, createInkObject, inkGeometry, inkSvgPath } from '../../src/core/ink.js';
import { sanitizeTextObject, clonePage, toAutosaveDocumentDto } from '../../src/core/compatibility.js';
import { translateObjectBundle, objectScaleSnapshot, applyObjectScaleSnapshot } from '../../src/core/shape-connectors.js';
import { createOverlayCanvasRenderer } from '../../src/rendering/overlay-canvas-renderer.js';

test('freehand metadata survives sanitizing, copying, moving and autosave without shared points', () => {
  const object = createInkObject([[15,30,.2],[70,50,.7],[90,15,1]],595,842,{brush:'pen',sw:5});
  assert.deepEqual(sanitizeTextObject(object), object);
  const page = {texts:[object]}, copy = clonePage(page);
  copy.texts[0].points[0][0] = 123;
  assert.notEqual(object.points[0][0],123);
  const saved = toAutosaveDocumentDto({pages:[page]}).pages[0].texts[0];
  assert.deepEqual(saved.points,object.points);
  saved.points[0][0]=12;
  assert.notEqual(object.points[0][0],12);
  const points = structuredClone(object.points), x=object.fx;
  translateObjectBundle([object],0,.1,.2);
  assert.equal(object.fx,x+.1); assert.deepEqual(object.points,points);
  const snapshot=objectScaleSnapshot(object);
  assert.equal(snapshot.kind,'box');
  applyObjectScaleSnapshot(object,snapshot,0,0,2);
  assert.equal(object.fw,snapshot.fw*2); assert.deepEqual(object.points,points);
});

test('brushes use distinct finite vector geometry, including a tap and pen pressure', () => {
  const paths = new Set();
  for(const brush of Object.keys(INK_BRUSHES)) {
    const object=createInkObject([[10,10,.2],[40,50,.8],[65,5,.5]],100,100,{brush,sw:10});
    const before=structuredClone(object), geometry=inkGeometry(object);
    assert.ok(geometry.length>1);
    for(const polygon of geometry) {
      assert.ok(polygon.flat().every(Number.isFinite));
      const area=polygon.reduce((n,p,i)=>{const q=polygon[(i+1)%polygon.length];return n+p[0]*q[1]-p[1]*q[0];},0);
      assert.ok(area>=-1e-8,'compound fill subpaths use one winding for translucent overlaps');
    }
    const scaled=inkGeometry(object,object.inkW*2,object.inkH*3);
    assert.deepEqual(scaled[0][0],[geometry[0][0][0]*2,geometry[0][0][1]*3]);
    paths.add(inkSvgPath(geometry));assert.deepEqual(object,before);
    assert.ok(inkGeometry(createInkObject([[1,2,.5]],100,100,{brush}))[0].length>=4);
  }
  assert.equal(paths.size,4);
  const thin=createInkObject([[10,10,.1]],100,100,{brush:'pen',sw:10});
  const thick=createInkObject([[10,10,1]],100,100,{brush:'pen',sw:10});
  const span=o=>Math.max(...inkGeometry(o)[0].map(p=>p[0]))-Math.min(...inkGeometry(o)[0].map(p=>p[0]));
  assert.ok(span(thick)>span(thin)*2);
});

test('untrusted or very long strokes are bounded and malformed points cannot enter drawing paths', () => {
  assert.equal(createInkObject([],595,842),null);
  const long=createInkObject(Array.from({length:30000},(_,i)=>[i/50,Math.sin(i/10)*10,.5]),595,842);
  assert.ok(long.points.length<=4096);
  const safe=sanitizeTextObject({...long,points:[[NaN,2],[3,Infinity],[-100,1,4],[1e8,2,-1]]});
  assert.deepEqual(safe.points,[[0,1,1],[safe.inkW,2,.05]]);
  assert.equal(sanitizeTextObject({...long,points:[[NaN,Infinity]]}),null);
  assert.equal(sanitizeTextObject({...long,inkW:0}),null);
});

test('thumbnail rendering fills a translucent stroke once and uses multiply for highlighter', () => {
  const calls=[], ctx=new Proxy({}, {get:(_,key)=>(...args)=>calls.push([key,...args]),set:(_,key,value)=>(calls.push([key,value]),true)});
  const renderer=createOverlayCanvasRenderer({ImageConstructor:class{},isTextObject:()=>false,
    colorWithAlpha:(c,a)=>c+':'+a,opacityOf:(o,key)=>o[key]??1,rotationOf:o=>o.rot||0,
    inkGeometryOf:inkGeometry,onImagePending:()=>{}});
  const object=createInkObject([[10,20],[40,20],[10,20]],100,100,{brush:'highlighter'});
  renderer.drawObjects({texts:[object]},{width:200,height:200,getContext:()=>ctx},100);
  assert.equal(calls.filter(c=>c[0]==='fill').length,1);
  assert.ok(calls.some(c=>c[0]==='globalCompositeOperation'&&c[1]==='multiply'));
  assert.ok(calls.some(c=>c[0]==='fillStyle'&&c[1].endsWith(':0.35')));
  calls.length=0;object.strokeOn=false;
  renderer.drawObjects({texts:[object]},{width:200,height:200,getContext:()=>ctx},100);
  assert.equal(calls.filter(c=>c[0]==='fill').length,0);
});


test('dense straight strokes keep endpoints and pressure changes without unnecessary PDF vertices', () => {
  const points = Array.from({length:3000},(_,i)=>[i/10,10,.5]);
  const stroke = createInkObject(points,595,842);
  assert.equal(stroke.points.length,2);
  points[1500][2] = 1;
  const pressured = createInkObject(points,595,842);
  assert.ok(pressured.points.length > 2 && pressured.points.length < 10);
  assert.ok(pressured.points.some(p => p[2] === 1));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeObjectBox, objectReflectionMatrix, originalResizeMatrix } from '../../src/core/object-resize.js';
import { pagePtToFrac, pageFracToPt } from '../../src/core/geometry.js';
import { objectScaleSnapshot, applyObjectScaleSnapshot, shapeBoundaryPoint, shapeAnchorVector, syncAttachedArrow } from '../../src/core/shape-connectors.js';
import { sanitizeTextObject } from '../../src/core/compatibility.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7, a+' != '+b);
const point=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
const start={l:100,t:100,w:80,h:40};
test('every box handle crosses its fixed opposite side without a minimum size',()=>{
 for(const dir of ['nw','n','ne','e','se','s','sw','w']) {
  const hx=dir.includes('e')?1:dir.includes('w')?-1:0;
  const hy=dir.includes('s')?1:dir.includes('n')?-1:0;
  const tiny=resizeObjectBox(start,dir,-hx*79.999,-hy*39.999);
  near(tiny.w,hx?.001:80);near(tiny.h,hy?.001:40);
  const b=resizeObjectBox(start,dir,-hx*120,-hy*60);
  near(b.w,hx?40:80);near(b.h,hy?20:40);
  assert.equal(b.flipX,!!hx);assert.equal(b.flipY,!!hy);
  near(b.l+(hx<0?0:b.w),hx?start.l+(hx>0?0:80):180);
 }
});
test('zero is continuous and reversing within the same drag restores the original orientation',()=>{
 const b=resizeObjectBox(start,'se',-80,-40);assert.equal(b.w,0);assert.equal(b.h,0);
 assert.deepEqual(resizeObjectBox(start,'se',0,0),{...start,flipX:false,flipY:false});
});
test('rotated and already mirrored handles keep the opposite corner stationary',()=>{
 for(const rot of [0,33,90,180,270])for(const flipX of [false,true])for(const flipY of [false,true]) {
  const a={...start,rot,flipX,flipY},r=rot*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  const corner=(b,dx,dy)=>[b.l+b.w/2+c*dx-s*dy,b.t+b.h/2+s*dx+c*dy];
  const fixed=corner(a,(flipX?1:-1)*40,(flipY?1:-1)*20);
  const lx=(flipX?1:-1)*120,ly=(flipY?1:-1)*60;
  const b=resizeObjectBox(a,'se',lx*c-ly*s,lx*s+ly*c);
  const actual=corner(b,(b.flipX?1:-1)*b.w/2,(b.flipY?1:-1)*b.h/2);
  near(actual[0],fixed[0]);near(actual[1],fixed[1]);
  const restored=resizeObjectBox({...b,rot},'se',-lx*c+ly*s,-lx*s-ly*c);
  for(const k of ['l','t','w','h'])near(restored[k],a[k]);
  assert.equal(restored.flipX,flipX);assert.equal(restored.flipY,flipY);
 }
});
test('proportional corner resize keeps aspect ratio while crossing both axes',()=>{
 const b=resizeObjectBox(start,'se',-120,-60,true);near(b.w/b.h,2);assert.ok(b.flipX&&b.flipY);
});
test('group resize preserves positive geometry and mirrors all content without a font-size floor',()=>{
 const object={fx:.4,fy:.4,fw:.2,fh:.1,size:12,rot:33,flipX:true};
 const snapshot=objectScaleSnapshot(object);
 applyObjectScaleSnapshot(object,snapshot,.2,.2,-.1);
 near(object.fw,.02);near(object.fh,.01);near(object.size,1.2);
 assert.equal(object.flipX,false);assert.equal(object.flipY,true);near(object.rot,33);
 applyObjectScaleSnapshot(object,snapshot,.2,.2,1);
 near(object.fx,.4);assert.equal(object.flipX,true);assert.equal(object.flipY,false);
});
test('PDF reflection preserves the center and mirrors the rotated local axes',()=>{
 for(const rot of [0,33,90,180,270])for(const fx of [false,true])for(const fy of [false,true]) {
  const m=objectReflectionMatrix(200,300,rot,fx,fy),r=rot*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  const p=point(m,200+30*c-20*s,300+30*s+20*c);
  near(p[0],200+(fx?-30:30)*c-(fy?-20:20)*s);
  near(p[1],300+(fx?-30:30)*s+(fy?-20:20)*c);
 }
});
test('native resize retains reflection for rotated, cropped and resized PDF pages',()=>{
 for(const rot of [0,90,180,270])for(const page of [{},{crop:[.1,.2,.7,.6]},{resize:[900,700],crop:[.1,.1,.8,.7]}]) {
  const view=[20,40,620,840],w=600,h=800;
  const toDisplay=(x,y)=>{const p=pagePtToFrac(page,view,rot,x,y);return[p[0]*w,p[1]*h];};
  const toPage=(x,y)=>pageFracToPt(page,view,rot,x/w,y/h);
  const b=resizeObjectBox(start,'se',-120,20);
  const m=originalResizeMatrix(start,b,toDisplay,toPage);
  for(const [x,y] of [[100,100],[180,140],[120,125]]) {
   const old=toPage(x,y),actual=point(m,...old),expected=toPage(100-(x-100)*.5,100+(y-100)*1.5);
   near(actual[0],expected[0]);near(actual[1],expected[1]);
  }
 }
 assert.equal(originalResizeMatrix(start,{...start,w:0},()=>{},()=>{}),null);
});
test('sanitized saved metadata keeps both mirror axes and subpixel sizes',()=>{
 const clean=sanitizeTextObject({type:'rect',fx:.2,fy:.3,fw:.000001,fh:.000002,flipX:true,flipY:true});
 assert.equal(clean.flipX,true);assert.equal(clean.flipY,true);near(clean.fw,.000001);
 assert.equal(sanitizeTextObject({type:'rect',flipX:'false'}).flipX,false);
});
test('mirrored triangles expose the actual boundary and retain their attached port',()=>{
 const shape={type:'triangle',fx:.2,fy:.2,fw:.4,fh:.4,flipY:true,linkId:'shape-test'};
 const top=shapeBoundaryPoint(shape,.5,0);near(top[1],.2);
 const vector=shapeAnchorVector(shape,top[0],top[1]);
 const arrow={type:'arrow',attachTo:shape.linkId,connectorAnchor:'edge',connectorAnchorX:vector[0],connectorAnchorY:vector[1],x2:.8,y2:.8};
 syncAttachedArrow({texts:[shape,arrow]},arrow);near(arrow.x1,top[0]);near(arrow.y1,top[1]);
});

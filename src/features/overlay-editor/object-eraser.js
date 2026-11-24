export function eraserBounds(points, diameter) {
  const r = diameter / 2;
  let l = Infinity, t = Infinity, right = -Infinity, bottom = -Infinity;
  for (const [x, y] of points) {
    l = Math.min(l, x - r); t = Math.min(t, y - r);
    right = Math.max(right, x + r); bottom = Math.max(bottom, y + r);
  }
  return { l, t, w: right - l, h: bottom - t };
}

export function visitEraserDabs(points, size, tip, dab) {
  let distance = 0;
  for (let i=1; i<points.length; i++) distance += Math.hypot(points[i][0]-points[i-1][0], points[i][1]-points[i-1][1]);
  const spacing = Math.max(.05, size * (tip === 'soft' ? .14 : .075), distance / 32768);
  dab(points[0][0],points[0][1]);
  let untilNext = spacing;
  for (let i=1;i<points.length;i++) {
    const [x,y] = points[i-1], dx = points[i][0]-x, dy = points[i][1]-y;
    const length = Math.hypot(dx,dy);
    for (; untilNext < length; untilNext += spacing) dab(x+dx*untilNext/length,y+dy*untilNext/length);
    untilNext -= length;
  }
  if (points.length > 1) dab(points.at(-1)[0],points.at(-1)[1]);
}

export function drawEraserTip(ctx, points, size, tip, color = '#000000') {
  if (!points.length || !(size > 0)) return;
  const r = size / 2;
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle = color;
  if (tip === 'round') {
    ctx.lineJoin = ctx.lineCap = 'round'; ctx.lineWidth = size;
    ctx.beginPath(); ctx.arc(points[0][0], points[0][1], r, 0, 2 * Math.PI); ctx.fill();
    ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
    for (const [x,y] of points) ctx.lineTo(x,y);
    ctx.stroke();
  } else {
    let stamp = null;
    if (tip === 'soft') {
      stamp = document.createElement('canvas'); stamp.width = stamp.height = 96;
      const sc = stamp.getContext('2d'), grad = sc.createRadialGradient(48,48,0,48,48,48);
      grad.addColorStop(0,color); grad.addColorStop(.35,color); grad.addColorStop(1,color+'00');
      sc.fillStyle = grad; sc.fillRect(0,0,96,96);
    }
    function dab(x,y) {
      if (stamp) ctx.drawImage(stamp,x-r,y-r,size,size);
      else if (tip === 'square') ctx.fillRect(x-r,y-r,size,size);
      else { ctx.beginPath(); ctx.ellipse(x,y,r,r*.25,-Math.PI/4,0,2*Math.PI); ctx.fill(); }
    }
    visitEraserDabs(points, size, tip, dab);
  }
  ctx.restore();
}

export function eraseCanvasStroke(canvas, bounds, points, style) {
  const sx = canvas.width / bounds.w, sy = canvas.height / bounds.h;
  const trail = eraserBounds(points,style.sw);
  const x = Math.max(0,Math.floor((trail.l-bounds.l)*sx)-1), y = Math.max(0,Math.floor((trail.t-bounds.t)*sy)-1);
  const w = Math.min(canvas.width,Math.ceil((trail.l+trail.w-bounds.l)*sx)+1)-x;
  const h = Math.min(canvas.height,Math.ceil((trail.t+trail.h-bounds.t)*sy)+1)-y;
  if (w<=0 || h<=0) return false;
  const ctx=canvas.getContext('2d'), before=ctx.getImageData(x,y,w,h).data;
  ctx.save(); ctx.setTransform(sx,0,0,sy,-bounds.l*sx,-bounds.t*sy);
  ctx.globalCompositeOperation='destination-out'; drawEraserTip(ctx,points,style.sw,style.tip); ctx.restore();
  const after=ctx.getImageData(x,y,w,h).data;
  for(let i=3;i<after.length;i+=4) if(after[i]!==before[i]) return true;
  return false;
}

export function replacePdfObjectForm(F, page, doc, index, sourceDoc, matrix) {
  const original = F.FPDFPage_GetObject(page,index);
  const external = F.FPDF_NewXObjectFromPage(doc,sourceDoc,0);
  if (!external) throw new Error('PDF form import failed');
  let form;
  try {
    form = F.FPDF_NewFormObjectFromXObject(external);
    if (!form) throw new Error('PDF form allocation failed');
    F.FPDFPageObj_Transform(form,...matrix);
    if (!F.FPDFPage_InsertObjectAtIndex(page,form,index)) throw new Error('PDF form insertion failed');
    form = null;
    if (!F.FPDFPage_RemoveObject(page,original)) throw new Error('PDF form replacement failed');
    F.FPDFPageObj_Destroy(original);
  } finally {
    if (form) F.FPDFPageObj_Destroy(form);
    F.FPDF_CloseXObject(external);
  }
}

export function replacePdfObjectBitmap(F, M, pg, doc, index, canvas, matrix) {
  const source = F.FPDFPage_GetObject(pg,index);
  const image = F.FPDFPageObj_NewImageObj(doc);
  if (!source || !image) throw new Error('PDF image object unavailable');
  let transferred = false;
  const bitmap = F.FPDFBitmap_Create(canvas.width,canvas.height,1);
  try {
    if (!bitmap) throw new Error('PDF bitmap allocation failed');
    const pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    const start = F.FPDFBitmap_GetBuffer(bitmap), stride = F.FPDFBitmap_GetStride(bitmap);
    for (let y=0;y<canvas.height;y++) {
      const row = start+y*stride;
      for (let x=0;x<canvas.width;x++) {
        const i=(y*canvas.width+x)*4, j=row+x*4;
        M.HEAPU8[j]=pixels[i+2]; M.HEAPU8[j+1]=pixels[i+1]; M.HEAPU8[j+2]=pixels[i]; M.HEAPU8[j+3]=pixels[i+3];
      }
    }
    if (!F.FPDFImageObj_SetBitmap(0,0,image,bitmap) || !F.FPDFImageObj_SetMatrix(image,...matrix))
      throw new Error('PDF image replacement failed');
    if (!F.FPDFPage_RemoveObject(pg,source)) throw new Error('PDF object removal failed');
    F.FPDFPageObj_Destroy(source);
    transferred = true;
    if (!F.FPDFPage_InsertObjectAtIndex(pg,image,index)) throw new Error('PDF object insertion failed');
  } finally {
    if (bitmap) F.FPDFBitmap_Destroy(bitmap);
    if (!transferred) F.FPDFPageObj_Destroy(image);
  }
}

export function fragmentStroke(object, width, height, points, { sw, tip }) {
  const w = object.fw * width, h = object.fh * height;
  const cx = object.fx * width + w / 2, cy = object.fy * height + h / 2;
  const angle = (object.rot || 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const sx = (object.flipX ? -1 : 1) / w, sy = (object.flipY ? -1 : 1) / h;
  const a = sx * cos, b = -sy * sin, c = sx * sin, d = sy * cos;
  const [x, y] = points[0];
  return { sw, tip, points: points.map(([px, py]) => [px - x, py - y]),
    matrix: [a, b, c, d, .5 + a*(x-cx) + c*(y-cy), .5 + b*(x-cx) + d*(y-cy)] };
}

export function cropFragmentStrokes(strokes, [x, y, w, h]) {
  return strokes.map(stroke => {
    const [a,b,c,d,e,f] = stroke.matrix;
    return { ...stroke, matrix: [a/w,b/h,c/w,d/h,(e-x)/w,(f-y)/h] };
  });
}

export function fragmentStrokeBounds(stroke) {
  const { l,t,w,h } = eraserBounds(stroke.points,stroke.sw), m = new DOMMatrix(stroke.matrix);
  const corners = [l,l+w].flatMap(x => [t,t+h].map(y => m.transformPoint({x,y})));
  const x = Math.max(0,Math.min(...corners.map(p => p.x))), y = Math.max(0,Math.min(...corners.map(p => p.y)));
  return [x,y, Math.min(1,Math.max(...corners.map(p => p.x)))-x, Math.min(1,Math.max(...corners.map(p => p.y)))-y];
}

export function applyFragmentStrokes(canvas, strokes, [x,y,w,h] = [0,0,1,1], checkHit = false) {
  const ctx = canvas.getContext('2d'), sx = canvas.width / w, sy = canvas.height / h;
  let changed = false;
  ctx.save();
  try {
    ctx.globalCompositeOperation = 'destination-out';
    for (const stroke of strokes) {
      ctx.setTransform(sx,0,0,sy,-x*sx,-y*sy);
      ctx.transform(...stroke.matrix);
      const [l,t,sw,sh] = fragmentStrokeBounds(stroke);
      if (sw <= 0 || sh <= 0 || l >= x+w || t >= y+h || l+sw <= x || t+sh <= y) continue;
      const left = Math.max(0,Math.floor((l-x)*sx)-1), top = Math.max(0,Math.floor((t-y)*sy)-1);
      const width = Math.min(canvas.width,Math.ceil((l+sw-x)*sx)+1)-left;
      const height = Math.min(canvas.height,Math.ceil((t+sh-y)*sy)+1)-top;
      const pixels = () => ctx.getImageData(left,top,width,height).data;
      const before = checkHit && pixels();
      drawEraserTip(ctx, stroke.points, stroke.sw, stroke.tip);
      if (before) {
        const after = pixels();
        for (let i=3; i<after.length; i+=4) if (before[i] !== after[i]) { changed = true; break; }
      }
    }
  } finally { ctx.restore(); }
  return changed;
}

const number = n => n.toFixed(10).replace(/\.?0+$/, '') || '0';
const op = (args, operator) => args.map(number).join(' ') + ' ' + operator;

function pdfBrush(stroke) {
  const { points, matrix, sw, tip } = stroke, r = sw / 2;
  const commands = ['q', op(matrix, 'cm'), '0 g 0 G'];
  if (tip === 'round' && points.length > 1) {
    commands.push('1 J 1 j', op([sw],'w'), op(points[0],'m'));
    for (let i=1; i<points.length; i++) commands.push(op(points[i],'l'));
    commands.push('S');
  } else {
    const dab = (x,y) => {
      if (tip === 'square') commands.push(op([x-r,y-r,sw,sw],'re f'));
      else {
        const k = r / Math.SQRT2;
        const transform = tip === 'chisel' ? [k,-k,k/4,k/4,x,y] : [r,0,0,r,x,y];
        commands.push('q', op(transform,'cm'), tip === 'soft' ? '/Multiply gs /Fade sh' : '/Disk Do', 'Q');
      }
    };
    if (tip === 'round') dab(...points[0]);
    else visitEraserDabs(points, sw, tip, dab);
  }
  commands.push('Q');
  return commands.join('\n');
}

export function maskEmbeddedFragment(doc, embedded, width, height, strokes, whiteBackground = false) {
  const ctx = doc.context, box = [0,0,width,height];
  const form = (data, bbox, resources, extra = {}) => ctx.flateStream(data, {
    Type:'XObject', Subtype:'Form', BBox:bbox, Resources:resources, ...extra });
  const disk = ctx.register(form('1 0 m 1 .552285 .552285 1 0 1 c -.552285 1 -1 .552285 -1 0 c ' +
    '-1 -.552285 -.552285 -1 0 -1 c .552285 -1 1 -.552285 1 0 c f', [-1,-1,1,1], {}));
  const resources = { XObject:{ Disk:disk } };
  if (strokes.some(s => s.tip === 'soft')) {
    resources.ExtGState = { Multiply:{ BM:'Multiply' } };
    resources.Shading = { Fade:{ ShadingType:3, ColorSpace:'DeviceGray', Coords:[0,0,.35,0,0,1],
      Function:{ FunctionType:2, Domain:[0,1], C0:[0], C1:[1], N:1 }, Extend:[true,false] } };
  }
  const group = { S:'Transparency', I:true, CS:'DeviceGray' };
  const mask = ctx.register(form(['1 g',op(box,'re f'),op([width,0,0,-height,0,height],'cm'),
    ...strokes.map(pdfBrush)].join('\n'), box, resources, { Group:group }));
  let artwork = ctx.register(ctx.lookup(embedded.ref));
  if (whiteBackground) artwork = ctx.register(form('1 g '+op(box,'re f')+' /Source Do',box,
    { XObject:{ Source:artwork } }, { Group:{ S:'Transparency', I:true, CS:'DeviceRGB' } }));
  ctx.assign(embedded.ref, form('q /Erase gs /Artwork Do Q',box,{
    XObject:{ Artwork:artwork }, ExtGState:{ Erase:{ Type:'ExtGState', SMask:{ S:'Luminosity', G:mask } } }
  }, { Group:{ S:'Transparency', I:true, CS:'DeviceRGB' } }));
}

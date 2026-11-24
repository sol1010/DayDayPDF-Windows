export function createRegionFragmentView({ viewer, paint }) {
  const cache = new Map();
  let frame = 0, painting = false, wanted = new Map(), visible = new Map();
  const sourceKey = object => [object.clipSrc,object.clipIdx,object.clipBox,object.clipRotation].join('|');
  function attach(svg, { canvas, region }) {
    const image = svg.firstElementChild;
    const imageWidth = image.width.baseVal.value, imageHeight = image.height.baseVal.value;
    const left = image.x.baseVal.value + region[0]*imageWidth, top = image.y.baseVal.value + region[1]*imageHeight;
    const width = region[2]*imageWidth, height = region[3]*imageHeight;
    if (svg.parentElement._ctx?.obj.clipErasures?.length) {
      const w = svg.width.baseVal.value, h = svg.height.baseVal.value;
      image.style.clipPath = 'path(evenodd, "M0 0H'+w+'V'+h+'H0Z M'+left+' '+top+
        'h'+width+'v'+height+'h-'+width+'Z")';
    } else image.style.clipPath = '';
    let layer = svg.querySelector('foreignObject');
    if (!layer) {
      layer = document.createElementNS(svg.namespaceURI, 'foreignObject');
      layer.setAttribute('pointer-events', 'none');
      svg.appendChild(layer);
    }
    layer.setAttribute('width', canvas.width);
    layer.setAttribute('height', canvas.height);
    layer.setAttribute('transform', `translate(${left} ${top}) scale(${width / canvas.width} ${height / canvas.height})`);
    canvas.style.cssText = 'display:block;width:100%;height:100%;border-radius:0;pointer-events:none';
    if (canvas.parentNode !== layer) layer.replaceChildren(canvas);
  }
  async function flush() {
    if (painting) return;
    painting = true;
    try {
      while (wanted.size) {
        const [object, job] = wanted.entries().next().value;
        wanted.delete(object);
        let entry = cache.get(object);
        if (entry?.key !== job.key) {
          let canvas;
          try { canvas = await paint(object, job.pixelsW, job.pixelsH, job.region); }
          catch (error) { console.warn('PDF 조각 표시 실패', error); continue; }
          const latest = visible.get(object);
          if (!latest?.svg.isConnected || latest.key !== job.key || sourceKey(object) !== job.source) {
            canvas.width = canvas.height = 0; continue;
          }
          if (entry) entry.canvas.width = entry.canvas.height = 0;
          entry = { key:job.key, source:job.source, region:job.region, canvas }; cache.set(object, entry);
        }
        const latest = visible.get(object);
        if (latest?.svg.isConnected && latest.key === entry.key) attach(latest.svg, entry);
      }
    } finally { painting = false; }
  }
  function measure() {
    frame = 0; wanted = new Map(); visible = new Map();
    const screen = viewer.getBoundingClientRect();
    for (const svg of viewer.querySelectorAll('svg[data-pdf-fragment]')) {
      const image = svg.firstElementChild, bounds = image.getBoundingClientRect();
      if (!bounds.width || bounds.right <= screen.left || bounds.left >= screen.right ||
          bounds.bottom <= screen.top || bounds.top >= screen.bottom) continue;
      const object = svg.parentElement._ctx?.obj, matrix = svg.getScreenCTM();
      if (!object || !matrix) continue;
      const w = image.width.baseVal.value, h = image.height.baseVal.value;
      if (!(w > 0 && h > 0)) continue;
      const x = image.x.baseVal.value, y = image.y.baseVal.value, inverse = matrix.inverse();
      const corners = [screen.left, screen.right].flatMap(px => [screen.top, screen.bottom]
        .map(py => new DOMPoint(px, py).matrixTransform(inverse)));
      const xs = corners.map(p => p.x-x), ys = corners.map(p => p.y-y);
      const tile = 256, start = v => Math.max(0, Math.floor(v/tile)*tile),
        end = (v, max) => Math.min(max, Math.ceil(v/tile)*tile);
      const left = start(Math.min(...xs)), top = start(Math.min(...ys));
      const width = end(Math.max(...xs),w)-left, height = end(Math.max(...ys),h)-top;
      if (width <= 0 || height <= 0) continue;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const pixelsW = Math.max(1,Math.round(width*dpr)), pixelsH = Math.max(1,Math.round(height*dpr));
      const region = [left/w,top/h,width/w,height/h];
      const source = sourceKey(object), key = [source,region,pixelsW,pixelsH].join('|');
      const job = { svg, pixelsW,pixelsH,region,source,key };
      visible.set(object,job);
      const entry = cache.get(object);
      if (entry?.key === key) attach(svg,entry);
      else wanted.set(object,job);
    }
    for (const [object,entry] of cache) if (!visible.has(object)) {
      const svg = entry.canvas.closest('svg');
      if (svg) svg.firstElementChild.style.clipPath = '';
      entry.canvas.remove(); entry.canvas.width = entry.canvas.height = 0; cache.delete(object);
    }
    void flush();
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(measure); }
  viewer.addEventListener('scroll', schedule, { passive:true });
  viewer.addEventListener('pointerup', schedule, { passive:true });
  viewer.addEventListener('keyup', schedule);
  new ResizeObserver(schedule).observe(viewer);
  function update(svg, object) {
    const entry = cache.get(object);
    if (entry && entry.source === sourceKey(object)) attach(svg,entry);
    else {
      svg.firstElementChild.style.clipPath = '';
      svg.querySelector('foreignObject')?.remove();
    }
    schedule();
  }
  return { update };
}

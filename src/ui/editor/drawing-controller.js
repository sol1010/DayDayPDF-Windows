export function createDrawingController({ windowObject, viewer, button, bar, canDraw, prepare,
  pageAt, createStroke, renderPreview, commitStroke, presets, openColor, closeColor, readPreferences, writePreferences, eraseStroke, renderEraserPreview, onBrushChange = () => {}, onModeChange = () => {} }) {
  const documentObject = windowObject.document;
  let active = false, draft = null, frame = 0, mounted = false;
  const touches = new Set(), disposers = [];
  const brushSelect = bar.querySelector('[data-ink-brush]');
  const widthInput = bar.querySelector('[data-ink-width]');
  const colorButton = bar.querySelector('[data-ink-color]');
  const opacityInput = bar.querySelector('[data-ink-opacity]');
  const opacityOutput = bar.querySelector('output');
  const preview = bar.querySelector('[data-ink-preview]');
  const tipSelect = bar.querySelector('[data-eraser-tip]');
  const remembered = {};
  let cursor = null;
  function hideCursor() { cursor?.remove(); cursor = null; }
  function updateCursor(event) {
    if (!active || brush !== 'eraser' || event.pointerType === 'touch') return;
    const page = viewer.contains(event.target) ? pageAt(event.target) : null;
    if (!page) { hideCursor(); return; }
    if (!cursor) {
      cursor = documentObject.createElement('div');
      cursor.className = 'eraserCursor';
      documentObject.body.appendChild(cursor);
    }
    const diameter = +widthInput.value * page.wrap.getBoundingClientRect().width / page.width;
    const tip = tipSelect?.value;
    Object.assign(cursor.style, {left:event.clientX+'px',top:event.clientY+'px',width:diameter+'px',
      height:(tip === 'chisel' ? diameter*.25 : diameter)+'px',borderRadius:tip === 'square' ? '0' : '50%',
      borderStyle:tip === 'soft' ? 'dashed' : 'solid',
      transform:'translate(-50%,-50%)'+(tip === 'chisel' ? ' rotate(-45deg)' : '') });
  }
  function restore() {
    try {
      const saved = JSON.parse(readPreferences?.() || '{}');
      for (const key of [...Object.keys(presets), 'eraser']) {
        const value = saved.styles?.[key];
        if (value && Number.isFinite(value.sw) && /^#[0-9a-f]{6}$/i.test(value.stroke) &&
            Number.isFinite(value.strokeOp)) remembered[key] = value;
      }
      if (Object.hasOwn(presets, saved.brush) || saved.brush === 'eraser') brushSelect.value = saved.brush;
      if (tipSelect && ['round','soft','square','chisel'].includes(saved.tip)) tipSelect.value = saved.tip;
    } catch {}
    chooseBrush(false);
  }
  let brush = 'pen';
  function settings() { return { brush, sw: +widthInput.value, stroke: colorButton.dataset.col, strokeOp: +opacityInput.value / 100 }; }
  function setColor(color) { colorButton.dataset.col = color; colorButton.style.background = color; }
  function sync(persist = true) {
    if (!Number.isFinite(widthInput.valueAsNumber)) return;
    opacityOutput.value = opacityInput.value + '%';
    preview.style.setProperty('--ink-width', Math.min(18, +widthInput.value) + 'px');
    preview.style.setProperty('--ink-color', colorButton.dataset.col);
    preview.style.opacity = +opacityInput.value / 100;
    if (+widthInput.value < .1 || +widthInput.value > +widthInput.max) return;
    remembered[brush] = settings();
    if (persist) try {
      const old = JSON.parse(readPreferences?.() || '{}');
      writePreferences?.(JSON.stringify({ brush, tip: tipSelect?.value || 'round',
        styles: { ...old.styles, [brush]: remembered[brush] } }));
    } catch {}
  }
  function wheelWidth(event) {
    if (!active || !canDraw() || widthInput.disabled || widthInput.readOnly || event.defaultPrevented ||
        event.ctrlKey || event.metaKey || event.altKey || !event.deltaY ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
        documentObject.querySelector('.overlay.show, dialog[open]')) return;
    event.preventDefault(); event.stopPropagation();
    const value = Number.isFinite(widthInput.valueAsNumber) ? widthInput.valueAsNumber : (presets[brush]?.width || 12);
    const step = +widthInput.step || .5;
    widthInput.value = Math.max(.1, Math.min(+widthInput.max, value + (event.deltaY < 0 ? step : -step))).toFixed(1);
    widthInput.dispatchEvent(new windowObject.Event('input', { bubbles: true }));
    widthInput.dispatchEvent(new windowObject.Event('change', { bubbles: true }));
  }
  function chooseBrush(persist = true) {
    closeColor(); hideCursor();
    if (brush !== brushSelect.value) onBrushChange();
    brush = brushSelect.value;
    const erasing = brush === 'eraser';
    const st = remembered[brush], preset = presets[brush] || { width: 12, color: '#243d51', opacity: 1 };
    bar.classList.toggle('erasing', erasing);
    widthInput.max = erasing ? 200 : 40;
    if (tipSelect) tipSelect.closest('label').hidden = !erasing;
    widthInput.value = st?.sw ?? preset.width;
    setColor(st?.stroke ?? preset.color);
    opacityInput.value = Math.round((st?.strokeOp ?? preset.opacity) * 100);
    sync(persist);
  }
  function cancel() {
    if (frame) windowObject.cancelAnimationFrame(frame);
    frame = 0;
    const old = draft; draft = null;
    old?.mark.remove();
    try { if (old?.wrap.hasPointerCapture(old.id)) old.wrap.releasePointerCapture(old.id); } catch {}
  }
  function stop() {
    closeColor();
    cancel(); hideCursor(); active = false; touches.clear();
    bar.hidden = true; button.classList.remove('active'); button.setAttribute('aria-pressed', 'false');
    documentObject.body.classList.remove('drawingMode'); onModeChange(false);
  }
  function toggle() {
    if (active) { stop(); return; }
    if (!canDraw()) return;
    restore(); prepare(); active = true; bar.hidden = false;
    button.classList.add('active'); button.setAttribute('aria-pressed', 'true');
    documentObject.body.classList.add('drawingMode'); onModeChange(true);
  }
  function sample(event, force = false) {
    if (!draft) return;
    const { rect, width, height, points } = draft;
    const x = Math.max(0, Math.min(width, (event.clientX - rect.left) / rect.width * width));
    const y = Math.max(0, Math.min(height, (event.clientY - rect.top) / rect.height * height));
    const pressure = event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : .5;
    const last = points.at(-1);
    if (!last || Math.hypot(x - last[0], y - last[1]) >= .65 ||
        (force && Math.hypot(x - last[0], y - last[1]) > .01)) points.push([x, y, pressure]);
    if (points.length > 4096) draft.points = points.filter((_, i) => i % 2 === 0 || i === points.length - 1);
  }
  function paint() {
    frame = 0;
    if (!draft) return;
    if (draft.style.brush === 'eraser') { renderEraserPreview(draft); return; }
    const object = createStroke(draft.points, draft.width, draft.height, draft.style);
    if (object) renderPreview(draft.mark, object, draft.wrap);
  }
  function down(event) {
    if (!active || !viewer.contains(event.target)) return;
    if (event.pointerType === 'touch') {
      touches.add(event.pointerId);
      if (touches.size > 1 || !event.isPrimary) { cancel(); return; }
    }
    if (event.button !== 0 || draft || !canDraw() || documentObject.querySelector('.overlay.show, dialog[open]')) return;
    const page = pageAt(event.target);
    if (!page) return;
    event.preventDefault(); event.stopImmediatePropagation();
    documentObject.activeElement?.blur?.();
    closeColor();
    const mark = documentObject.createElement('div');
    mark.className = 'inkDraft'; page.wrap.appendChild(mark);
    draft = { ...page, id: event.pointerId, mark, points: [], rect: page.wrap.getBoundingClientRect(), style: { ...settings(), tip: tipSelect?.value || 'round' } };
    try { page.wrap.setPointerCapture(event.pointerId); } catch {}
    sample(event); paint();
  }
  function move(event) {
    updateCursor(event);
    if (!draft || event.pointerId !== draft.id) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!canDraw() || !draft.wrap.isConnected) { cancel(); return; }
    const events = event.getCoalescedEvents?.();
    for (const sampleEvent of events?.length ? events : [event]) sample(sampleEvent);
    if (!frame) frame = windowObject.requestAnimationFrame(paint);
  }
  function up(event) {
    touches.delete(event.pointerId);
    if (!draft || event.pointerId !== draft.id) return;
    event.preventDefault(); event.stopImmediatePropagation();
    sample(event, true);
    const finished = draft;
    cancel();
    if (finished.style.brush === 'eraser') {
      if (canDraw() && finished.wrap.isConnected) eraseStroke(finished);
      return;
    }
    const object = createStroke(finished.points, finished.width, finished.height, finished.style);
    if (object && canDraw() && finished.wrap.isConnected) commitStroke(finished, object);
  }
  function pointerCancel(event) { touches.delete(event.pointerId); if (draft?.id === event.pointerId) cancel(); }
  function blockPageEvent(event) {
    if (active && viewer.contains(event.target) && pageAt(event.target)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }
  function keydown(event) {
    if (!active || documentObject.querySelector('.overlay.show, dialog[open]')) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (closeColor()) { colorButton.focus(); return; }
      stop(); button.focus();
    }
    else if (draft && (event.ctrlKey || event.metaKey)) cancel();
    else if (event.key === 'Delete' && !event.target.matches('input,select,textarea')) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }
  function on(target, type, handler, options) { target.addEventListener(type, handler, options); disposers.push(() => target.removeEventListener(type, handler, options)); }
  return { toggle, stop, cancel, get active() { return active; },
    mount() {
      if (mounted) return; mounted = true; restore();
      on(button, 'click', toggle); on(bar.querySelector('[data-ink-done]'), 'click', stop);
      on(brushSelect, 'change', chooseBrush);
      if (tipSelect) on(tipSelect, 'change', sync);
      on(windowObject, 'storage', event => { if (event.key === 'pdfEditor.drawing' && !draft) restore(); });
      on(colorButton, 'click', () => openColor(colorButton.id, color => { setColor(color); sync(); }));
      for (const input of [widthInput, opacityInput]) on(input, 'input', sync);
      on(widthInput, 'focus', () => widthInput.select());
      on(widthInput, 'wheel', wheelWidth, { passive: false });
      on(widthInput, 'change', () => { widthInput.value = Math.max(.1, Math.min(+widthInput.max, +widthInput.value || presets[brush]?.width || 12)); sync(); });
      for (const [type, handler] of Object.entries({ pointerdown: down, pointermove: move, pointerup: up,
        pointercancel: pointerCancel, lostpointercapture: pointerCancel, click: blockPageEvent,
        dblclick: blockPageEvent, contextmenu: blockPageEvent, keydown })) on(windowObject, type, handler, { capture: true, passive: false });
      on(viewer, 'pointerleave', hideCursor);
      on(windowObject, 'blur', () => { hideCursor(); cancel(); }); on(viewer, 'wheel', cancel, { passive: true });
    },
    dispose() { stop(); disposers.splice(0).reverse().forEach(dispose => dispose()); mounted = false; },
  };
}

export async function pickEditorColor(surface, host, signal, pointer) {
  if (!host.native) return (await new EyeDropper().open({ signal })).sRGBHex.toLowerCase();

  const requestId = crypto.randomUUID();
  const events = new AbortController(), options = { signal: events.signal };
  const canvas = surface.querySelector('canvas'), preview = surface.querySelector('.samplePreview');
  let unsubscribeFrame, unsubscribeError, timer, frame;
  try {
    return await new Promise((resolve, reject) => {
      let context, chosen = false;
      const cancel = () => reject(new DOMException('Cancelled', 'AbortError'));
      function showColor() {
        frame = 0;
        if (!context || !pointer) return;
        const bounds = surface.getBoundingClientRect();
        const x = pointer.x - bounds.left, y = pointer.y - bounds.top;
        const pixel = (position, size, pixels) => Math.min(pixels - 1, Math.max(0, Math.floor(position * pixels / size)));
        const [r, g, b] = context.getImageData(pixel(x, bounds.width, canvas.width),
          pixel(y, bounds.height, canvas.height), 1, 1).data;
        const color = '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
        if (chosen) { resolve(color); return; }
        preview.textContent = color.toUpperCase();
        preview.style.setProperty('--sample-color', color);
        preview.hidden = false;
        const beside = (position, size, space) => position + 16 + size <= space
          ? position + 16 : Math.max(0, position - 16 - size);
        preview.style.left = beside(x, preview.offsetWidth, bounds.width) + 'px';
        preview.style.top = beside(y, preview.offsetHeight, bounds.height) + 'px';
      }
      signal.throwIfAborted();
      signal.addEventListener('abort', cancel, options);
      window.addEventListener('blur', cancel, options);
      window.addEventListener('resize', cancel, options);
      document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); }, options);
      window.addEventListener('keydown', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === 'Escape') cancel();
      }, { ...options, capture: true });
      surface.addEventListener('cancel', event => { event.preventDefault(); cancel(); }, options);
      surface.addEventListener('contextmenu', event => { event.preventDefault(); cancel(); }, options);
      surface.addEventListener('pointermove', event => {
        if (chosen) return;
        pointer = { x: event.clientX, y: event.clientY };
        if (context && !frame) frame = requestAnimationFrame(showColor);
      }, options);
      surface.addEventListener('pointerleave', () => {
        if (!chosen) { pointer = null; preview.hidden = true; }
      }, options);
      surface.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (chosen || event.detail === 0) return;
        chosen = true;
        pointer = { x: event.clientX, y: event.clientY };
        if (context) { cancelAnimationFrame(frame); showColor(); }
      }, options);
      unsubscribeError = host.onMessage(message => {
        if (message?.cmd === 'color-sample-error' && message.requestId === requestId)
          reject(new Error('Color sample unavailable'));
      });
      unsubscribeFrame = host.onSharedBuffer(async ({ metadata, buffer }) => {
        if (metadata?.cmd !== 'color-sample-frame' || metadata.requestId !== requestId) return;
        try {
          const bitmap = await createImageBitmap(new Blob([buffer], { type: 'image/png' }));
          try {
            if (events.signal.aborted) return;
            canvas.width = bitmap.width; canvas.height = bitmap.height;
            context = canvas.getContext('2d', { willReadFrequently: true });
            context.drawImage(bitmap, 0, 0);
          } finally { bitmap.close(); }
          clearTimeout(timer);
          canvas.hidden = false;
          showColor();
        } catch (error) { reject(error); }
      });
      surface.showModal();
      timer = setTimeout(() => reject(new Error('Color sample timed out')), 10000);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          frame = 0;
          host.send({ type: 'capture-color-sample', apiVersion: 4, requestId });
        });
      });
    });
  } finally {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    events.abort();
    unsubscribeFrame?.(); unsubscribeError?.();
    if (surface.open) surface.close();
    preview.hidden = canvas.hidden = true;
    canvas.width = canvas.height = 0;
  }
}

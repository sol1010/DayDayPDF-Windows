export const createPagePainter = ({ getSource, createCanvas, getResizedCropGeometry = null }) => {
  const resizeGeometry = getResizedCropGeometry || ((resize, crop = null) => {
    const [fullWidth, fullHeight] = resize;
    const [x, y, width, height] = crop || [0, 0, 1, 1];
    return {
      fullWidth, fullHeight,
      width: fullWidth * width, height: fullHeight * height,
      left: fullWidth * x, top: fullHeight * y,
    };
  });
  async function getViewport(pageModel, scale) {
    if (pageModel.blank) {
      pageModel._w1 = pageModel.blank[0];
      pageModel._h1 = pageModel.blank[1];
      return { width: pageModel.blank[0] * scale, height: pageModel.blank[1] * scale, blank: true };
    }
    if (pageModel.resize) {
      const geometry = resizeGeometry(pageModel.resize, pageModel.crop);
      pageModel._w1 = geometry.width;
      pageModel._h1 = geometry.height;
      return {
        width: geometry.width * scale,
        height: geometry.height * scale,
        resize: true,
        ...(pageModel.crop ? { crop: true } : {}),
      };
    }
    const pdfPage = await getSource(pageModel.src).doc.getPage(pageModel.idx + 1);
    const rotation = (pdfPage.rotate + pageModel.rot) % 360;
    const viewport = pdfPage.getViewport({ scale, rotation });
    if (pageModel.crop) {
      const width = viewport.width * pageModel.crop[2];
      const height = viewport.height * pageModel.crop[3];
      pageModel._w1 = width / scale;
      pageModel._h1 = height / scale;
      return { width, height, crop: true };
    }
    pageModel._w1 = viewport.width / scale;
    pageModel._h1 = viewport.height / scale;
    return viewport;
  }

  async function getRenderSpec(pageModel, renderScale = 1, region = null) {
    const pdfPage = await getSource(pageModel.src).doc.getPage(pageModel.idx + 1);
    const rotation = (pdfPage.rotate + pageModel.rot) % 360;
    const base = pdfPage.getViewport({ scale: 1, rotation });
    let width = base.width, height = base.height, fit = 1, x = 0, y = 0;
    if (pageModel.resize) {
      const geometry = resizeGeometry(pageModel.resize, pageModel.crop);
      fit = Math.min(geometry.fullWidth / width, geometry.fullHeight / height);
      x = (geometry.fullWidth - width * fit) / 2 - geometry.left;
      y = (geometry.fullHeight - height * fit) / 2 - geometry.top;
      width = geometry.width; height = geometry.height;
    } else if (pageModel.crop) {
      x = -width * pageModel.crop[0]; y = -height * pageModel.crop[1];
      width *= pageModel.crop[2]; height *= pageModel.crop[3];
    }
    if (region) { x -= region.x; y -= region.y; width = region.width; height = region.height; }
    const viewport = pdfPage.getViewport({ scale: renderScale * fit, rotation,
      offsetX: x * renderScale, offsetY: y * renderScale });
    return { pdfPage, viewport, width, height, rotation };
  }

  async function paintRegion(pageModel, canvas, cssScale, dpr = 1, region = null, taskHook = null, options = {}) {
    const renderScale = cssScale * dpr;
    if (pageModel.blank) {
      canvas.width = Math.max(1, Math.round((region?.width || pageModel.blank[0]) * renderScale));
      canvas.height = Math.max(1, Math.round((region?.height || pageModel.blank[1]) * renderScale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = options.background || '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const { pdfPage, viewport, width, height, rotation } = await getRenderSpec(pageModel, renderScale, region);
    const { pixelRatio: [ax, ay] = [1, 1], ...renderOptions } = options;
    canvas.width = Math.max(1, Math.round(width * renderScale * ax));
    canvas.height = Math.max(1, Math.round(height * renderScale * ay));
    const record = !!options.recordOperations && !region && !pageModel.crop && !pageModel.resize;
    if (record && pdfPage._daydayBBoxRotation !== rotation) pdfPage.recordedBBoxes = null;
    const task = pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport,
      ...renderOptions, ...(options.pixelRatio && { transform: [ax, 0, 0, ay, 0, 0] }), recordOperations: record });
    if (taskHook) taskHook(task);
    try {
      await task.promise;
      if (record) pdfPage._daydayBBoxRotation = rotation;
    } catch (error) {
      if (record) { pdfPage.recordedBBoxes = null; delete pdfPage._daydayBBoxRotation; }
      throw error;
    } finally { if (taskHook) taskHook(null, task); }
  }

  function paintPage(pageModel, canvas, cssScale, dpr = 1, taskHook = null, options = {}) {
    return paintRegion(pageModel, canvas, cssScale, dpr, null, taskHook, options);
  }

  function blitPagePreview(source, target, cssWidth, cssHeight, outputDpr, smoothingMix) {
    const sourceDpr = source.width / Math.max(1, cssWidth);
    const directCopy = Math.abs(sourceDpr - outputDpr) < 0.01;
    const outputWidth = directCopy ? source.width : Math.max(1, Math.round(cssWidth * outputDpr));
    const outputHeight = directCopy ? source.height : Math.max(1, Math.round(cssHeight * outputDpr));
    target.width = outputWidth;
    target.height = outputHeight;
    const ctx = target.getContext('2d');
    if (directCopy) {
      ctx.drawImage(source, 0, 0);
      return;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, outputWidth, outputHeight);
    if (smoothingMix > 0) {
      ctx.globalAlpha = smoothingMix;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, outputWidth, outputHeight);
      ctx.globalAlpha = 1;
    }
  }

  return Object.freeze({ getViewport, getRenderSpec, paintPage, paintRegion, blitPagePreview });
};

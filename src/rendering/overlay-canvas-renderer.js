const SHAPE_TEXT_FONT_FAMILIES = Object.freeze({
  spoqa: '"PDFEditor Spoqa","Malgun Gothic","맑은 고딕",sans-serif',
  notosanskr: '"PDFEditor Noto Sans KR","Noto Sans KR","Malgun Gothic",sans-serif',
  nanum: '"PDFEditor Nanum Gothic","NanumGothic","나눔고딕","Malgun Gothic",sans-serif',
  myeongjo: '"PDFEditor Nanum Myeongjo","NanumMyeongjo","나눔명조","Batang",serif',
  pen: '"PDFEditor Nanum Pen","Nanum Pen Script",cursive',
  roboto: '"PDFEditor Roboto","Roboto","Segoe UI",sans-serif',
  robotoslab: '"PDFEditor Roboto Slab","Roboto Slab","Times New Roman",serif',
});
const ARROW_HEAD_SIZE_MIN = 4;
const ARROW_HEAD_SIZE_MAX = 160;

const shapeTextFontFamily = object =>
  SHAPE_TEXT_FONT_FAMILIES[object?.font] || SHAPE_TEXT_FONT_FAMILIES.spoqa;

export const createOverlayCanvasRenderer = ({
  ImageConstructor, isTextObject, colorWithAlpha, opacityOf, rotationOf, onImagePending,
  shapePolygonOf = () => [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]],
  connectorPolylineOf = object => [[object.x1, object.y1], [object.x2, object.y2]],
  arrowBodyPolylineOf = (_object, points) => points,
  connectorEndDirectionOf = points => {
    const end = points.at(-1) || [0, 0];
    const before = points.at(-2) || end;
    return { end, before, angle: Math.atan2(end[1] - before[1], end[0] - before[0]) };
  },
  arrowMarkerStrokeWidthOf = (object, head, scale) =>
    Math.max(.1, (+object.sw || 0) * scale),
  shapeTextFontFamilyOf = shapeTextFontFamily,
  inkGeometryOf = () => [], textLayoutOf = null,
}) => {
  const imageCache = new Map();

  function imageFor(object) {
    let image = imageCache.get(object.data);
    if (!image) {
      image = new ImageConstructor();
      image.src = object.data;
      imageCache.set(object.data, image);
    }
    return image;
  }

  function wrapShapeText(context, text, maxWidth) {
    const lines = [];
    for (const raw of String(text || '').split('\n')) {
      let current = '';
      for (const character of raw) {
        const candidate = current + character;
        if (current && context.measureText(candidate).width > maxWidth) {
          lines.push(current);
          current = character === ' ' ? '' : character;
        } else current = candidate;
      }
      lines.push(current);
    }
    return lines.length ? lines : [''];
  }

  function drawShapeText(context, object, objectWidth, objectHeight, scale) {
    if (object.text === undefined || !String(object.text).trim()) return;
    if (textLayoutOf) {
      const layout = textLayoutOf(object, objectWidth / object.fw / scale,
        objectHeight / object.fh / scale, true);
      const x = -objectWidth / 2 + objectWidth * .08, y = -objectHeight / 2 + objectHeight * .08;
      context.save(); context.beginPath(); context.rect(x, y, objectWidth * .84, objectHeight * .84); context.clip();
      context.translate(x, y); context.scale(scale, scale); context.font = layout.font;
      context.textBaseline = 'alphabetic'; context.fillStyle = colorWithAlpha(object.color || '#000000', object.colorOp ?? 1);
      for (const line of layout.lines) context.fillText(line.text, line.x, line.y);
      context.restore(); return;
    }
    const size = (Number.isFinite(object.size) ? object.size : 16) * scale;
    const boxWidth = objectWidth * .84, boxHeight = objectHeight * .84;
    context.font = (object.bold ? '700 ' : '') + size + 'px ' + shapeTextFontFamilyOf(object);
    context.textBaseline = 'alphabetic';
    context.fillStyle = colorWithAlpha(object.color || '#000000',
      object.colorOp === undefined ? 1 : object.colorOp);
    const lineHeight = size * 1.2;
    const maxLines = Math.max(1, Math.floor(boxHeight / lineHeight));
    const lines = wrapShapeText(context, object.text, boxWidth).slice(0, maxLines);
    const blockHeight = lines.length * lineHeight;
    const alignFactor = object.align === 'left' ? 0 : object.align === 'right' ? 1 : .5;
    const verticalFactor = object.valign === 'top' ? 0 : object.valign === 'bottom' ? 1 : .5;
    const left = -objectWidth / 2 + objectWidth * .08;
    const innerTop = -objectHeight / 2 + objectHeight * .08;
    const top = innerTop +
      Math.max(0, boxHeight - blockHeight) * verticalFactor;
    context.save();
    context.beginPath();
    context.rect(left, innerTop, boxWidth, boxHeight);
    context.clip();
    lines.forEach((line, index) => {
      const offset = Math.max(0, boxWidth - context.measureText(line).width) * alignFactor;
      context.fillText(line, left + offset, top + size * .95 + index * lineHeight);
    });
    context.restore();
  }

  function drawObjects(pageModel, canvas, pageWidth, frame = null) {
    if (!pageModel.texts.length || !canvas.width) return;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform?.(1, 0, 0, 1, -(frame?.x || 0), -(frame?.y || 0));
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    const width = frame?.width || canvas.width;
    const height = frame?.height || canvas.height;
    const scale = width / pageWidth;
    try {
    for (const object of pageModel.texts) {
      if (object.fw === 0 || object.fh === 0) continue;
      ctx.save();
      try {
      const radians = rotationOf(object) * Math.PI / 180;
      if (isTextObject(object)) {
        if (textLayoutOf) {
          const layout = textLayoutOf(object, pageWidth, height / scale);
          ctx.font = layout.font; ctx.textBaseline = 'alphabetic';
          ctx.fillStyle = colorWithAlpha(object.color, opacityOf(object, 'colorOp'));
          ctx.translate(object.fx * width + layout.width * scale / 2,
            object.fy * height + layout.height * scale / 2);
          if (radians) ctx.rotate(radians);
          ctx.scale((object.flipX ? -1 : 1) * scale, (object.flipY ? -1 : 1) * scale);
          for (const line of layout.lines) ctx.fillText(line.text,
            -layout.width / 2 + line.x, -layout.height / 2 + line.y);
          continue;
        }
        ctx.fillStyle = colorWithAlpha(object.color, opacityOf(object, 'colorOp'));
        const size = object.size * scale;
        ctx.font = (object.bold ? '700 ' : '') + size + 'px sans-serif';
        ctx.textBaseline = 'alphabetic';
        const lines = object.text.split('\n');
        const lineWidth = line => ctx.measureText(line).width;
        const boxWidth = object.fw ? object.fw * width : Math.max(4, ...lines.map(lineWidth));
        const blockHeight = Math.max(size * 1.2, lines.length * size * 1.2);
        const boxHeight = object.fh ? object.fh * height : blockHeight;
        const alignFactor = object.align === 'center' ? .5 : object.align === 'right' ? 1 : 0;
        const verticalFactor = object.valign === 'middle' ? .5 : object.valign === 'bottom' ? 1 : 0;
        const verticalOffset = Math.max(0, boxHeight - blockHeight) * verticalFactor;
        ctx.translate(object.fx * width + boxWidth / 2, object.fy * height + boxHeight / 2);
        if (radians) ctx.rotate(radians);
        if (object.flipX || object.flipY) ctx.scale(object.flipX ? -1 : 1, object.flipY ? -1 : 1);
        lines.forEach((line, index) => {
          const offset = Math.max(0, boxWidth - lineWidth(line)) * alignFactor;
          ctx.fillText(line, -boxWidth / 2 + offset,
            -boxHeight / 2 + verticalOffset + size * .95 + index * size * 1.2);
        });
      } else if (object.type === 'img') {
        const renderedClip = frame?.image;
        const image = renderedClip || imageFor(object);
        const objectWidth = object.fw * width;
        const objectHeight = object.fh * height;
        ctx.translate(object.fx * width + objectWidth / 2, object.fy * height + objectHeight / 2);
        if (radians) ctx.rotate(radians);
        if (object.flipX || object.flipY) ctx.scale(object.flipX ? -1 : 1, object.flipY ? -1 : 1);
        ctx.globalAlpha = opacityOf(object, 'fillOp');
        if (object.blend === 'multiply') ctx.globalCompositeOperation = 'multiply';
        if (renderedClip || (image.complete && image.naturalWidth))
          ctx.drawImage(image, -objectWidth / 2, -objectHeight / 2, objectWidth, objectHeight);
        else image.addEventListener('load', () => onImagePending(pageModel), { once: true });
      } else if (object.type === 'ink') {
        if (object.strokeOn !== false) {
          const w = object.fw * width, h = object.fh * height;
          ctx.translate(object.fx * width + w / 2, object.fy * height + h / 2);
          if (radians) ctx.rotate(radians);
          if (object.flipX || object.flipY) ctx.scale(object.flipX ? -1 : 1, object.flipY ? -1 : 1);
          ctx.translate(-w / 2, -h / 2);
          ctx.fillStyle = colorWithAlpha(object.stroke, opacityOf(object, 'strokeOp'));
          if (object.brush === 'highlighter') ctx.globalCompositeOperation = 'multiply';
          ctx.beginPath();
          for (const polygon of inkGeometryOf(object, w, h)) {
            polygon.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
            ctx.closePath();
          }
          ctx.fill();
        }
      } else if (object.type === 'polyline') {
        const points = Array.isArray(object.points) ? object.points : [];
        if (points.length >= 2) {
          ctx.beginPath();
          points.forEach((point, index) => {
            const x = (+point[0] || 0) * width;
            const y = (+point[1] || 0) * height;
            if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          });
          if (object.closed && points.length > 2) ctx.closePath();
          ctx.strokeStyle = colorWithAlpha(object.stroke, opacityOf(object, 'strokeOp'));
          ctx.lineWidth = Math.max(.1, object.sw * scale);
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      } else if (object.type === 'line' || object.type === 'arrow') {
        const connectorColor = colorWithAlpha(object.stroke, opacityOf(object, 'strokeOp'));
        ctx.strokeStyle = connectorColor;
        ctx.lineWidth = Math.max(.1, object.sw * scale);
        ctx.lineJoin = 'round';
        ctx.lineCap = object.type === 'line' && object.lineCap === 'square' ? 'square' : 'round';
        const centerX = (object.x1 + object.x2) * width / 2;
        const centerY = (object.y1 + object.y2) * height / 2;
        ctx.translate(centerX, centerY);
        if (radians) ctx.rotate(radians);
        const points = connectorPolylineOf(object).map(([x, y]) => [x * width - centerX, y * height - centerY]);
        const head = object.type === 'arrow'
          ? Math.max(ARROW_HEAD_SIZE_MIN, Math.min(ARROW_HEAD_SIZE_MAX, +object.arrowHeadSize || 10)) * scale : 0;
        const bodyPoints = object.type === 'arrow'
          ? arrowBodyPolylineOf(object, points, head) : points;
        ctx.beginPath();
        bodyPoints.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.stroke();
        if (object.type === 'arrow' && (object.arrowEndType || 'arrow-filled') !== 'none') {
          const { end, angle } = connectorEndDirectionOf(points);
          const kind = object.arrowEndType || 'arrow-filled';
          ctx.save();
          ctx.translate(end[0], end[1]);
          ctx.rotate(angle + (+object.arrowHeadRotation || 0) * Math.PI / 180);
          ctx.lineJoin = 'round';
          ctx.lineWidth = arrowMarkerStrokeWidthOf(object, head, scale);
          if (kind === 'circle-filled') {
            ctx.beginPath(); ctx.arc(0, 0, head * .38, 0, Math.PI * 2);
            ctx.fillStyle = connectorColor; ctx.fill();
          } else if (kind === 'circle-open') {
            ctx.beginPath(); ctx.arc(0, 0, head * .34, 0, Math.PI * 2);
            ctx.stroke();
          } else if (kind === 'square') {
            const half = head * .35;
            ctx.strokeRect(-half, -half, half * 2, half * 2);
          } else if (kind === 'arrow-open') {
            ctx.beginPath(); ctx.moveTo(-head, -head * .48); ctx.lineTo(0, 0);
            ctx.lineTo(-head, head * .48); ctx.stroke();
          } else {
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-head, -head * .5);
            ctx.lineTo(-head, head * .5); ctx.closePath();
            ctx.fillStyle = connectorColor; ctx.fill();
          }
          ctx.restore();
        }
      } else {
        const objectWidth = object.fw * width;
        const objectHeight = object.fh * height;
        ctx.translate(object.fx * width + objectWidth / 2, object.fy * height + objectHeight / 2);
        if (radians) ctx.rotate(radians);
        if (object.flipX || object.flipY) ctx.scale(object.flipX ? -1 : 1, object.flipY ? -1 : 1);
        const path = () => {
          ctx.beginPath();
          if (object.type === 'ellipse') ctx.ellipse(0, 0, objectWidth / 2, objectHeight / 2, 0, 0, 7);
          else if (object.type === 'triangle' || object.type === 'star') {
            shapePolygonOf(object.type).forEach(([x, y], index) => {
              const px = x * objectWidth, py = y * objectHeight;
              if (index) ctx.lineTo(px, py); else ctx.moveTo(px, py);
            });
            ctx.closePath();
          } else ctx.rect(-objectWidth / 2, -objectHeight / 2, objectWidth, objectHeight);
        };
        if (object.fill) {
          path();
          ctx.fillStyle = colorWithAlpha(object.fill, opacityOf(object, 'fillOp'));
          ctx.fill();
        }
        if (object.strokeOn !== false) {
          path();
          ctx.strokeStyle = colorWithAlpha(object.stroke, opacityOf(object, 'strokeOp'));
          ctx.lineWidth = Math.max(.1, object.sw * scale);
          ctx.stroke();
        }
        drawShapeText(ctx, object, objectWidth, objectHeight, scale);
      }
      } finally { ctx.restore(); }
    }
    } finally { ctx.restore(); }
  }

  return Object.freeze({
    drawObjects,
    prepareImages: page => Promise.all((page.texts || []).filter(object => object.type === 'img')
      .map(object => {
        const image = imageFor(object);
        if (image.complete && image.naturalWidth) return;
        if (typeof image.decode === 'function') return image.decode();
        return new Promise((resolve, reject) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', () => reject(new Error('출력할 이미지를 불러오지 못했습니다.')), { once: true });
        });
      })),
    clearImageCache: () => imageCache.clear(),
  });
};

const mm = (w, h) => [w * 72 / 25.4, h * 72 / 25.4];
export const printPaperSizes = Object.freeze({
  A0: mm(841, 1189), A1: mm(594, 841), A2: mm(420, 594), A3: mm(297, 420),
  A4: mm(210, 297), A5: mm(148, 210), A6: mm(105, 148),
  'B4 (JIS)': mm(257, 364), 'B5 (JIS)': mm(182, 257),
  'B4 (ISO)': mm(250, 353), 'B5 (ISO)': mm(176, 250),
  Letter: [612, 792], Legal: [612, 1008], Tabloid: [792, 1224],
});

export function printPaperSize(paper, orientation) {
  if (paper === 'auto') return null;
  const size = printPaperSizes[Object.keys(printPaperSizes).find(key => key.toLowerCase() === paper)] || printPaperSizes.A4;
  return orientation === 'landscape' ? [size[1], size[0]] : [...size];
}

export function addPrintMediaRun(runs, first, width, height, last = first) {
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw new Error('페이지 크기를 확인하세요.');
  const previous = runs.at(-1);
  if (previous && Math.abs(previous.width - width) < .01 && Math.abs(previous.height - height) < .01) {
    previous.last = last;
  } else runs.push({ first, last, width, height });
}

export async function alignPrinterMedia(pdfLib, bytes, runs, signal) {
  const firstSheet = runs.find(run => run.width !== run.height);
  const feedLandscape = firstSheet ? firstSheet.width > firstSheet.height : false;
  const mediaRuns = [];
  let pdf;
  for (const { first, last, width, height } of runs) {
    signal?.throwIfAborted();
    const short = Math.min(width, height), long = Math.max(width, height);
    const stock = Object.values(printPaperSizes).find(([w, h]) =>
      Math.abs(w - short) <= .5 && Math.abs(h - long) <= .5) || [short, long];
    addPrintMediaRun(mediaRuns, first, stock[feedLandscape ? 1 : 0], stock[feedLandscape ? 0 : 1], last);
    if (width === height || (width > height) === feedLandscape) continue;
    pdf ??= await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
    const turn = feedLandscape ? 90 : 270;
    for (let number = first; number <= last; number++) {
      const page = pdf.getPage(number - 1);
      page.setRotation(pdfLib.degrees((page.getRotation().angle + turn) % 360));
    }
  }
  signal?.throwIfAborted();
  return { bytes: pdf ? await pdf.save({ updateFieldAppearances: false }) : bytes, mediaRuns };
}

export async function withPrintTitle(pdfLib, bytes, name) {
  const pdf = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
  if (pdf.getTitle() === name) return bytes;
  pdf.setTitle(name);
  return pdf.save();
}

export async function makePdfPrintCopy(pdfLib, bytes, { paper, orientation, copies, name, signal }) {
  if (!Number.isInteger(copies) || copies < 1 || copies > 999) throw new Error('인쇄 매수를 확인하세요.');
  const source = await pdfLib.PDFDocument.load(bytes);
  const output = await pdfLib.PDFDocument.create();
  if (name) output.setTitle(name);
  const pages = [];
  const sourcePages = source.getPages();
  const boxes = sourcePages.map(page => {
    const box = page.getCropBox();
    if (!page.node.Contents()) page.drawText('');
    return { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height };
  });
  const embeddedPages = await output.embedPages(sourcePages, boxes);
  for (const [index, page] of sourcePages.entries()) {
    signal?.throwIfAborted();
    const embedded = embeddedPages[index];
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    const sideways = rotation === 90 || rotation === 270;
    const width = sideways ? embedded.height : embedded.width;
    const height = sideways ? embedded.width : embedded.height;
    const unit = page.node.lookup(pdfLib.PDFName.of('UserUnit'))?.asNumber?.() || 1;
    const direction = orientation === 'auto' ? (width > height ? 'landscape' : 'portrait') : orientation;
    const [paperWidth, paperHeight] = printPaperSize(paper, direction) || [width * unit, height * unit];
    const scale = Math.min(paperWidth / width, paperHeight / height);
    let x = (paperWidth - width * scale) / 2, y = (paperHeight - height * scale) / 2;
    if (rotation === 90) y += embedded.width * scale;
    if (rotation === 180) { x += embedded.width * scale; y += embedded.height * scale; }
    if (rotation === 270) x += embedded.height * scale;
    pages.push({ embedded, paperWidth, paperHeight, options: { x, y, xScale: scale, yScale: scale, rotate: pdfLib.degrees(-rotation) } });
  }
  for (let copy = 0; copy < copies; copy++) {
    signal?.throwIfAborted();
    for (const { embedded, paperWidth, paperHeight, options } of pages)
      output.addPage([paperWidth, paperHeight]).drawPage(embedded, options);
    if (copy % 8 === 7) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return output.save();
}

export function grayscaleCanvas(canvas) {
  const context = canvas.getContext('2d');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const gray = Math.round(pixels.data[i] * .299 + pixels.data[i + 1] * .587 + pixels.data[i + 2] * .114);
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
  }
  context.putImageData(pixels, 0, 0);
}

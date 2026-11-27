export function startOpeningReader(viewer, pdf, firstRaster, translate) {
  const root = document.createElement('section');
  root.className = 'firstRead';
  root.tabIndex = 0;
  root.setAttribute('aria-label', translate('페이지 미리보기'));
  const stage = document.createElement('div');
  stage.className = 'firstReadPage';
  const bar = document.createElement('div');
  bar.className = 'firstReadBar';
  const button = (label, symbol, by) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.setAttribute('aria-label', translate(label));
    el.textContent = symbol;
    el.onclick = () => show(number + by);
    return el;
  };
  const prev = button('이전 페이지', '‹', -1), next = button('다음 페이지', '›', 1);
  const input = document.createElement('input');
  input.type = 'number'; input.min = '1'; input.max = String(pdf.numPages);
  input.setAttribute('aria-label', translate('페이지 번호'));
  input.onchange = () => show(input.valueAsNumber);
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); show(input.valueAsNumber); root.focus(); }
    e.stopPropagation();
  };
  const status = document.createElement('span');
  status.textContent = translate('편집 준비 중');
  bar.append(prev, input, document.createTextNode(' / ' + pdf.numPages), next, status);
  root.append(stage, bar);

  let number = 0, revision = 0, task = null, closed = false, lastWheel = -Infinity;
  async function show(requested) {
    const pageNumber = Math.min(pdf.numPages, Math.max(1, Math.trunc(requested) || number || 1));
    input.value = String(pageNumber);
    if (closed || number === pageNumber) return;
    number = pageNumber;
    prev.disabled = number === 1; next.disabled = number === pdf.numPages;
    const token = ++revision;
    task?.cancel();
    try {
      const page = await pdf.getPage(number);
      if (closed || token !== revision) return;
      const natural = page.getViewport({scale: 1});
      const canvas = document.createElement('canvas');
      const useFirst = pageNumber === 1 && firstRaster && !pdf.isPureXfa && !await pdf.getFieldObjects().catch(() => true);
      const bitmap = useFirst ? await firstRaster : null;
      if (closed || token !== revision) return;
      if (bitmap) {
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
      } else {
        const fit = Math.min((viewer.clientWidth - 24) / natural.width, (viewer.clientHeight - 52) / natural.height);
        const scale = Math.min(Math.max(.1, fit) * Math.min(2, devicePixelRatio || 1),
          4096 / Math.max(natural.width, natural.height), Math.sqrt(4000000 / (natural.width * natural.height)));
        const viewport = page.getViewport({scale});
        canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
        task = page.render({canvasContext: canvas.getContext('2d'), viewport});
        await task.promise;
      }
      if (closed || token !== revision) return;
      stage.replaceChildren(canvas);
      root.dataset.painted = String(pageNumber);
      if (!root.isConnected) viewer.append(root);
    } catch {
      if (!closed && token === revision && stage.firstChild) {
        number = Number(root.dataset.painted);
        input.value = String(number); prev.disabled = number === 1; next.disabled = number === pdf.numPages;
      }
    }
  }
  root.addEventListener('wheel', e => {
    if (e.ctrlKey || !e.deltaY) return;
    e.preventDefault(); e.stopPropagation();
    if (performance.now() - lastWheel > 180) { lastWheel = performance.now(); show(number + Math.sign(e.deltaY)); }
  }, {passive: false});
  function onKey(e) {
    if (!root.isConnected || e.target === input ||
        !(root.contains(e.target) || e.target === document.body || e.target === viewer)) return;
    const direction = {PageDown:1, ArrowDown:1, ArrowRight:1, PageUp:-1, ArrowUp:-1, ArrowLeft:-1}[e.key];
    if (direction && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault(); e.stopPropagation(); show(number + direction);
    }
  }
  document.addEventListener('keydown', onKey, true);
  show(1);
  return {
    finish() {
      closed = true; document.removeEventListener('keydown', onKey, true); task?.cancel(); root.remove();
      return { number, canvas: Number(root.dataset.painted) === number ? stage.firstElementChild : null };
    },
  };
}

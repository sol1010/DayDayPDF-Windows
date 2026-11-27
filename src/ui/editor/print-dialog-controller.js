const preferenceFields = Object.freeze({
  orientation: ['prOrient', ['auto', 'portrait', 'landscape'], 'auto'],
  mode: ['prMode', ['pdf', 'image'], 'pdf'],
  paper: ['prPaper', ['auto', 'a4', 'a3', 'letter'], 'a4'],
  color: ['prColor', ['color', 'mono'], 'color'],
  duplex: ['prDuplex', ['single', 'long', 'short'], 'single'],
});

export function normalizePrintPreferences(value, paperChoices = preferenceFields.paper[1]) {
  const input = value && typeof value === 'object' ? value : {};
  const result = {};
  for (const [name, [, choices, fallback]] of Object.entries(preferenceFields))
    result[name] = (name === 'paper' ? paperChoices : choices).includes(input[name]) ? input[name] : fallback;
  const copies = Number(input.copies);
  result.copies = Number.isInteger(copies) && copies >= 1 && copies <= 999 ? copies : 1;
  result.printer = typeof input.printer === 'string' ? input.printer : '';
  return result;
}

export function createPrintDialogController({
  getElement: $, readPreferences, writePreferences, getDocument, getIndexes,
  hasSelection, isLocked, renderPreview, printPaperSizes, getPrinters = null, notify, text = value => value,
}) {
  const overlay = $('prOverlay'), target = $('prPreview'), box = $('prPrevBox');
  const paperSelect = $('prPaper');
  for (const key of Object.keys(printPaperSizes)) {
    const option = target.ownerDocument.createElement('option');
    option.value = key.toLowerCase();
    option.textContent = key;
    paperSelect.append(option);
  }
  const paperChoices = Array.from(paperSelect.options, option => option.value);
  let preferences = normalizePrintPreferences(null, paperChoices), position = 0, zoom = 1;
  let revision = 0, opening = 0;
  const visible = () => overlay.classList.contains('show');
  const fields = Object.values(preferenceFields).map(([id]) => id).concat('prCopies', 'prPrinter');

  function read() {
    try { return normalizePrintPreferences(JSON.parse(readPreferences() || 'null'), paperChoices); }
    catch { return normalizePrintPreferences(null); }
  }
  function save() {
    const next = { ...preferences };
    for (const [name, [id]] of Object.entries(preferenceFields)) {
      if ($(id) && !(name === 'mode' && isLocked())) next[name] = $(id).value;
    }
    if ($('prCopies')?.validity.valid) next.copies = Number($('prCopies').value);
    const printer = $('prPrinter');
    if (printer && !printer.disabled && printer.value) next.printer = printer.value;
    preferences = normalizePrintPreferences(next, paperChoices);
    try { writePreferences(JSON.stringify(preferences)); } catch {   }
  }
  function syncNavigation(indexes) {
    const count = indexes?.length || 0;
    position = Math.max(0, Math.min(position, count - 1));
    $('prPreviewPage').value = String(count ? position + 1 : 0);
    $('prPreviewPage').max = String(Math.max(1, count));
    $('prPreviewPage').disabled = !count;
    $('prPreviewTotal').textContent = String(count);
    $('prPreviewPrev').disabled = !count || position === 0;
    $('prPreviewNext').disabled = !count || position >= count - 1;
    $('prPreviewSource').textContent = count ? String(indexes[position] + 1) : '—';
    $('prPreviewZoom').textContent = Math.round(zoom * 100) + '%';
  }
  async function update() {
    const currentRevision = ++revision, doc = getDocument();
    if (!visible()) return;
    const indexes = getIndexes();
    syncNavigation(indexes);
    $('prDuplex').disabled = $('prPrinter')?.selectedOptions[0]?.dataset.pdf === 'true';
    const originalSize = !!getPrinters && $('prPaper').value === 'auto';
    $('prOrient').disabled = originalSize;
    $('prInfo').textContent = indexes?.length ? indexes.length + ' ' + text('개 페이지 인쇄') : text('범위가 올바르지 않습니다');
    target.style.visibility = 'hidden';
    const status = $('prPreviewStatus');
    status.textContent = text(indexes?.length ? '미리보기 준비 중…' : '범위가 올바르지 않습니다');
    status.hidden = false;
    if (!indexes?.length) { box.setAttribute('aria-busy', 'false'); return; }
    box.setAttribute('aria-busy', 'true');
    const canvas = target.ownerDocument.createElement('canvas');
    try {
      const size = await renderPreview({ pageIndex: indexes[position], orientation: originalSize ? 'auto' : $('prOrient').value, canvas, box, zoom });
      if (currentRevision !== revision || doc !== getDocument() || !visible()) return;
      target.width = canvas.width; target.height = canvas.height;
      target.style.width = size.width + 'px'; target.style.height = size.height + 'px';
      target.getContext('2d').drawImage(canvas, 0, 0);
      target.style.visibility = 'visible'; status.hidden = true;
    } catch (error) {
      if (currentRevision === revision && visible()) status.textContent = text('미리보기를 표시하지 못했습니다.');
      console.error(error);
    } finally {
      canvas.width = canvas.height = 0;
      if (currentRevision === revision) box.setAttribute('aria-busy', 'false');
    }
  }
  async function open(forceSelected) {
    if (!getDocument()?.pages.length) return;
    const currentOpening = ++opening;
    preferences = read();
    for (const [name, [id]] of Object.entries(preferenceFields)) if ($(id)) $(id).value = preferences[name];
    if ($('prCopies')) $('prCopies').value = String(preferences.copies);
    $('prMode').querySelector('option[value="pdf"]').disabled = isLocked();
    if (isLocked()) $('prMode').value = 'image';
    $('prRange').value = forceSelected && hasSelection() ? 'selected' : 'all';
    $('prCustomRow').style.display = 'none';
    position = 0; zoom = 1;
    overlay.classList.add('show');
    box.scrollTop = box.scrollLeft = 0;
    void update();
    if (!getPrinters) return;
    $('prDesktopOptions').hidden = false;
    $('prOk').disabled = true;
    $('prPrinter').disabled = true;
    $('prPrinter').replaceChildren();
    try {
      const result = await getPrinters();
      if (currentOpening !== opening || !visible()) return;
      const printers = result.printers;
      const savedPrinter = preferences.printer;
      const chosen = savedPrinter
        ? printers.find(item => item.name.toLowerCase() === savedPrinter.toLowerCase())
          || (/^DaydayPDF \([a-z0-9]+ 고속\)$/i.test(savedPrinter) ? printers.find(item => item.name === 'DaydayPDF') : undefined)
        : printers.find(item => item.isDefault) || printers[0];
      $('prPrinter').replaceChildren(...printers.map(printer => {
        const option = target.ownerDocument.createElement('option');
        option.value = printer.name; option.textContent = printer.name;
        option.dataset.pdf = String(!!printer.isPdf);
        option.selected = printer === chosen;
        return option;
      }));
      if (!chosen && printers.length) {
        const option = target.ownerDocument.createElement('option');
        option.value = ''; option.disabled = true;
        option.textContent = text('저장된 프린터를 사용할 수 없습니다. 프린터를 선택하세요.');
        $('prPrinter').prepend(option);
        $('prPrinter').value = '';
      }
      $('prOk').disabled = !chosen;
      $('prPrinter').disabled = !printers.length;
      void update();
      if (!printers.length) notify('설치된 프린터가 없습니다.');
    } catch (error) {
      if (currentOpening === opening && visible()) notify('프린터 목록을 불러오지 못했습니다: ' + error.message, 5000);
    }
  }
  function move(next) {
    const count = getIndexes()?.length || 0;
    if (!count) return;
    position = Math.max(0, Math.min(count - 1, Math.trunc(next)));
    box.scrollTop = box.scrollLeft = 0;
    void update();
  }
  $('prPreviewPrev').addEventListener('click', () => move(position - 1));
  $('prPreviewNext').addEventListener('click', () => move(position + 1));
  const jump = () => {
    const number = Number($('prPreviewPage').value);
    if (Number.isFinite(number) && number >= 1) move(number - 1);
    else syncNavigation(getIndexes());
  };
  $('prPreviewPage').addEventListener('change', jump);
  $('prPreviewPage').addEventListener('focus', () => $('prPreviewPage').select());
  $('prPreviewPage').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); jump(); }
  });
  $('prPreviewNav').addEventListener('keydown', event => {
    if (event.target === $('prPreviewPage')) return;
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      move(event.key === 'Home' ? 0 : event.key === 'End' ? (getIndexes()?.length || 1) - 1 : position + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  });
  box.addEventListener('wheel', event => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    zoom = Math.min(4, Math.max(.4, zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2)));
    void update();
  }, { passive: false });
  for (const id of fields) $(id)?.addEventListener('change', () => {
    if (id === 'prPrinter') $('prOk').disabled = !$('prPrinter').value;
    save(); void update();
  });
  $('prRange').addEventListener('change', () => {
    position = 0;
    $('prCustomRow').style.display = $('prRange').value === 'custom' ? '' : 'none';
    void update();
  });
  $('prCustom').addEventListener('input', () => { position = 0; void update(); });
  return Object.freeze({ open, update, save });
}

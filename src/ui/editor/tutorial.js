export function createEditorTutorial({ documentObject: doc, windowObject: win,
  isReading = () => false, getDocument, hasSeen, rememberSeen, replayButton }) {
  let root = null, card, spotlight, index = -1, steps = [], saved = null, frame = 0;
  let mounted = false, targets = [], inertElements = [];
  const $ = id => doc.getElementById(id);
  const text = (ko, en) => doc.documentElement.lang === 'ko' ? ko : (win.DaydayPDFI18n?.t(en) || en);
  const mobile = () => win.matchMedia('(max-width: 768px)').matches;
  const visible = el => el && el.getClientRects().length && win.getComputedStyle(el).visibility !== 'hidden';
  const remember = () => { try { rememberSeen(); } catch {} };

  function makeSteps() {
    const reading = isReading();
    return [
      { ids: ['btnOpen'], title: text('파일 열기', 'Open a PDF'),
        body: text('여기서 PDF를 엽니다. 여러 파일은 각각의 탭으로 열 수 있습니다.',
          'Open a PDF here. You can open multiple files in separate tabs.') },
      { ids: ['sidebar'], sidebar: true, title: text('페이지 이동', 'Navigate pages'),
        body: text('썸네일을 누르면 해당 페이지로 이동합니다. 패널 오른쪽 경계를 끌어 폭을 조절할 수 있습니다.',
          'Select a thumbnail to jump to its page. Drag the right edge to resize the panel.') },
      { ids: ['zoomInput', 'btnFitPage', 'btnFit'], title: text('확대·축소', 'Zoom and fit'),
        body: mobile() ? text('두 손가락으로 확대·축소합니다. 화면 맞춤은 페이지 전체를, 폭 맞춤은 가로 폭을 맞춥니다.',
          'Pinch with two fingers to zoom. Fit page shows the whole page; Fit width matches its width to the view.') :
          text('배율을 입력하거나 Ctrl+휠로 조절합니다. 화면 맞춤은 페이지 전체를, 폭 맞춤은 가로 폭을 맞춥니다.',
            'Enter a percentage or use Ctrl + wheel. Fit page shows the whole page; Fit width matches its width to the view.') },
      ...(reading ? [] : [
        { ids: ['btnText', 'btnShape'], title: text('편집 도구', 'Edit your PDF'),
          body: mobile() ? text('텍스트·도형을 추가할 수 있습니다. 오브젝트는 한 번 눌러 선택한 뒤 이동하거나 설정을 바꿉니다.',
            'Add text and shapes. Tap an object to select it, then move it or adjust its options.') :
            text('텍스트·도형을 추가할 수 있습니다. 오브젝트를 선택하면 이동하거나 모양을 수정할 수 있습니다.',
              'Add text and shapes. Select an object to move it or change its appearance.') }
      ]),
      reading ? { ids: ['btnReaderDownload', 'btnReaderFullscreen', 'btnReaderMode'], title: text('다운로드·전체화면·편집', 'Download, fullscreen and edit'),
        body: text('내려받기 아이콘은 PDF 저장, 사각형 아이콘은 전체화면, 연필 아이콘은 편집기 전환입니다. 화면을 터치하면 도구를 숨기거나 표시합니다.',
          'Use the download icon to save, the corners icon for fullscreen, and the pencil to edit. Tap the page to hide or show controls.') } :
        { ids: ['btnSave', 'btnDocumentTools'], title: text('저장·변환', 'Save and convert'),
          body: text('작업을 마치면 저장합니다. 변환 버튼에서 OCR·문서·이미지 변환을 선택할 수 있습니다.',
            'Save when you finish. Use Convert for OCR, document and image conversion.') },
      { ids: ['btnSettings'], title: text('도구모음 표시', 'Toolbar display'),
        body: text('기본은 아이콘+설명입니다. 설정 → 일반 설정 → 도구모음 표시에서 아이콘만 보이도록 바꿀 수 있습니다.',
          'Icons and labels are shown by default. To show icons only, go to Settings → General settings → Toolbar display.') }
    ];
  }

  function captureView() {
    return { document: getDocument(), focus: doc.activeElement,
      quiet: doc.body.classList.contains('readerQuiet'), sidebar: $('sidebar').classList.contains('hidden'),
      scroll: ['toolbar', 'statusbar', 'sidebar', 'viewer', 'tabStrip'].map(id => {
        const el = $(id); return { el, left: el?.scrollLeft, top: el?.scrollTop };
      }) };
  }

  function create() {
    if (root) return;
    saved = captureView();
    root = doc.createElement('div'); root.id = 'editorTutorial';
    root.innerHTML = `<div class="tutorialSpotlight" aria-hidden="true"></div>
      <section class="tutorialCard" role="dialog" aria-modal="true" aria-labelledby="tutorialTitle" aria-describedby="tutorialBody" tabindex="-1">
        <div class="tutorialTop"><span class="tutorialProgress"></span><button type="button" class="tutorialClose"></button></div>
        <div class="tutorialCopy" aria-live="polite" aria-atomic="true"><h2 id="tutorialTitle"></h2><p id="tutorialBody"></p></div>
        <div class="tutorialActions"><button type="button" class="tutorialPrevious"></button><button type="button" class="tutorialNext"></button></div>
      </section>`;
    card = root.querySelector('.tutorialCard'); spotlight = root.querySelector('.tutorialSpotlight');
    root.querySelector('.tutorialClose').textContent = text('종료 ×', 'Exit ×');
    root.querySelector('.tutorialClose').onclick = close;
    root.querySelector('.tutorialPrevious').onclick = () => index < 0 ? close() : show(index - 1);
    root.querySelector('.tutorialNext').onclick = () => index === steps.length - 1 ? close() : show(index + 1);
    root.addEventListener('click', event => { if (event.target === root) close(); });
    root.addEventListener('wheel', event => {
      event.stopPropagation();
      if (event.ctrlKey) event.preventDefault();
    }, {passive:false});
    root.addEventListener('touchmove', event => { if (!card.contains(event.target)) event.preventDefault(); }, {passive:false});
    doc.body.append(root);
    inertElements = [...doc.body.children].filter(el => el !== root && !['SCRIPT', 'STYLE'].includes(el.tagName))
      .map(el => ({ el, inert: el.inert }));
    inertElements.forEach(({el}) => { el.inert = true; });
    doc.body.classList.add('tutorialActive');
    doc.body.classList.remove('readerQuiet');
    win.addEventListener('keydown', keydown, true);
    win.addEventListener('resize', scheduleLayout);
    doc.addEventListener('scroll', scheduleLayout, true);
    win.visualViewport?.addEventListener('resize', scheduleLayout);
    win.visualViewport?.addEventListener('scroll', scheduleLayout);
  }

  function clearTargets() { targets.forEach(el => el.classList.remove('tutorialTarget')); targets = []; }

  function revealTargets() {
    const first = targets[0];
    for (let parent = first?.parentElement; parent && parent !== doc.body; parent = parent.parentElement) {
      if (parent.id !== 'toolbar' && parent.id !== 'statusbar') continue;
      const b = parent.getBoundingClientRect();
      const rects = targets.filter(el => parent.contains(el) && visible(el)).map(el => el.getBoundingClientRect());
      let left = Math.min(...rects.map(r => r.left)), right = Math.max(...rects.map(r => r.right));
      if (right - left > parent.clientWidth - 16) ({left, right} = first.getBoundingClientRect());
      if (left < b.left + 8) parent.scrollLeft += left - b.left - 8;
      else if (right > b.right - 8) parent.scrollLeft += right - b.right + 8;
    }
  }

  function show(next) {
    if (next < 0 || next >= steps.length) return;
    index = next; create(); clearTargets();
    const step = steps[index];
    $('sidebar').classList.toggle('hidden', step.sidebar ? false : saved.sidebar);
    targets = step.ids.map($).filter(visible);
    revealTargets();
    targets.forEach(el => el.classList.add('tutorialTarget'));
    root.dataset.step = String(index + 1);
    root.querySelector('.tutorialProgress').textContent = `${index + 1} / ${steps.length}`;
    root.querySelector('#tutorialTitle').textContent = step.title;
    root.querySelector('#tutorialBody').textContent = step.body;
    const previous = root.querySelector('.tutorialPrevious'); previous.textContent = text('이전', 'Previous'); previous.disabled = index === 0;
    root.querySelector('.tutorialNext').textContent = index === steps.length - 1 ? text('완료', 'Finish') : text('다음', 'Next');
    layout(); card.focus({preventScroll:true});
  }

  function layout() {
    frame = 0; if (!root) return;
    revealTargets();
    const vv = win.visualViewport;
    const left = vv?.offsetLeft || 0, top = vv?.offsetTop || 0;
    const width = vv?.width || win.innerWidth, height = vv?.height || win.innerHeight;
    const gap = 12, right = left + width, bottom = top + height;
    card.style.width = Math.min(344, width - gap * 2) + 'px';
    card.style.maxHeight = (height - gap * 2) + 'px';
    const rects = targets.filter(visible).map(el => el.getBoundingClientRect());
    let target = null;
    if (index >= 0 && rects.length) {
      target = { left: Math.max(left + 4, Math.min(...rects.map(r => r.left)) - 5),
        top: Math.max(top + 4, Math.min(...rects.map(r => r.top)) - 5),
        right: Math.min(right - 4, Math.max(...rects.map(r => r.right)) + 5),
        bottom: Math.min(bottom - 4, Math.max(...rects.map(r => r.bottom)) + 5) };
      if (target.right <= target.left || target.bottom <= target.top) target = null;
    }
    root.classList.toggle('tutorialCentered', !target);
    spotlight.hidden = !target;
    if (target) Object.assign(spotlight.style, { left: target.left + 'px', top: target.top + 'px',
      width: (target.right - target.left) + 'px', height: (target.bottom - target.top) + 'px' });
    const w = card.offsetWidth, h = card.offsetHeight;
    let x = left + (width - w) / 2, y = top + (height - h) / 2;
    if (target) {
      x = (target.left + target.right - w) / 2;
      if (target.bottom + gap + h <= bottom - gap) y = target.bottom + gap;
      else if (target.top - gap - h >= top + gap) y = target.top - gap - h;
      else if (target.right + gap + w <= right - gap) { x = target.right + gap; y = target.top + 12; }
      else y = bottom - h - gap;
    }
    card.style.left = Math.max(left + gap, Math.min(right - w - gap, x)) + 'px';
    card.style.top = Math.max(top + gap, Math.min(bottom - h - gap, y)) + 'px';
  }
  function scheduleLayout() { if (root && !frame) frame = win.requestAnimationFrame(layout); }

  function keydown(event) {
    if (!root) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); show(index - 1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); index === steps.length - 1 ? close() : show(index + 1); }
    else if (event.key === 'Tab') {
      const buttons = [...card.querySelectorAll('button')].filter(el => !el.disabled);
      const current = buttons.indexOf(doc.activeElement);
      const next = current < 0 ? (event.shiftKey ? buttons.length - 1 : 0) :
        (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      event.preventDefault(); buttons[next].focus();
    } else if (event.ctrlKey || event.metaKey) event.preventDefault();
  }

  function close() {
    if (!root) return false;
    clearTargets(); win.cancelAnimationFrame(frame); frame = 0;
    win.removeEventListener('keydown', keydown, true);
    win.removeEventListener('resize', scheduleLayout);
    doc.removeEventListener('scroll', scheduleLayout, true);
    win.visualViewport?.removeEventListener('resize', scheduleLayout);
    win.visualViewport?.removeEventListener('scroll', scheduleLayout);
    root.remove(); root = null; doc.body.classList.remove('tutorialActive');
    inertElements.forEach(({el, inert}) => { el.inert = inert; }); inertElements = [];
    $('sidebar').classList.toggle('hidden', saved.sidebar);
    doc.body.classList.toggle('readerQuiet', saved.quiet && isReading());
    if (getDocument() === saved.document) for (const {el, left, top} of saved.scroll) {
      if (el) { el.scrollLeft = left; el.scrollTop = top; }
    }
    if (visible(saved.focus) && !saved.focus.inert) saved.focus.focus({preventScroll:true});
    else if (visible(replayButton)) replayButton.focus({preventScroll:true});
    else $('btnSettings')?.focus({preventScroll:true});
    saved = null; remember(); return true;
  }

  function start() {
    if (root) close();
    $('setOverlay')?.classList.remove('show');
    steps = makeSteps(); index = 0; create(); show(0); remember();
  }
  function offer() {
    try { if (hasSeen()) return; } catch {}
    if (root || doc.visibilityState === 'hidden' || doc.querySelector('.overlay.show') ||
        doc.activeElement?.matches('input,textarea,[contenteditable="true"]')) return;
    steps = makeSteps(); index = -1; create(); root.dataset.step = 'intro';
    root.querySelector('.tutorialProgress').textContent = isReading() ? text('뷰어 아이콘 안내', 'Viewer icon guide') : text('빠르게 둘러보기', 'Quick tour');
    root.querySelector('#tutorialTitle').textContent = text(`${steps.length}단계로 시작하기`, `Get started in ${steps.length} steps`);
    root.querySelector('#tutorialBody').textContent = text('실제 화면에서 주요 기능만 짧게 안내합니다. 언제든 종료하고 설정에서 다시 시작할 수 있습니다.',
      'A brief guide to the main controls on this screen. Exit at any time and restart from Settings.');
    root.querySelector('.tutorialPrevious').textContent = text('건너뛰기', 'Skip');
    root.querySelector('.tutorialNext').textContent = text('시작', 'Start');
    layout(); card.focus({preventScroll:true});
  }
  function mount() {
    if (mounted) return false; mounted = true;
    replayButton.addEventListener('click', start);
    win.addEventListener('pdf-editor-ready', offer);
    return true;
  }
  function dispose() {
    if (!mounted) return false; close(); mounted = false;
    replayButton.removeEventListener('click', start);
    win.removeEventListener('pdf-editor-ready', offer); return true;
  }
  return Object.freeze({ name:'tutorial', mount, dispose, start, close, offer, get active() { return !!root; } });
}

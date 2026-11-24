export function createEditorDocumentTools({ getCurrentFile, hasCurrentFile = () => true,
  prepareSelectedFile = file => file, save, openPdf, loadRuntime, notify = () => {} }) {
  let runtime;
  let running = false;
  let canceled = false;
  let result = null;
  let useCurrentFile = true;
  const disposers = [];
  const panel = document.createElement('div');
  panel.className = 'overlay'; panel.id = 'documentToolsOverlay';
  panel.innerHTML = `<section class="dialog documentToolsDialog" role="dialog" aria-modal="true" aria-labelledby="documentToolsTitle">
    <h3 id="documentToolsTitle">변환</h3>
    <div class="documentFilePicker" data-pdf-source hidden>
      <input id="documentPdfInput" type="file" accept=".pdf,application/pdf" hidden>
      <button type="button" class="btn" data-pick-pdf>PDF 파일 추가</button>
      <span class="documentFileName" data-pdf-name data-i18n-ignore translate="no"></span>
    </div>
    <div class="row"><label for="documentOutput">작업</label><select id="documentOutput">
      <option value="pdf">OCR · 검색 가능한 PDF</option><option value="pptx">PDF → PPT</option>
      <option value="docx">PDF → Word</option><option value="xlsx">PDF → Excel</option>
      <option value="hwp">PDF → 한글(HWP)</option><option value="png">PDF → PNG 이미지</option>
      <option value="jpg">PDF → JPG 이미지</option><option value="import">문서 → PDF</option></select></div>
    <p class="documentToolsNote" data-description></p>
    <div class="documentFilePicker" data-import hidden>
      <input id="documentInput" type="file" accept=".docx,.xlsx,.pptx,.hwpx" hidden>
      <button type="button" class="btn" data-pick-document>문서 선택</button>
      <span class="documentFileName" data-document-name data-i18n-ignore translate="no"></span>
    </div>
    <div data-ocr><div class="row"><label for="documentLanguage">인식 언어</label><select id="documentLanguage"><option value="kor+eng">한국어 + 영어</option><option value="kor">한국어</option><option value="eng">영어</option></select></div>
      <div class="row"><label for="documentQuality">인식 품질</label><select id="documentQuality"><option value="balanced">균형 · 240 DPI</option><option value="high">정밀 · 300 DPI</option><option value="fast">빠르게 · 180 DPI</option></select></div>
      <label class="documentToolsCheck"><input type="checkbox" id="documentForce"><span>텍스트가 있는 페이지도 다시 인식</span></label></div>
    <p class="documentToolsNote" data-hwp hidden>본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.</p>
    <p class="documentToolsStatus" role="status" aria-live="polite"></p><progress max="1" value="0" hidden style="width:100%"></progress>
    <div class="btns"><button type="button" class="btn" data-close>닫기</button><button type="button" class="btn" data-open hidden>결과 PDF 열기</button><button type="button" class="btn primary" data-run>변환하여 저장</button></div>
  </section>`;
  document.body.append(panel);
  const $ = selector => panel.querySelector(selector);
  const notes = {
    pdf: '현재 편집 내용을 포함해 문자 인식을 실행합니다. 스캔 이미지의 모양을 유지하며 검색용 텍스트를 추가합니다.',
    pptx: '페이지 모양을 유지해 이미지로 슬라이드에 배치하고, 인식한 텍스트를 별도 개체로 포함합니다.',
    docx: '인식한 텍스트를 Word 문서에 저장합니다. 원본의 이미지와 문단 배치는 유지되지 않습니다.',
    xlsx: '인식한 텍스트를 페이지별 시트에 저장합니다. 이미지·표 서식·수식은 자동 복원되지 않습니다.',
    hwp: '각 페이지를 이미지로 배치한 HWP 파일을 만듭니다. HWP 안에서 글자를 직접 수정할 수 없습니다.',
    png: '현재 편집 내용을 포함해 페이지를 PNG 이미지로 저장합니다. 여러 페이지는 ZIP 파일로 저장합니다.',
    jpg: '현재 편집 내용을 포함해 페이지를 JPG 이미지로 저장합니다. 여러 페이지는 ZIP 파일로 저장합니다.',
    import: 'DOCX·XLSX·PPTX·HWPX 문서를 PDF로 변환합니다. 글꼴·복잡한 서식은 원본과 다를 수 있습니다.',
  };
  function sync() {
    const output = $('#documentOutput').value;
    $('[data-description]').textContent = !useCurrentFile && output === 'pdf'
      ? '선택한 PDF에서 문자 인식을 실행합니다. 스캔 이미지의 모양을 유지하며 검색용 텍스트를 추가합니다.'
      : !useCurrentFile && ['png', 'jpg'].includes(output)
        ? '선택한 PDF의 페이지를 이미지로 저장합니다. 여러 페이지는 ZIP 파일로 저장합니다.' : notes[output];
    $('[data-pdf-source]').hidden = useCurrentFile || output === 'import';
    $('[data-import]').hidden = output !== 'import';
    $('[data-ocr]').hidden = !['pdf', 'docx', 'xlsx', 'pptx'].includes(output);
    $('[data-hwp]').hidden = output !== 'hwp';
    result = null; $('[data-open]').hidden = true; $('.documentToolsStatus').textContent = '';
    syncFiles();
  }
  function syncFiles() {
    $('[data-pdf-name]').textContent = $('#documentPdfInput').files[0]?.name || '';
    $('[data-document-name]').textContent = $('#documentInput').files[0]?.name || '';
    const ready = $('#documentOutput').value === 'import' ? !!$('#documentInput').files[0]
      : useCurrentFile || !!$('#documentPdfInput').files[0];
    $('[data-run]').disabled = running || !ready;
  }
  $('[data-pick-pdf]').onclick = () => $('#documentPdfInput').click();
  $('[data-pick-document]').onclick = () => $('#documentInput').click();
  $('#documentPdfInput').onchange = $('#documentInput').onchange = () => {
    result = null; $('[data-open]').hidden = true; $('.documentToolsStatus').textContent = ''; syncFiles();
  };
  $('#documentOutput').onchange = sync;
  function dismiss() {
    $('#documentPdfInput').value = $('#documentInput').value = '';
    syncFiles();
    panel.classList.remove('show'); document.getElementById('btnDocumentTools')?.focus();
  }
  function close() {
    if (running) { canceled = true; disposers.splice(0).forEach(dispose => Promise.resolve(dispose()).catch(() => {})); return; }
    dismiss();
  }
  async function openResult() {
    const current = result;
    const opened = await openPdf(new File([current.bytes], current.name, { type: current.type }), current.saved);
    if (opened === false) throw new Error('결과 PDF를 열지 못했습니다. 다시 시도하세요.');
    result = null; $('[data-open]').hidden = true;
    dismiss();
    notify('결과 PDF를 새 탭으로 열었습니다.' + (current.warnings?.length ? ' ' + current.warnings.join(' ') : ''));
  }
  $('[data-close]').onclick = close;
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Tab') {
      const controls = [...panel.querySelectorAll('button,input,select')].filter(el => !el.disabled && el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  $('[data-open]').onclick = async () => {
    if (!result || running) return;
    running = true; $('[data-open]').disabled = true;
    try { await openResult(); }
    catch (error) { $('.documentToolsStatus').textContent = String(error.message || error); }
    finally { running = false; $('[data-open]').disabled = false; }
  };
  $('[data-run]').onclick = async () => {
    if (running) return;
    running = true; canceled = false; result = null;
    const output = $('#documentOutput').value;
    const selectedFile = $('#documentInput').files[0];
    const options = { output, language: $('#documentLanguage').value, quality: $('#documentQuality').value, forceOcr: $('#documentForce').checked };
    panel.querySelectorAll('input,select,[data-run],[data-open],[data-pick-pdf],[data-pick-document]').forEach(el => el.disabled = true);
    $('[data-open]').hidden = true; $('[data-close]').textContent = '취소'; $('progress').hidden = false;
    const report = (ratio, message) => { $('progress').value = Math.max(0, Math.min(1, ratio)); $('.documentToolsStatus').textContent = message; };
    const check = () => { if (canceled) throw new Error('작업을 취소했습니다.'); };
    try {
      report(0, '문서 준비 중');
      const file = output === 'import' ? await prepareSelectedFile(selectedFile)
        : useCurrentFile ? await getCurrentFile() : await prepareSelectedFile($('#documentPdfInput').files[0]);
      if (!file) throw new Error(output === 'import' ? '변환할 문서를 선택하세요.' : 'PDF 파일을 선택하세요.');
      check();
      runtime ||= await loadRuntime();
      result = await runtime.convertEditorDocument(file, { ...options, report,
        context: { throwIfCancelled: check, addDisposer: dispose => disposers.push(dispose) } });
      check();
      const saved = await save(result.bytes, result.type, result.name);
      result.saved = saved;
      check();
      report(1, (saved?.canceled ? '저장을 취소했습니다.' : '저장했습니다.') + (result.warnings?.length ? ' ' + result.warnings.join(' ') : ''));
      $('[data-open]').hidden = result.type !== 'application/pdf' || !!saved?.canceled;
      if (!$('[data-open]').hidden) await openResult();
    } catch (error) { $('.documentToolsStatus').textContent = canceled ? '작업을 취소했습니다.' : String(error.message || error); }
    finally {
      running = false; disposers.length = 0; $('progress').hidden = true;
      panel.querySelectorAll('input,select,[data-run],[data-open],[data-pick-pdf],[data-pick-document]').forEach(el => el.disabled = false);
      $('[data-close]').textContent = '닫기';
      syncFiles();
    }
  };
  sync();
  return { open() {
    if (running) return;
    useCurrentFile = hasCurrentFile();
    $('#documentPdfInput').value = $('#documentInput').value = '';
    sync(); panel.classList.add('show');
    ($('#documentOutput').value === 'import' ? $('[data-pick-document]')
      : useCurrentFile ? $('#documentOutput') : $('[data-pick-pdf]')).focus();
  } };
}

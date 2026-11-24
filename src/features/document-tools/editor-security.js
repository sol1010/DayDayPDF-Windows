export function createEditorSecurity({ getCurrentFile, hasCurrentFile = () => true,
  prepareSelectedFile = file => file, save, loadRuntime }) {
  let running = false, mode = 'lock';
  let useCurrentFile = true;
  const panel = document.createElement('div'); panel.className = 'overlay'; panel.id = 'securityOverlay';
  panel.innerHTML = `<section class="dialog documentToolsDialog" role="dialog" aria-modal="true" aria-labelledby="securityTitle">
    <h3 id="securityTitle">PDF 암호 설정</h3>
    <div class="documentFilePicker" data-pdf-source hidden>
      <input id="securityPdfInput" type="file" accept=".pdf,application/pdf" hidden>
      <button type="button" class="btn" data-pick-pdf>PDF 파일 추가</button>
      <span class="documentFileName" data-pdf-name data-i18n-ignore translate="no"></span>
    </div>
    <p class="documentToolsNote" data-note></p>
    <form><div class="row"><label for="securityPassword">암호</label><input id="securityPassword" type="password" autocomplete="new-password" maxlength="127"></div>
    <div class="row" data-confirm><label for="securityConfirm">확인</label><input id="securityConfirm" type="password" autocomplete="new-password" maxlength="127"></div>
    <p class="documentToolsStatus" role="status" aria-live="polite"></p>
    <div class="btns"><button class="btn" type="button" data-close>닫기</button><button class="btn primary" type="submit" data-run>암호 설정하여 저장</button></div></form>
  </section>`;
  document.body.append(panel);
  const $ = selector => panel.querySelector(selector);
  function syncFile() {
    $('[data-pdf-name]').textContent = $('#securityPdfInput').files[0]?.name || '';
    $('[data-run]').disabled = running || (!useCurrentFile && !$('#securityPdfInput').files[0]);
  }
  $('[data-pick-pdf]').onclick = () => $('#securityPdfInput').click();
  $('#securityPdfInput').onchange = () => { $('.documentToolsStatus').textContent = ''; syncFile(); };
  function close() {
    if (running) return;
    panel.classList.remove('show'); $('#securityPassword').value = $('#securityConfirm').value = '';
    $('#securityPdfInput').value = ''; syncFile();
    document.getElementById(mode === 'lock' ? 'btnPdfLock' : 'btnPdfUnlock')?.focus();
  }
  $('[data-close]').onclick = close;
  panel.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key === 'Tab') {
      const inputs = [...panel.querySelectorAll('input,button')].filter(el => !el.disabled && el.getClientRects().length);
      if (!inputs.length) { e.preventDefault(); return; }
      if (e.shiftKey && document.activeElement === inputs[0]) { e.preventDefault(); inputs.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === inputs.at(-1)) { e.preventDefault(); inputs[0].focus(); }
    }
  });
  $('form').onsubmit = async e => {
    e.preventDefault(); if (running) return;
    const password = $('#securityPassword').value;
    if (mode === 'lock' && password !== $('#securityConfirm').value) { $('.documentToolsStatus').textContent = '입력한 암호가 일치하지 않습니다.'; $('#securityConfirm').focus(); return; }
    if (new TextEncoder().encode(password).length > 127) { $('.documentToolsStatus').textContent = '암호는 영문 127자 또는 한글 42자 이내로 입력하세요.'; return; }
    running = true; panel.querySelectorAll('input,button').forEach(el => el.disabled = true);
    $('.documentToolsStatus').textContent = 'PDF 처리 중…';
    try {
      const file = useCurrentFile ? await getCurrentFile(mode) : await prepareSelectedFile($('#securityPdfInput').files[0]);
      if (!file) throw new Error('PDF 파일을 선택하세요.');
      const runtime = await loadRuntime();
      const bytes = await runtime.secureEditorPdf(new Uint8Array(await file.arrayBuffer()), { mode, password });
      const name = file.name.replace(/\.pdf$/i, '') + (mode === 'lock' ? '_암호설정.pdf' : '_암호해제.pdf');
      const result = await save(bytes, name);
      $('.documentToolsStatus').textContent = result?.canceled ? '저장을 취소했습니다.' : '저장했습니다.';
    } catch (error) { $('.documentToolsStatus').textContent = String(error.message || error).slice(0, 240); }
    finally { running = false; panel.querySelectorAll('input,button').forEach(el => el.disabled = false); $('#securityPassword').value = $('#securityConfirm').value = ''; syncFile(); }
  };
  return { open(nextMode) {
    if (running) return;
    mode = nextMode === 'unlock' ? 'unlock' : 'lock';
    useCurrentFile = hasCurrentFile();
    $('#securityPdfInput').value = '';
    $('[data-pdf-source]').hidden = useCurrentFile;
    $('#securityTitle').textContent = mode === 'lock' ? 'PDF 암호 설정' : 'PDF 암호 해제';
    $('[data-note]').textContent = mode === 'lock'
      ? useCurrentFile ? '현재 편집 내용을 포함한 PDF에 열기 암호를 설정해 사본으로 저장합니다.'
        : '선택한 PDF에 열기 암호를 설정해 사본으로 저장합니다.'
      : '암호를 입력해 암호 없는 사본을 저장합니다. 이미 해제된 문서는 암호를 비워도 됩니다.';
    $('[data-confirm]').hidden = mode !== 'lock';
    $('#securityPassword').required = $('#securityConfirm').required = mode === 'lock';
    $('#securityPassword').autocomplete = mode === 'lock' ? 'new-password' : 'current-password';
    $('[data-run]').textContent = mode === 'lock' ? '암호 설정하여 저장' : '암호 해제하여 저장';
    $('.documentToolsStatus').textContent = ''; $('#securityPassword').value = $('#securityConfirm').value = '';
    syncFile(); panel.classList.add('show');
    (useCurrentFile ? $('#securityPassword') : $('[data-pick-pdf]')).focus();
  } };
}

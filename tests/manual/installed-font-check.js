window.runInstalledFontCheck = async () => {
  const verify = (test, message) => { if (!test) throw new Error(message); };
  const selected = fontCatalog.find(f => f.systemName === 'Malgun Gothic');
  verify(selected, 'Windows catalog did not supply Malgun Gothic');
  const sample = Uint8Array.from(atob(window.pcFontFixture), ch => ch.charCodeAt(0));
  await openFiles([new File([sample], 'pc-font-fixture.pdf')], false);
  const result = [];
  for (const n of [11, 33, 37, 83, 125]) {
    const canvas = document.createElement('canvas');
    await displayPainter.paintPage(editorStore.pages[n - 1], canvas, 3);
    const context = canvas.getContext('2d');
    const counts = [[193,200],[201,208]].map(([a,b]) => {
      const data = context.getImageData(a*3,398*3,(b-a)*3,12*3).data;
      let count = 0;
      for (let i=0;i<data.length;i+=4) if (data[i] < 200) count++;
      return count;
    });
    verify(counts.every(c => c > 0), 'Missing Korean glyph on page ' + n);
    result.push(counts);
    canvas.width = canvas.height = 0;
  }
  for (const prefix of ['tb','st']) {
    $(prefix + 'FontButton').click();
    $('fontPickerTabs').querySelector('[data-font-language="pc"]').click();
    $('fontPickerSearch').value = 'Malgun Gothic';
    $('fontPickerSearch').dispatchEvent(new Event('input'));
    const row = Array.from($('fontPickerList').children).find(e => e.dataset.fontKey === selected.key);
    verify(row, 'Installed font missing from ' + prefix);
    row.querySelector('.fontPickerChoose').click();
    await new Promise(r => setTimeout(r,25));
    verify($(prefix + 'Font').value === selected.key, 'Font selection did not persist');
  }
  const text = '보 및 천장형 Aa';
  verify(lastTextStyle.font === selected.key, 'New text did not retain the selected PC font');
  const obj = {fx:.12,fy:.2,text,font:lastTextStyle.font,size:24,color:'#000000',bold:true};
  const bytes = await buildPdf([{...editorStore.pages[0], texts:[obj]}]);
  const saved = await openPdfDocument(bytes.slice()).promise;
  const page = await saved.getPage(1);
  const textData = await page.getTextContent();
  verify(textData.items.some(i => i.str.includes('보 및 천장형')), 'Written PDF text was lost');
  const parsed = await pdfLib.raw.PDFDocument.load(bytes);
  const dicts = parsed.context.enumerateIndirectObjects().map(([,v]) => v);
  const name = pdfLib.raw.PDFName.of;
  const original = await fetchPdfFontRecord(selected.key, true, text);
  const desc = dicts.find(v => v.get?.(name('FontFile2')) && v.get(name('FontName'))?.decodeText?.() === original.customName);
  verify(desc, 'No embedded Malgun Gothic');
  const subset = pdfLib.raw.decodePDFRawStream(desc.lookup(name('FontFile2'))).getBytes();
  verify(embeddingFlags(subset) === embeddingFlags(original.bytes), 'Font embedding permission changed');
  verify(subset.length < original.bytes.length, 'Did not subset the installed TrueType font');
  const restored = await tryOpenMarked(new File([bytes],'saved.pdf'), saved, bytes);
  verify(restored?.pages[0]?.texts?.some(t => t.font === selected.key && t.bold && t.text === text), 'Reopened font or text mismatch');
  return {pages: result, localFamilies: fontCatalog.filter(f => f.source === 'installed').length, selected:selected.systemName, saved:bytes.length};
};
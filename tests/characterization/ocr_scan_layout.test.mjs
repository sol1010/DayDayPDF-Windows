import test from 'node:test';
import assert from 'node:assert/strict';
import { matchPreviousOcr, scanTextRuns, scanNativeRegions } from '../../src/tools/ocr-scan-layout.js';

const box = (x0, x1) => ({ x0, x1, y0: 10, y1: 30 });
const word = (text, x0, x1, confidence = 98) => ({ text, bbox: box(x0, x1), confidence });

test('OCR preserves Korean spacing and separates distant table cells and existing PDF text', () => {
  const words = [word('검',1,9), word('사',10,18), word('완료',26,50,65), word('125',130,160)];
  const line = { text:'검사 완료 125', words };
  assert.deepEqual(scanTextRuns([line], []).map(r => [r.text,r.confidence]), [['검사 완료',65], ['125',98]]);
  assert.deepEqual(scanTextRuns([line], [box(0,20)]).map(r => r.text), ['완료','125']);
});

test('reprocessing an existing OCR line preserves corrections until an explicit re-recognition', () => {
  const lines = [{ text:'합격', pdfBox:box(1,58) }];
  const hidden = [{ index:4, text:'승인', box:box(0,60) },{ index:7, text:'다른 줄', box:box(100,160) }];
  assert.deepEqual(matchPreviousOcr(lines,hidden,true),{ lines:[{text:'승인',pdfBox:box(1,58)}], remove:[4] });
  assert.equal(matchPreviousOcr(lines,hidden,false).lines[0].text,'합격');
  assert.deepEqual(matchPreviousOcr([{text:'승',pdfBox:box(1,11)}],hidden,true),{lines:[], remove:[]});
});

test('the editable scan retains selectable digital text on the same page', () => {
  const items = ['원본','숨김'].map((str,i)=>({str,width:20,transform:[10,0,0,10,20+60*i,10],fontName:'F'}));
  const result = scanNativeRegions({ items,styles:{F:{ascent:1,descent:0}} },{convertToViewportPoint:(x,y)=>[2*x,200-2*y]},
    [{text:'숨김',box:{x0:80,x1:100,y0:10,y1:20}}]);
  assert.deepEqual(result,[{x0:40,y0:160,x1:80,y1:180}]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EXTRA_TRANSLATIONS } from '../../src/i18n/extra-locales.js';
import { normalizeLanguage, translateUiText } from '../../src/i18n/desktop-i18n.js';

test('normalizes Windows display languages', () => {
  for (const [input, output] of [['zh-CN','zh'],['zh-Hans','zh'],['zh_Hans_SG','zh'],['ja-JP','ja'],['vi-VN','vi'],['ko-KR','ko'],['en-US','en'],['fr','en']]) assert.equal(normalizeLanguage(input), output);

});

test('Japanese, Vietnamese and Chinese catalogs are complete, preserving user filenames', () => {
  assert.ok(EXTRA_TRANSLATIONS['Draw'] && EXTRA_TRANSLATIONS['Save']);
  for (const [en, translations] of Object.entries(EXTRA_TRANSLATIONS)) {
    assert.equal(translations.length,3);
    for (const [index, lang] of ['ja','vi','zh'].entries()) {
      if (!en.trim()) continue;
      assert.ok(translations[index].trim(), `${lang}: ${en}`);
      assert.equal(translateUiText(en,lang).trim(), translations[index].trim(), `${lang}: ${en}`);
    }
  }
  assert.match(translateUiText('Original Page.pdf','ja'),/Page\.pdf$/);
  assert.equal(translateUiText('텍스트','ja'),'文字');
  assert.equal(translateUiText('텍스트','vi'),'Văn bản');
  assert.equal(translateUiText('Save','ko'),'저장');
  assert.equal(translateUiText('저장 (Y)','ja'),'保存 (Y)');
  assert.equal(translateUiText('Get started in 6 steps','vi'),'Bắt đầu trong 6 bước');
});

test('Chinese UI preserves filenames, numeric statuses and locale switching', () => {
  assert.equal(translateUiText('그리기','zh'),'绘画');
  assert.equal(translateUiText('저장 (Ctrl+S)','zh'),'保存 (Ctrl+S)');
  assert.equal(translateUiText('Get started in 6 steps','zh'),'6 步快速上手');
  assert.equal(translateUiText('3개 문서를 각각 탭으로 열었습니다','zh'),'已在独立标签页中打开 3 个文档。');
  assert.equal(translateUiText('Page_文件.pdf (12 pages)','zh'),'Page_文件.pdf（12 页）');
  assert.equal(translateUiText('3개 페이지 인쇄','zh'),'打印 3 页');
  assert.equal(translateUiText('3 selected','zh'),'已选择 3 项');
  assert.equal(translateUiText('绘画','ko'),'그리기');
  assert.equal(translateUiText('绘画','en'),'Draw');
});

test('locale translation preserves numeric versions and decimal measurements', () => {
  for (const lang of ['ko','en','ja','vi','zh']) {
    for (const value of ['26.09.10.2','26.09.10.02','1.25','95.5%','Apache-2.0']) {
      assert.equal(translateUiText(value,lang),value,`${lang}: ${value}`);
    }
    assert.ok(translateUiText('DaydayPDF · 26.09.10.2',lang).endsWith('26.09.10.2'));
    assert.equal(translateUiText('BETA DEV 26.09.10.02',lang),'BETA DEV 26.09.10.02');
    assert.equal(translateUiText('constructor',lang),'constructor');
    assert.equal(translateUiText('toString',lang),'toString');
  }
});

test('an older two-language catalog falls back to readable text without undefined', async () => {
  const source = await readFile(new URL('../../src/i18n/desktop-i18n.js',import.meta.url),'utf8');
  const oldCatalog = Object.fromEntries(Object.entries(EXTRA_TRANSLATIONS).map(([key,values])=>[key,values.slice(0,2)]));
  const isolated = source.replace(/^import .*extra-locales\.js';/,`const EXTRA_TRANSLATIONS = ${JSON.stringify(oldCatalog)};`);
  const { translateUiText: oldCatalogText } = await import(`data:text/javascript;base64,${Buffer.from(isolated).toString('base64')}`);
  for (const value of ['그리기','Draw','저장 (Ctrl+S)','Save (Ctrl+S)','원본 Page.pdf','26.09.10.2']) {
    const translated = oldCatalogText(value,'zh');
    assert.equal(typeof translated,'string');
    assert.ok(translated.trim());
    assert.doesNotMatch(translated,/undefined|null/);
  }
  assert.equal(oldCatalogText('그리기','zh'),'Draw');
  assert.equal(oldCatalogText('저장 (Ctrl+S)','zh'),'Save (Ctrl+S)');
  assert.equal(oldCatalogText('26.09.10.2','zh'),'26.09.10.2');
});

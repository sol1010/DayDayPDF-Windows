const titleFromFontFile = file => String(file || '')
  .replace(/\.[^.]+$/, '')
  .replace(/\[[^\]]+\]/g, '')
  .replace(/-(?:web-)?(?:regular|medium|bold|semibold|light|thin|black|italic)$/i, '')
  .replace(/_/g, ' ')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/\s+/g, ' ')
  .trim();

const asciiFamily = (label, aliases, regularFile) => {
  if (/^[\x20-\x7e]+$/.test(label)) return label;
  const alias = (aliases || []).find(value => /^[\x20-\x7e]+$/.test(value));
  return alias || titleFromFontFile(regularFile);
};

const googleFont = (key, label, category, directory, regularFile, boldFile = null, options = {}) => ({
  key, label, category, directory, regularFile, boldFile, source: 'google', base: options.base || 'ofl',
  language: options.language || 'en', supportsKo: options.language === 'ko', license: options.license || 'OFL',
  subset: options.subset ?? (options.language !== 'ko' || !regularFile.includes('[')),
  aliases: options.aliases || [],
  googleFamily: options.googleFamily || asciiFamily(label, options.aliases, regularFile),
});

const koreanFont = (key, label, category, directory, regularFile, boldFile = null, aliases = []) =>
  googleFont(key, label, category, directory, regularFile, boldFile, { language: 'ko', aliases });

const englishFont = (key, label, category, directory, regularFile, boldFile = null, options = {}) =>
  googleFont(key, label, category, directory, regularFile, boldFile, options);

const SPOQA = {
  key: 'spoqa', label: '스포카 한 산스', category: 'sans', language: 'ko', supportsKo: true,
  source: 'spoqa', license: 'OFL', aliases: ['Spoqa Han Sans', 'SpoqaHanSans'],
  subset: false,
  urls: [
    'https://cdn.jsdelivr.net/gh/spoqa/spoqa-han-sans@3.3.0/Subset/SpoqaHanSans/SpoqaHanSansRegular.ttf',
    'https://fastly.jsdelivr.net/gh/spoqa/spoqa-han-sans@3.3.0/Subset/SpoqaHanSans/SpoqaHanSansRegular.ttf',
  ],
  boldUrls: [
    'https://cdn.jsdelivr.net/gh/spoqa/spoqa-han-sans@3.3.0/Subset/SpoqaHanSans/SpoqaHanSansBold.ttf',
    'https://fastly.jsdelivr.net/gh/spoqa/spoqa-han-sans@3.3.0/Subset/SpoqaHanSans/SpoqaHanSansBold.ttf',
  ],
};

const KOREAN_FONTS = [
  koreanFont('notosanskr', 'Noto Sans KR', 'sans', 'notosanskr', 'NotoSansKR[wght].ttf', null,
    ['Noto Sans CJK KR', 'NotoSansCJKkr', 'Source Han Sans K', '본고딕', '맑은 고딕', 'Malgun Gothic']),
  koreanFont('kopubbatang', 'KoPub 바탕', 'serif', 'kopubbatang', 'KoPubBatang-Regular.ttf', 'KoPubBatang-Bold.ttf',
    ['KoPub Batang', 'Noto Serif KR', 'Noto Serif CJK KR', 'NotoSerifCJKkr', 'Source Han Serif K', '본명조', '바탕', 'Batang']),
  koreanFont('nanum', '나눔고딕', 'sans', 'nanumgothic', 'NanumGothic-Regular.ttf', 'NanumGothic-Bold.ttf', ['Nanum Gothic']),
  koreanFont('myeongjo', '나눔명조', 'serif', 'nanummyeongjo', 'NanumMyeongjo-Regular.ttf', 'NanumMyeongjo-Bold.ttf', ['Nanum Myeongjo']),
  koreanFont('pen', '나눔손글씨 펜', 'handwriting', 'nanumpenscript', 'NanumPenScript-Regular.ttf', null, ['Nanum Pen Script']),
  koreanFont('nanumbrush', '나눔손글씨 붓', 'handwriting', 'nanumbrushscript', 'NanumBrushScript-Regular.ttf', null, ['Nanum Brush Script']),
  koreanFont('blackhansans', '검은고딕', 'display', 'blackhansans', 'BlackHanSans-Regular.ttf', null, ['Black Han Sans']),
  koreanFont('dohyeon', '도현', 'display', 'dohyeon', 'DoHyeon-Regular.ttf', null, ['Do Hyeon']),
  koreanFont('jua', '주아', 'display', 'jua', 'Jua-Regular.ttf'),
  koreanFont('gowundodum', '고운돋움', 'sans', 'gowundodum', 'GowunDodum-Regular.ttf', null, ['Gowun Dodum']),
  koreanFont('gowunbatang', '고운바탕', 'serif', 'gowunbatang', 'GowunBatang-Regular.ttf', 'GowunBatang-Bold.ttf', ['Gowun Batang']),
  koreanFont('hahmlet', '함렛', 'serif', 'hahmlet', 'Hahmlet[wght].ttf', null, ['Hahmlet']),
  koreanFont('ibmplexsanskr', 'IBM Plex Sans KR', 'sans', 'ibmplexsanskr', 'IBMPlexSansKR-Regular.ttf', 'IBMPlexSansKR-Bold.ttf'),
  koreanFont('gugi', '구기', 'display', 'gugi', 'Gugi-Regular.ttf', null, ['Gugi']),
  koreanFont('songmyung', '송명', 'serif', 'songmyung', 'SongMyung-Regular.ttf', null, ['Song Myung']),
  koreanFont('dokdo', '독도', 'handwriting', 'dokdo', 'Dokdo-Regular.ttf'),
  koreanFont('eastseadokdo', 'East Sea Dokdo', 'handwriting', 'eastseadokdo', 'EastSeaDokdo-Regular.ttf'),
  koreanFont('gamjaflower', '감자꽃', 'handwriting', 'gamjaflower', 'GamjaFlower-Regular.ttf', null, ['Gamja Flower']),
  koreanFont('gaegu', '개구', 'handwriting', 'gaegu', 'Gaegu-Regular.ttf', 'Gaegu-Bold.ttf', ['Gaegu']),
  koreanFont('kiranghaerang', '기랑해랑', 'display', 'kiranghaerang', 'KirangHaerang-Regular.ttf', null, ['Kirang Haerang']),
  koreanFont('cutefont', '귀여운 글씨', 'handwriting', 'cutefont', 'CuteFont-Regular.ttf', null, ['Cute Font']),
  koreanFont('singleday', '싱글데이', 'display', 'singleday', 'SingleDay-Regular.ttf', null, ['Single Day']),
  koreanFont('sunflower', '해바라기', 'sans', 'sunflower', 'Sunflower-Medium.ttf', 'Sunflower-Bold.ttf', ['Sunflower']),
  koreanFont('himelody', '하이멜로디', 'handwriting', 'himelody', 'HiMelody-Regular.ttf', null, ['Hi Melody']),
  koreanFont('poorstory', '푸어스토리', 'handwriting', 'poorstory', 'PoorStory-Regular.ttf', null, ['Poor Story']),
  koreanFont('stylish', '스타일리시', 'display', 'stylish', 'Stylish-Regular.ttf', null, ['Stylish']),
  koreanFont('yeonsung', '연성', 'handwriting', 'yeonsung', 'YeonSung-Regular.ttf', null, ['Yeon Sung']),
  koreanFont('gothica1', 'Gothic A1', 'sans', 'gothica1', 'GothicA1-Regular.ttf', 'GothicA1-Bold.ttf'),
  koreanFont('grandifloraone', 'Grandiflora One', 'serif', 'grandifloraone', 'GrandifloraOne-Regular.ttf'),
  koreanFont('orbit', '오르빗', 'sans', 'orbit', 'Orbit-Regular.ttf', null, ['Orbit']),
  koreanFont('bagelfatone', '베이글팻원', 'display', 'bagelfatone', 'BagelFatOne-Regular.ttf', null, ['Bagel Fat One']),
  koreanFont('diphylleia', '디필레이아', 'serif', 'diphylleia', 'Diphylleia-Regular.ttf', null, ['Diphylleia']),
  koreanFont('dongle', '동글', 'sans', 'dongle', 'Dongle-Regular.ttf', 'Dongle-Bold.ttf', ['Dongle']),
  koreanFont('gasoekone', '가석원', 'display', 'gasoekone', 'GasoekOne-Regular.ttf', null, ['Gasoek One']),
];

const ENGLISH_FONTS = [
  englishFont('roboto', 'Roboto', 'sans', 'roboto', 'Roboto[wdth,wght].ttf', null,
    { aliases: ['Arial', 'Helvetica', 'Segoe UI'] }),
  englishFont('robotoslab', 'Roboto Slab', 'serif', 'robotoslab', 'RobotoSlab[wght].ttf', null,
    { base: 'apache', license: 'Apache-2.0', aliases: ['Times New Roman'] }),
  englishFont('opensans', 'Open Sans', 'sans', 'opensans', 'OpenSans[wdth,wght].ttf'),
  englishFont('lato', 'Lato', 'sans', 'lato', 'Lato-Regular.ttf', 'Lato-Bold.ttf'),
  englishFont('montserrat', 'Montserrat', 'sans', 'montserrat', 'Montserrat[wght].ttf'),
  englishFont('poppins', 'Poppins', 'sans', 'poppins', 'Poppins-Regular.ttf', 'Poppins-Bold.ttf'),
  englishFont('inter', 'Inter', 'sans', 'inter', 'Inter[opsz,wght].ttf'),
  englishFont('nunito', 'Nunito', 'sans', 'nunito', 'Nunito[wght].ttf'),
  englishFont('raleway', 'Raleway', 'sans', 'raleway', 'Raleway[wght].ttf'),
  englishFont('oswald', 'Oswald', 'sans', 'oswald', 'Oswald[wght].ttf'),
  englishFont('merriweather', 'Merriweather', 'serif', 'merriweather', 'Merriweather[opsz,wdth,wght].ttf'),
  englishFont('playfairdisplay', 'Playfair Display', 'serif', 'playfairdisplay', 'PlayfairDisplay[wght].ttf'),
  englishFont('librebaskerville', 'Libre Baskerville', 'serif', 'librebaskerville', 'LibreBaskerville[wght].ttf'),
  englishFont('sourcesans3', 'Source Sans 3', 'sans', 'sourcesans3', 'SourceSans3[wght].ttf'),
  englishFont('sourceserif4', 'Source Serif 4', 'serif', 'sourceserif4', 'SourceSerif4[opsz,wght].ttf'),
  englishFont('firasans', 'Fira Sans', 'sans', 'firasans', 'FiraSans-Regular.ttf', 'FiraSans-Bold.ttf'),
  englishFont('firacode', 'Fira Code', 'mono', 'firacode', 'FiraCode[wght].ttf'),
  englishFont('jetbrainsmono', 'JetBrains Mono', 'mono', 'jetbrainsmono', 'JetBrainsMono[wght].ttf'),
  englishFont('inconsolata', 'Inconsolata', 'mono', 'inconsolata', 'Inconsolata[wdth,wght].ttf'),
  englishFont('dmsans', 'DM Sans', 'sans', 'dmsans', 'DMSans[opsz,wght].ttf'),
  englishFont('dmserifdisplay', 'DM Serif Display', 'serif', 'dmserifdisplay', 'DMSerifDisplay-Regular.ttf'),
  englishFont('worksans', 'Work Sans', 'sans', 'worksans', 'WorkSans[wght].ttf'),
  englishFont('manrope', 'Manrope', 'sans', 'manrope', 'Manrope[wght].ttf'),
  englishFont('mulish', 'Mulish', 'sans', 'mulish', 'Mulish[wght].ttf'),
  englishFont('rubik', 'Rubik', 'sans', 'rubik', 'Rubik[wght].ttf'),
  englishFont('quicksand', 'Quicksand', 'sans', 'quicksand', 'Quicksand[wght].ttf'),
  englishFont('comfortaa', 'Comfortaa', 'sans', 'comfortaa', 'Comfortaa[wght].ttf'),
  englishFont('cabin', 'Cabin', 'sans', 'cabin', 'Cabin[wdth,wght].ttf'),
  englishFont('karla', 'Karla', 'sans', 'karla', 'Karla[wght].ttf'),
  englishFont('arimo', 'Arimo', 'sans', 'arimo', 'Arimo[wght].ttf'),
  englishFont('ptsans', 'PT Sans', 'sans', 'ptsans', 'PT_Sans-Web-Regular.ttf', 'PT_Sans-Web-Bold.ttf'),
  englishFont('ptserif', 'PT Serif', 'serif', 'ptserif', 'PT_Serif-Web-Regular.ttf', 'PT_Serif-Web-Bold.ttf'),
  englishFont('notosans', 'Noto Sans', 'sans', 'notosans', 'NotoSans[wdth,wght].ttf'),
  englishFont('notoserif', 'Noto Serif', 'serif', 'notoserif', 'NotoSerif[wdth,wght].ttf'),
  englishFont('ibmplexsans', 'IBM Plex Sans', 'sans', 'ibmplexsans', 'IBMPlexSans[wdth,wght].ttf'),
  englishFont('ibmplexserif', 'IBM Plex Serif', 'serif', 'ibmplexserif', 'IBMPlexSerif-Regular.ttf', 'IBMPlexSerif-Bold.ttf'),
  englishFont('ibmplexmono', 'IBM Plex Mono', 'mono', 'ibmplexmono', 'IBMPlexMono-Regular.ttf', 'IBMPlexMono-Bold.ttf'),
  englishFont('barlow', 'Barlow', 'sans', 'barlow', 'Barlow-Regular.ttf', 'Barlow-Bold.ttf'),
  englishFont('barlowcondensed', 'Barlow Condensed', 'sans', 'barlowcondensed', 'BarlowCondensed-Regular.ttf', 'BarlowCondensed-Bold.ttf'),
  englishFont('bebasneue', 'Bebas Neue', 'display', 'bebasneue', 'BebasNeue-Regular.ttf'),
  englishFont('anton', 'Anton', 'display', 'anton', 'Anton-Regular.ttf'),
  englishFont('archivo', 'Archivo', 'sans', 'archivo', 'Archivo[wdth,wght].ttf'),
  englishFont('archivoblack', 'Archivo Black', 'display', 'archivoblack', 'ArchivoBlack-Regular.ttf'),
  englishFont('leaguespartan', 'League Spartan', 'sans', 'leaguespartan', 'LeagueSpartan[wght].ttf'),
  englishFont('josefinsans', 'Josefin Sans', 'sans', 'josefinsans', 'JosefinSans[wght].ttf'),
  englishFont('josefinslab', 'Josefin Slab', 'serif', 'josefinslab', 'JosefinSlab[wght].ttf'),
  englishFont('crimsonpro', 'Crimson Pro', 'serif', 'crimsonpro', 'CrimsonPro[wght].ttf'),
  englishFont('ebgaramond', 'EB Garamond', 'serif', 'ebgaramond', 'EBGaramond[wght].ttf'),
  englishFont('cormorantgaramond', 'Cormorant Garamond', 'serif', 'cormorantgaramond', 'CormorantGaramond[wght].ttf'),
  englishFont('lora', 'Lora', 'serif', 'lora', 'Lora[wght].ttf'),
  englishFont('bitter', 'Bitter', 'serif', 'bitter', 'Bitter[wght].ttf'),
  englishFont('vollkorn', 'Vollkorn', 'serif', 'vollkorn', 'Vollkorn[wght].ttf'),
  englishFont('spectral', 'Spectral', 'serif', 'spectral', 'Spectral-Regular.ttf', 'Spectral-Bold.ttf'),
  englishFont('alegreya', 'Alegreya', 'serif', 'alegreya', 'Alegreya[wght].ttf'),
  englishFont('alegreyasans', 'Alegreya Sans', 'sans', 'alegreyasans', 'AlegreyaSans-Regular.ttf', 'AlegreyaSans-Bold.ttf'),
  englishFont('abrilfatface', 'Abril Fatface', 'display', 'abrilfatface', 'AbrilFatface-Regular.ttf'),
  englishFont('alfaslabone', 'Alfa Slab One', 'display', 'alfaslabone', 'AlfaSlabOne-Regular.ttf'),
  englishFont('fredoka', 'Fredoka', 'display', 'fredoka', 'Fredoka[wdth,wght].ttf'),
  englishFont('pacifico', 'Pacifico', 'handwriting', 'pacifico', 'Pacifico-Regular.ttf'),
  englishFont('dancingscript', 'Dancing Script', 'handwriting', 'dancingscript', 'DancingScript[wght].ttf'),
  englishFont('caveat', 'Caveat', 'handwriting', 'caveat', 'Caveat[wght].ttf'),
  englishFont('indieflower', 'Indie Flower', 'handwriting', 'indieflower', 'IndieFlower-Regular.ttf'),
  englishFont('lobster', 'Lobster', 'display', 'lobster', 'Lobster-Regular.ttf'),
  englishFont('greatvibes', 'Great Vibes', 'handwriting', 'greatvibes', 'GreatVibes-Regular.ttf'),
  englishFont('shadowsintolight', 'Shadows Into Light', 'handwriting', 'shadowsintolight', 'ShadowsIntoLight.ttf'),
  englishFont('sacramento', 'Sacramento', 'handwriting', 'sacramento', 'Sacramento-Regular.ttf'),
  englishFont('cinzel', 'Cinzel', 'serif', 'cinzel', 'Cinzel[wght].ttf'),
  englishFont('spacegrotesk', 'Space Grotesk', 'sans', 'spacegrotesk', 'SpaceGrotesk[wght].ttf'),
  englishFont('sora', 'Sora', 'sans', 'sora', 'Sora[wght].ttf'),
  englishFont('lexend', 'Lexend', 'sans', 'lexend', 'Lexend[wght].ttf'),
];

export const FONT_CATALOG = Object.freeze([SPOQA, ...KOREAN_FONTS, ...ENGLISH_FONTS]
  .map(font => Object.freeze({ ...font, aliases: Object.freeze([...(font.aliases || [])]) })));

export const FONT_CATALOG_BY_KEY = Object.freeze(Object.fromEntries(FONT_CATALOG.map(font => [font.key, font])));

const normalizeFontName = value => String(value || '')
  .replace(/^[A-Z]{6}\+/, '')
  .replace(/bold|semibold|medium|regular|light|thin|black|italic/gi, '')
  .replace(/[^a-z0-9가-힣]+/gi, '')
  .toLowerCase();

export function inferSupportedFontKey(familyName, sampleText = '') {
  const normalized = normalizeFontName(familyName);
  if (normalized) {
    const candidates = FONT_CATALOG
      .flatMap(font => [font.label, font.key, ...(font.aliases || [])].map(name => [font, normalizeFontName(name)]))
      .filter(([, name]) => name)
      .sort((a, b) => b[1].length - a[1].length);
    const exact = candidates.find(([, name]) => normalized === name || normalized.includes(name) || name.includes(normalized));
    if (exact) return exact[0].key;
  }

  const family = String(familyName || '').toLowerCase();
  const hasKorean = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u.test(String(sampleText || ''));
  if (/batang|myeongjo|myungjo|mincho|song|명조|바탕|궁서|serif|times|georgia|garamond|cambria/.test(family))
    return hasKorean ? 'kopubbatang' : 'robotoslab';
  if (/hand|script|brush|pen|손글씨/.test(family)) return hasKorean ? 'pen' : 'caveat';
  if (hasKorean || /gothic|dotum|gulim|malgun|고딕|돋움|굴림/.test(family)) return 'notosanskr';
  return 'roboto';
}

export function resolveEditablePdfFont(familyName, sampleText = '', { invisible = false } = {}) {
  const family = String(familyName || '').replace(/^[A-Z]{6}\+/, '').trim();
  const normalize = value => String(value || '').toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, '');
  const normalized = normalize(family);
  const styles = /^(?:ps)?(?:(?:extra|ultra|semi|demi)?(?:bold|light)|regular|medium|thin|black|heavy|italic|oblique|roman|mt|psmt|\d+)*$/;
  const synthetic = invisible && /^(?:spoqa|glyphless|tesseract|daydayocr)/i.test(normalized);
  const matches = synthetic ? [] : FONT_CATALOG.flatMap(font => {
    const names = [font.googleFamily, font.label, font.directory,
      (font.regularFile || '').replace(/(?:\[.*\]|-Regular)?\.(?:ttf|otf)$/i, '')];
    return names.filter(Boolean).map(name => ({ font, name: normalize(name) }));
  }).filter(({ name }) => name && normalized.startsWith(name) && styles.test(normalized.slice(name.length)))
    .sort((a, b) => b.name.length - a.name.length);
  const exact = matches[0]?.font;
  const hasKorean = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u.test(String(sampleText));
  const key = exact && (!hasKorean || exact.supportsKo) ? exact.key
    : inferSupportedFontKey(synthetic ? '' : family, sampleText);
  const usableKey = hasKorean && !FONT_CATALOG_BY_KEY[key]?.supportsKo ? 'notosanskr' : key;
  return Object.freeze({
    key: usableKey, family,
    match: exact?.key === usableKey ? 'exact' : 'substitute',
    source: FONT_CATALOG_BY_KEY[usableKey].source,
    synthetic,
  });
}

export function fontCss(fontOrKey) {
  const font = typeof fontOrKey === 'string' ? FONT_CATALOG_BY_KEY[fontOrKey] : fontOrKey;
  if (!font) return '"PDFEditor Spoqa","Malgun Gothic","맑은 고딕",sans-serif';
  const family = `PDFEditor ${font.label}`;
  const quoted = `"${family}"`;
  if (font.category === 'serif') return `${quoted},"Times New Roman",serif`;
  if (font.category === 'mono') return `${quoted},Consolas,"Courier New",monospace`;
  if (font.category === 'handwriting') return `${quoted},cursive`;
  return `${quoted},"Segoe UI","Malgun Gothic",sans-serif`;
}

export function googleFontUrls(font, gfSha, file = font.regularFile) {
  if (font.source !== 'google' || !file) return font.urls || [];
  const path = `${font.base || 'ofl'}/${font.directory}/${encodeURIComponent(file)}`;
  return [
    `https://cdn.jsdelivr.net/gh/google/fonts@${gfSha}/${path}`,
    `https://fastly.jsdelivr.net/gh/google/fonts@${gfSha}/${path}`,
  ];
}

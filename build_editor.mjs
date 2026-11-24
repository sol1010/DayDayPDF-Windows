import { build, transform } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(root, 'src', 'PDF편집기.template.html');
const brandLogoPath = resolve(root, 'src', 'assets', 'daydaypdf-wordmark.svg');
const mainPath = resolve(root, 'src', 'main.js');
const editorAppPath = resolve(root, 'src', 'editor-app.js');
const stylePaths = Object.freeze([
  'language-menu.css', 'tokens.css', 'shell.css', 'viewer.css', 'editors.css', 'dialogs.css', 'tutorial.css', 'toolbar-display.css', 'mobile.css', 'page-navigation.css', 'glass-theme.css',
].map(name => resolve(root, 'src', 'styles', name)));
const editorTemplatePaths = Object.freeze({
  '<!--__PDF_EDITOR_TOOLS_TEMPLATE__-->': resolve(root, 'src', 'ui', 'editor', 'templates', 'editor-tools.html'),
  '<!--__PDF_EDITOR_DIALOGS_TEMPLATE__-->': resolve(root, 'src', 'ui', 'editor', 'templates', 'dialogs.html'),
});
const inlineRoots = Object.freeze({
  core: resolve(root, 'src', 'core'),
  adapters: resolve(root, 'src', 'adapters'),
  state: resolve(root, 'src', 'state'),
  rendering: resolve(root, 'src', 'rendering'),
  workers: resolve(root, 'src', 'workers'),
  features: resolve(root, 'src', 'features'),
  ui: resolve(root, 'src', 'ui'),
});
const marker = '/*__PDF_EDITOR_APP__*/';
const styleMarker = '/*__PDF_EDITOR_STYLES__*/';
const brandLogoMarker = '<!--__DAYDAYPDF_WORDMARK__-->';

function importedNames(list, specifier) {
  return list.split(',').map(part => part.trim()).filter(Boolean).map(name => {
    if (!/^[A-Za-z_$][\w$]*$/.test(name))
      throw new Error(`지원하지 않는 core import입니다 (${specifier}): ${name}`);
    return name;
  });
}

function exportedNames(source) {
  const names = new Set();
  const pattern = /\bexport\s+(?:(?:async\s+)?function|const)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(pattern)) names.add(match[1]);
  return names;
}

async function inlineBoundaryModules(editorAppSource) {
  const pattern = /^import\s*\{([\s\S]*?)\}\s*from\s*['"](\.\/(core|adapters|state|rendering|workers|features|ui)\/[^'"]+\.js(?:\?source)?)['"];?[ \t]*$/gm;
  const seen = new Set();
  let count = 0;
  const replacements = [];

  for (const match of editorAppSource.matchAll(pattern)) {
    const specifier = match[2];
    if (seen.has(specifier)) throw new Error(`core module을 중복 import했습니다: ${specifier}`);
    seen.add(specifier);
    const names = importedNames(match[1], specifier);
    const sourceImport = specifier.endsWith('?source');
    const modulePath = resolve(dirname(editorAppPath), sourceImport ? specifier.slice(0, -7) : specifier);
    const moduleRoot = inlineRoots[match[3]];
    const fromBoundary = relative(moduleRoot, modulePath);
    if (!fromBoundary || fromBoundary.startsWith('..' + sep) || isAbsolute(fromBoundary))
      throw new Error(`인라인 경계를 벗어난 import입니다: ${specifier}`);

    const rawModuleSource = await readFile(modulePath, 'utf8');
    const moduleSource = sourceImport
      ? `export const ${modulePath.split(/[\\/]/).pop().replace(/\.js$/, '').replaceAll('-', '_').toUpperCase()}_SOURCE = ${JSON.stringify(rawModuleSource)};`
      : rawModuleSource;
    if (/^\s*import\s/m.test(moduleSource))
      throw new Error(`경계 module 간 import는 안전 인라이너에서 지원하지 않습니다: ${specifier}`);
    const available = exportedNames(moduleSource);
    for (const name of names) {
      if (!available.has(name)) throw new Error(`${specifier}에 export가 없습니다: ${name}`);
    }
    const body = moduleSource
      .replace(/\bexport\s+(?=(?:async\s+)?function\b|const\b)/g, '')
      .trimEnd();
    if (/\bexport\b/.test(body)) throw new Error(`지원하지 않는 export 문법입니다: ${specifier}`);

    replacements.push({
      start: match.index,
      end: match.index + match[0].length,
      source: `const { ${names.join(', ')} } = (() => {\n${body}\nreturn { ${names.join(', ')} };\n})();`,
    });
    count++;
  }

  if (!count) return editorAppSource;
  let output = '';
  let cursor = 0;
  for (const replacement of replacements) {
    output += editorAppSource.slice(cursor, replacement.start) + replacement.source;
    cursor = replacement.end;
  }
  output += editorAppSource.slice(cursor);
  if (/^\s*import\s+(?!\()/m.test(output))
    throw new Error('인라인 결과에 정적 import가 남았습니다');
  return output;
}

export async function buildEditorApp() {
  const editorAppSource = await readFile(editorAppPath, 'utf8');
  const mainSource = await readFile(mainPath, 'utf8');
  const result = await build({
    stdin: {
      contents: mainSource,
      sourcefile: 'src/main.js',
      resolveDir: root,
      loader: 'js',
    },
    plugins: [{
      name: 'phase4-boundary-source',
      setup(context) {
        context.onResolve({ filter: /^\.\/editor-app\.js$/ }, () => ({ path: editorAppPath }));
        context.onResolve({ filter: /^\.\/(?:core|adapters|state|rendering|workers|features|ui)\// }, args => ({
          path: resolve(dirname(editorAppPath), args.path.replace(/\?source$/, '')),
          namespace: 'phase3-core',
          pluginData: { sourceImport: args.path.endsWith('?source') },
        }));
        context.onLoad({ filter: /.*/, namespace: 'phase3-core' }, async args => {
          const moduleSource = await readFile(args.path, 'utf8');
          return {
            contents: args.pluginData?.sourceImport
              ? `export const ${args.path.split(/[\\/]/).pop().replace(/\.js$/, '').replaceAll('-', '_').toUpperCase()}_SOURCE = ${JSON.stringify(moduleSource)};`
              : moduleSource,
            loader: 'js',
          };
        });
      },
    }],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    target: ['es2022'],
    charset: 'utf8',
    legalComments: 'inline',
    treeShaking: false,
    sourcemap: false,
    logLevel: 'silent',
  });
  const compiled = result.outputFiles?.[0]?.text;
  if (!compiled) throw new Error('editor-app 번들 결과가 비었습니다');
  if (!compiled.includes('pdfEditorStartupPromise') || !compiled.includes('setStartupPromise'))
    throw new Error('번들에서 부팅 계약이 사라졌습니다');
  if (!compiled.includes('PDF_EDITOR_BOOT_HTML') || !compiled.includes('captureBootHtml'))
    throw new Error('번들에서 분리 창 부팅 HTML 계약이 사라졌습니다');
  const inlined = await inlineBoundaryModules(editorAppSource);
  const runtime = inlined.replace(
    /export async function mountEditorApp\(([^)]*)\)/,
    'async function mountEditorApp($1)',
  );
  if (runtime === inlined) throw new Error('editor app mount export를 찾지 못했습니다');
  const assembly = mainSource.replace(
    /^import\s*\{\s*mountEditorApp\s*\}\s*from\s*['"]\.\/editor-app\.js['"];?[ \t]*$/m,
    '',
  ).trim();
  if (/^\s*import\s/m.test(assembly)) throw new Error('main 조립 코드에 정적 import가 남았습니다');
  return `${runtime.trimEnd()}\n\n${assembly}`;
}

export async function renderEditorHtml({ appVersion = null } = {}) {
  let template = await readFile(templatePath, 'utf8');
  if (template.split(marker).length !== 2)
    throw new Error('HTML 템플릿 marker 개수가 올바르지 않습니다');
  if (template.split(styleMarker).length !== 2)
    throw new Error('HTML 템플릿 CSS marker 개수가 올바르지 않습니다');
  if (template.split(brandLogoMarker).length !== 3)
    throw new Error('HTML 템플릿 로고 marker 개수가 올바르지 않습니다');

  const styles = (await Promise.all(stylePaths.map(path => readFile(path, 'utf8')))).join('');
  const icons = await readFile(resolve(root, 'src/assets/dayday-icons.svg'), 'utf8');
  const masks = Array.from(icons.matchAll(/<symbol id="([\w-]+)" viewBox="0 0 24 24">(.+?)<\/symbol>/g),
    ([, name, drawing]) => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' + drawing + '</svg>';
      return '.fa-' + name + ' { --dayday-icon: url("data:image/svg+xml,' + encodeURIComponent(svg) + '"); }';
    });
  if (!masks.length) throw new Error('No toolbar icons found');
  template = template.replace(styleMarker, styles.replace('/*__DAYDAY_ICON_MASKS__*/', masks.join('\n')));
  template = template.replaceAll(brandLogoMarker, (await readFile(brandLogoPath, 'utf8')).trim());
  for (const [templateMarker, path] of Object.entries(editorTemplatePaths)) {
    if (template.split(templateMarker).length !== 2)
      throw new Error(`HTML template marker 개수가 올바르지 않습니다: ${templateMarker}`);
    template = template.replace(templateMarker, await readFile(path, 'utf8'));
  }

  const localeSource = await readFile(resolve(root, 'src/i18n/desktop-i18n.js'), 'utf8');
  const localeCatalog = await readFile(resolve(root, 'src/i18n/extra-locales.js'), 'utf8');
  const localeImport = "import { EXTRA_TRANSLATIONS } from './extra-locales.js';";
  if (!localeSource.startsWith(localeImport)) throw new Error('언어 사전 import 경계를 확인하세요');
  const localeBundle = await transform(localeCatalog + '\n' + localeSource.slice(localeImport.length), {
    format: 'iife', target: 'es2022', charset: 'utf8', minify: true, logOverride: { 'duplicate-object-key': 'silent' },
  });
  template = template.replace('</head>', () => '<meta data-language-menu-style>\n<script>' + localeBundle.code.replaceAll('</script', '<\\/script') + '</script>\n</head>');
  const editorAppBundle = await buildEditorApp();
  let html = template.replace(marker, editorAppBundle);
  if (appVersion) html = html.replaceAll('__APP_VER__', appVersion);

  return html;
}

function valueOf(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1]) throw new Error(`${name} 값이 필요합니다`);
  return args[index + 1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outputArg = valueOf(args, '--output', 'windows/PdfEditor.Preview/WebApp/view.html');
  const output = isAbsolute(outputArg) ? outputArg : resolve(root, outputArg);
  const appVersion = valueOf(args, '--version');
  const html = await renderEditorHtml({
    appVersion,
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html, 'utf8');
  process.stdout.write(`편집기 생성 완료: ${output} (${(Buffer.byteLength(html) / 1024).toFixed(1)}KB)\n`);
}

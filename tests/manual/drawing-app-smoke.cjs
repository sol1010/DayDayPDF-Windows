const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const assets = {
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js': '/assets/windows-vendor/pdf-lib/1.17.1/pdf-lib.min.js',
  'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js': '/assets/windows-vendor/fontkit/1.1.1/fontkit.umd.min.js',
};
function prepare(html) {
  for (const [remote, local] of Object.entries(assets)) html = html.replaceAll(remote, local);
  return html.replaceAll('assets/', '/assets/').replaceAll('"//assets/', '"/assets/').replaceAll("'//assets/", "'/assets/")
    .replaceAll('https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@2.15.0/dist/', '/assets/windows-vendor/pdfium/2.15.0/');
}
const server = http.createServer((req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = path.resolve(root, name === '/editor/' ? 'PDF편집기.html' : '.' + name);
    if (!target.startsWith(root + path.sep)) throw Error('Invalid path');
    let body = fs.readFileSync(target);
    const ext = path.extname(target);
    if (ext === '.html') body = prepare(body.toString());
    res.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.woff2': 'font/woff2' }[ext] || 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const tmp = path.join(root, 'tmp', 'drawing-ui'); fs.mkdirSync(tmp, { recursive: true });
  try {
    for (const mode of process.env.DRAWING_UI_MODES?.split(',') || ['web', 'pc']) {
      let pcHtml = '';
      if (mode === 'pc') {
        pcHtml = path.join(tmp, 'pc-test.html');
        fs.writeFileSync(pcHtml, prepare(fs.readFileSync(path.join(root, 'windows/PdfEditor.Preview/WebApp/view.html'), 'utf8')));
      }
      const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['tests/manual/zoom-quality-smoke.cjs'], {
          cwd: root, stdio: 'inherit', windowsHide: true,
          env: { ...process.env, ZOOM_QUALITY_PDF: process.env.DRAWING_PDF,
            ZOOM_TEST_ORIGIN: origin, ZOOM_TEST_OUTPUT: path.join(tmp, mode), ZOOM_TEST_HTML: pcHtml },
        });
        child.on('error', reject); child.on('exit', resolve);
      });
      if (code) throw Error(`${mode} UI smoke failed: ${code}`);
    }
  } finally { server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {patchSource} from '../patch/apply-chat-linebreaks.mjs';
import {refreshPrecompressed} from '../patch/lib-precompressed.mjs';

// OpenClaw 2026.7 shape: renderer rule assigned directly, classic setup line.
const legacy = 'var wE=new Tw({html:!0,breaks:!0,linkify:!0}),xE=wE;'
  + 'wE.renderer.rules.html_inline=(e,t)=>{let n=e[t];return n.meta?.taskListPlugin===!0?n.content:K(n.content)};';

// OpenClaw 2026.10 shape (dist/control-ui/assets/control-ui-boot-shared-*.js):
// the rule is installed from a plugin and looks the token up from the array.
const current = 'function vc(){let e=new Fl({html:!0,breaks:!0,linkify:!0});e.use(Zs);let t=e.renderer.rules.code_inline;'
  + 'return e.enable(`strikethrough`),wC(e),rT(e),e}'
  + 'function wC(e){e.use(Ii,{isStructuralHtmlInline:e=>e.meta?.taskListPlugin===!0}),e.renderer.rules[Hi]=(e,t)=>{let n=e[t];return n?xC(n.content):``},e.renderer.rules.image=(e,t,n,r)=>{let i=e[t];return i}}';

test('2026.7 bundle keeps the original transformation', () => {
  const result = patchSource(legacy);
  assert.equal(result.changed, true);
  assert.match(result.out, /__pkLineBreak\(n\)/);
  assert.match(result.out, /__pkCjkStrong\(wE\);/);
  assert.match(result.out, /pinkie-chat-linebreaks:v2/);
  assert.equal(patchSource(result.out).reason, 'already patched');
});

test('2026.10 bundle renders a lone <br> token as a line break', () => {
  const result = patchSource(current);
  assert.equal(result.changed, true);
  assert.match(result.out, /e\.renderer\.rules\[Hi\]=\(e,t\)=>\{let n=e\[t\];return n\?__pkLineBreak\(n\)\?'<br>':n\(n\.content\):``\}/u);
  assert.match(result.out, /__pkCjkStrong\(e\);/);
  assert.equal(patchSource(result.out).reason, 'already patched');
});

test('an unknown bundle is reported instead of silently skipped', () => {
  assert.deepEqual(patchSource('var x=1;').reason, 'HTML renderer not found');
  assert.deepEqual(patchSource('wE.renderer.rules.html_inline=(e,t)=>{let n=e[t];return n.meta?.taskListPlugin===!0?n.content:K(n.content)};').reason,
    'Markdown setup not found');
});

// The helper has to survive the renderer call shape of both bundles.
test('line-break helper only rewrites standalone br tokens', () => {
  const source = patchSource(current).out;
  const start = source.indexOf('function __pkLineBreak');
  const end = source.indexOf('function __pkCjkStrong');
  const helper = source.slice(start, end);
  const __pkLineBreak = new Function(`${helper};return __pkLineBreak`)();
  assert.equal(__pkLineBreak({type: 'html_inline', content: '<br>'}), true);
  assert.equal(__pkLineBreak({type: 'html_inline', content: '<br />'}), true);
  assert.equal(__pkLineBreak({type: 'html_inline', content: '<br>text'}), false);
  assert.equal(__pkLineBreak({type: 'text', content: '<br>'}), false);
  assert.equal(__pkLineBreak(undefined), false);
});

test('precompressed twins and manifest are refreshed with the patched asset', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-uic-'));
  const assets = path.join(root, 'dist', 'control-ui', 'assets');
  fs.mkdirSync(assets, {recursive: true});
  const js = path.join(assets, 'markdown-x.js');
  fs.writeFileSync(js, 'const a=1;\n');
  fs.writeFileSync(js + '.br', zlib.brotliCompressSync(fs.readFileSync(js)));
  fs.writeFileSync(js + '.gz', zlib.gzipSync(fs.readFileSync(js)));
  const entry = (file) => ({path: path.relative(path.join(root, 'dist', 'control-ui'), file).split(path.sep).join('/'),
    sha256: 'x'.repeat(64), size: 0});
  fs.writeFileSync(path.join(root, 'dist', 'control-ui', 'asset-manifest.json'),
    JSON.stringify({version: 1, generation: 'a'.repeat(64), assets: ['', '.br', '.gz'].map((suffix) => entry(js + suffix))}));
  fs.writeFileSync(js, 'const a=2;\n');
  const report = refreshPrecompressed(js);
  assert.deepEqual(report.updated.sort(), ['markdown-x.js.br', 'markdown-x.js.gz']);
  assert.equal(report.manifest, 'updated');
  assert.equal(zlib.brotliDecompressSync(fs.readFileSync(js + '.br')).toString(), 'const a=2;\n');
  assert.equal(zlib.gunzipSync(fs.readFileSync(js + '.gz')).toString(), 'const a=2;\n');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'control-ui', 'asset-manifest.json'), 'utf8'));
  assert.notEqual(manifest.generation, 'a'.repeat(64));
  for (const asset of manifest.assets) {
    const file = path.join(root, 'dist', 'control-ui', asset.path);
    assert.equal(asset.size, fs.statSync(file).size);
  }
  assert.equal(refreshPrecompressed(js).manifest, 'unchanged');
  assert.equal(refreshPrecompressed(path.join(root, 'elsewhere.js')).modified, false);
});

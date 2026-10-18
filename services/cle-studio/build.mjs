// Build the C.le. browser bundle into dist/control-ui/<hash>/ and point the manifest at it.
import {build} from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(root, '.build');
fs.rmSync(out, {recursive: true, force: true});
await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true, format: 'esm', target: 'safari17', minify: true, legalComments: 'none',
  outfile: path.join(out, 'index.js'),
  loader: {'.svg': 'text', '.glsl': 'text', '.html': 'text'},
  external: ['/cle/static/*'],
  logLevel: 'warning',
});
const js = fs.readFileSync(path.join(out, 'index.js'));
const cssFile = path.join(out, 'index.css');
const css = fs.existsSync(cssFile) ? fs.readFileSync(cssFile) : Buffer.from('');
const hash = crypto.createHash('sha256').update(js).update(css).digest('hex').slice(0, 12);
const dist = path.join(root, 'dist/control-ui');
fs.rmSync(dist, {recursive: true, force: true});
fs.mkdirSync(path.join(dist, hash), {recursive: true});
fs.writeFileSync(path.join(dist, hash, 'index.js'), js);
fs.writeFileSync(path.join(dist, hash, 'index.css'), css);
fs.rmSync(out, {recursive: true, force: true});
const manifestPath = path.join(root, 'openclaw.plugin.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.controlUi = {entry: `dist/control-ui/${hash}/index.js`, styles: [`dist/control-ui/${hash}/index.css`]};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`cle-studio ui ${hash}  js ${(js.length / 1024).toFixed(1)} KB  css ${(css.length / 1024).toFixed(1)} KB`);

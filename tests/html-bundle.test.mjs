// tools-health-1113 D3: a finished page becomes one HTML file with its own styles, scripts and images.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {bundleHtmlFile} from '../services/mode-architecture/html-bundle.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

function site(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-bundle-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.mkdirSync(path.join(dir, 'img'));
  fs.mkdirSync(path.join(dir, 'css'));
  fs.writeFileSync(path.join(dir, 'img', 'a.png'), PNG);
  fs.writeFileSync(path.join(dir, 'img', 'bg.png'), PNG);
  fs.writeFileSync(path.join(dir, 'img', 'b 2.png'), PNG);
  fs.writeFileSync(path.join(dir, 'css', 'font.css'), '.x{background:url("../img/bg.png")}');
  fs.writeFileSync(path.join(dir, 'css', 'site.css'), '@import "font.css";\nbody{background-image:url(../img/bg.png)}');
  fs.writeFileSync(path.join(dir, 'app.js'), 'document.title = "ok"; // </script> inside');
  fs.writeFileSync(path.join(dir, 'page.html'), `<!doctype html><html><head>
<link rel="stylesheet" href="css/site.css"><link rel="icon" href="img/a.png">
<link rel="stylesheet" href="https://cdn.example.com/x.css">
<style>.y{background:url('img/a.png')}</style></head><body>
<img src="img/a.png" alt="a"><img src="img/b%202.png"><img srcset="img/a.png 1x, img/bg.png 2x">
<div style="background:url(img/bg.png)"></div>
<img src="https://example.com/remote.png"><img src="img/missing.png"><img src="data:image/png;base64,AAAA">
<script src="app.js"></script></body></html>`);
  return dir;
}

test('local styles, scripts, images, fonts and css urls are inlined; nothing local is left to fetch', t => {
  const dir = site(t);
  const out = bundleHtmlFile(path.join(dir, 'page.html'));
  const html = out.html;
  assert.ok(!/href="css\/|src="img\/[ab]|src="app\.js"|url\((?:["']?)(?:\.\.\/)?img\//.test(html), 'no local references remain');
  assert.match(html, /<style>\n\.x\{background:url\("data:image\/png;base64,/, '@import inlined with its own relative url');
  assert.ok(html.includes('document.title = "ok"; // <' + '\\/script> inside'), 'script inlined and its closing tag escaped');
  assert.match(html, /srcset="data:image\/png;base64,[^" ]+ 1x, data:image\/png;base64,[^" ]+ 2x"/);
  assert.match(html, /style="background:url\(&quot;data:image\/png;base64,/);
  assert.match(html, /<link rel="icon" href="data:image\/png;base64,/);
  assert.deepEqual(out.missing, ['img/missing.png']);
  assert.deepEqual(out.remote.sort(), ['https://cdn.example.com/x.css', 'https://example.com/remote.png']);
  assert.ok(out.inlined >= 9);
  assert.ok(html.includes('data:image/png;base64,AAAA'), 'existing data: urls untouched');
});

test('a bundle bigger than the cap is refused', t => {
  const dir = site(t);
  assert.throws(() => bundleHtmlFile(path.join(dir, 'page.html'), {maxBytes: 100}), /太大/);
});

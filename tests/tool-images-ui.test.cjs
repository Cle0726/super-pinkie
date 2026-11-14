// PLAN 2.9 读图小框的界面：5 张图显示 4 张 +「+1」（A3-5）；图片已不在 → 灰框、不发请求（A3-8）；
// 点开走 laolao-image-viewer；不挂 MutationObserver（observer 预算）；会话 key 包含 Metre。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const JS = 'ui/injections/laolao-tool-images.js';

function load() {
  const window = {addEventListener() {}, dispatchEvent() {}};
  const document = {readyState: 'loading', addEventListener() {}, querySelectorAll() { return []; }};
  vm.runInNewContext(read(JS), {window, document, location: {search: ''}, URLSearchParams, setTimeout() {}, clearTimeout() {}, setInterval() {}, CustomEvent: class {}});
  return window.__pinkieToolImages;
}

test('five images show four thumbnails and +1, named after the first', () => {
  const api = load();
  const images = [1, 2, 3, 4, 5].map((n) => ({name: `截图 ${n}.png`, url: `/pinkie-tool-image/a/${n}?key=k`, exists: true}));
  const model = api.stripModel(images);
  assert.equal(model.shown.length, 4);
  assert.equal(model.more, 1);
  assert.equal(model.name, '截图 1.png');
  assert.deepEqual(api.stripModel(images.slice(0, 2)).more, 0);
  assert.equal(api.stripModel([]).shown.length, 0);
});

test('a deleted image is a grey box: no <img>, no request', () => {
  const api = load();
  const model = api.stripModel([{name: 'gone.png', url: '/pinkie-tool-image/a/1?key=k', exists: false}]);
  assert.equal(model.shown[0].gone, true);
  const src = read(JS);
  assert.match(src, /if \(img\.gone\) \{[\s\S]*?cell\.textContent = '图片已不在';/);
  assert.match(src, /addEventListener\('error'/, 'deleted after listing: swap to the grey box too');
});

test('thumbnails open the existing image viewer and never observe the DOM', () => {
  const src = read(JS);
  assert.match(src, /window\.__laolaoImageViewer/);
  assert.doesNotMatch(src, /new MutationObserver/);
  assert.match(src, /pinkie\.toolTrace\.list/);
  assert.match(src, /pinkie:tool-trace/);
  const viewer = read('ui/injections/laolao-image-viewer.js');
  assert.match(viewer, /window\.__laolaoImageViewer = \{ open, close \};/);
  const head = read('ui/injections/laolao-head.fragment.html');
  assert.match(head, /laolao-tool-images\.js\?v=/);
  assert.match(head, /laolao-tool-images\.css\?v=/);
  const css = read('ui/injections/laolao-tool-images.css');
  assert.match(css, /width: 40px; height: 40px;/);
});

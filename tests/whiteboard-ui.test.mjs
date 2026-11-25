import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const INJ = path.join(ROOT, 'ui/injections');
const JS = fs.readFileSync(path.join(INJ, 'laolao-whiteboard.js'), 'utf8');
const CSS = fs.readFileSync(path.join(INJ, 'laolao-whiteboard.css'), 'utf8');

// 不起浏览器：给一个最小的假页面，脚本只会挂 window.Pinkie.whiteboard 和一次轮询。
function load(session) {
  const polls = [];
  const window = {Pinkie: {domWatch: {poll: (fn, ms) => polls.push(ms), every: () => ({stop() {}})}}};
  const document = {body: null, querySelector: () => null, createElement: () => ({getContext: () => null})};
  const ctx = {window, document, location: {href: 'http://127.0.0.1:18789/chat?session=' + encodeURIComponent(session)},
    URL, addEventListener() {}, setTimeout, clearTimeout, console};
  vm.runInNewContext(JS, ctx, {filename: 'laolao-whiteboard.js'});
  return {wb: window.Pinkie.whiteboard, polls, window};
}

test('前提：头片段加载、区域登记、只挂 Pinkie.whiteboard', () => {
  const head = fs.readFileSync(path.join(INJ, 'laolao-head.fragment.html'), 'utf8');
  assert.match(head, /<script defer src="\/laolao-whiteboard\.js\?v=@hash"><\/script>/);
  assert.match(head, /<link rel="stylesheet" href="\/laolao-whiteboard\.css\?v=@hash">/);
  const region = JSON.parse(fs.readFileSync(path.join(INJ, 'regions.json'), 'utf8')).regions.find(r => r.id === 'whiteboard');
  assert.deepEqual(region.files.sort(), ['laolao-whiteboard.css', 'laolao-whiteboard.js']);
  const {wb, polls, window} = load('agent:thinking:main');
  assert.equal(typeof wb.open, 'function');
  assert.equal(typeof wb.exportPng, 'function');
  assert.deepEqual(polls, [1500]);
  assert.deepEqual(Object.keys(window).sort(), ['Pinkie']);
});

test('灵感圆桌：同一份脚本按 data-host="roundtable" 走圆桌服务、只认圆桌会话、用夜色', () => {
  const attrs = {};
  const window = {Pinkie: {domWatch: {poll() {}, every: () => ({stop() {}})}}};
  const document = {body: null, currentScript: {dataset: {host: 'roundtable'}},
    documentElement: {setAttribute: (k, v) => { attrs[k] = v; }},
    querySelector: () => null, createElement: () => ({getContext: () => null})};
  vm.runInNewContext(JS, {window, document, location: {href: 'http://127.0.0.1:18891/'}, URL,
    addEventListener() {}, setTimeout, clearTimeout, console}, {filename: 'laolao-whiteboard.js'});
  const wb = window.Pinkie.whiteboard;
  assert.equal(wb.allowed('0123456789abcdef0123456789abcdef'), true);
  for (const key of ['agent:thinking:main', '0123456789ABCDEF0123456789ABCDEF', 'abc', '']) assert.equal(wb.allowed(key), false, key);
  assert.ok('data-pinkie-night' in attrs);
  const html = fs.readFileSync(path.join(ROOT, 'ui/roundtable/index.html'), 'utf8');
  assert.match(html, /<script src="\/whiteboard\.js" data-host="roundtable" defer><\/script>/);
  assert.match(html, /<script src="\/dom-watch\.js" defer><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\/whiteboard\.css">/);
  const server = fs.readFileSync(path.join(ROOT, 'services/roundtable/server.py'), 'utf8');
  for (const file of ['laolao-whiteboard.js', 'laolao-whiteboard.css', 'laolao-dom-watch.js']) assert.match(server, new RegExp("ui/injections/" + file.replace('.', '\\.')));
  // 圆桌的输入框行会把按钮去边框；入口要用两个类压过去。
  assert.match(CSS, /\.pk-whiteboard-entry\.is-inline \{[^}]*border: 1px solid var\(--wb-edge\)/);
});

test('只在想法模式开（反例：别的模式都不行）', () => {
  const {wb} = load('agent:thinking:main');
  assert.equal(wb.allowed('agent:thinking:main'), true);
  assert.equal(wb.allowed('agent:thinking:dashboard:abc'), true);
  for (const key of ['agent:main:main', 'agent:metre:main', 'agent:learning:main', 'agent:project:main', 'agent:unrestricted:main', '', 'thinking', 'xagent:thinking:main']) {
    assert.equal(wb.allowed(key), false, key);
  }
});

test('界面用碧琪自己的叫法：不出现官方产品名', () => {
  const shown = [...JS.matchAll(/'([^'\n]*[一-鿿][^'\n]*)'/g)].map(m => m[1]).join('\n') + CSS;
  assert.doesNotMatch(shown, /Claude|OpenClaw|Artifacts?|Ship|Meetings/i);
  assert.match(shown, /白板/);
  assert.match(shown, /碧琪做的/);
});

test('反例防线：不新增定时器、观察器、旧全局变量和 !important', () => {
  assert.doesNotMatch(JS, /\bsetInterval\s*\(/);
  assert.doesNotMatch(JS, /new\s+MutationObserver/);
  assert.doesNotMatch(JS, /window\.__[A-Za-z]+\s*=/);
  assert.doesNotMatch(CSS, /!important/);
  // CSS 只以自己区域的根开头（夜间前缀除外）
  const roots = CSS.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(b => b.split('{')[0].trim()).filter(sel => sel && !sel.startsWith('@'));
  for (const sel of roots) for (const part of sel.split(/,(?![^(]*\))/)) {
    const p = part.trim().replace(/^:is\(\[data-pinkie-night\], \[data-theme-mode="dark"\]\)\s*/, '');
    assert.match(p, /^\.pk-whiteboard(?:-entry)?(?:__[a-z-]+)?(?![\w-])/, p);
  }
  assert.ok(JS.split('\n').length <= 1500 && CSS.split('\n').length <= 1500);
});

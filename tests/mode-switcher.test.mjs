import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('ui/injections/laolao-mode-switcher.js', 'utf8');
const head = fs.readFileSync('ui/injections/laolao-head.fragment.html', 'utf8');
const skin = fs.readFileSync('ui/injections/laolao-metre-skin.css', 'utf8');

test('模式按钮被侧栏克隆或替换后会重新绑定菜单点击事件', () => {
  assert.match(source, /const menuBoundTriggers = new WeakSet\(\);/);
  const render = source.slice(source.indexOf('const render = () =>'), source.indexOf('document.addEventListener("pointerdown"'));
  const adopt = render.indexOf('trigger = document.querySelector(".laolao-mode-switcher")');
  const bind = render.indexOf('if (!menuBoundTriggers.has(trigger))');
  const aria = render.indexOf('trigger.setAttribute("aria-label"', bind);
  assert.ok(adopt >= 0 && bind > adopt && aria > bind, '每次 render 采用按钮后都要检查真实节点的绑定记录');
  assert.match(render.slice(bind, aria), /trigger\.addEventListener\("click", openMenu\);\s*menuBoundTriggers\.add\(trigger\);/);
  assert.equal(render.match(/trigger\.addEventListener\("click", openMenu\)/g)?.length, 1,
    '只能有一个绑定入口，否则一次点击会把菜单打开后又关掉');
});

test('模式切换脚本使用新的缓存版本，避免安装后继续执行旧监听逻辑', () => {
  assert.match(head, /\/laolao-mode-switcher\.js\?v=mode50/);
  assert.doesNotMatch(head, /\/laolao-mode-switcher\.js\?v=mode48/);
  assert.match(head, /\/laolao-metre-skin\.css\?v=metreskin19/);
  assert.doesNotMatch(head, /\/laolao-metre-skin\.css\?v=metreskin6/);
});

test('Metre 左下底栏不遮挡模式按钮的鼠标命中', () => {
  assert.match(skin, /[^{}]*\.sidebar-footer-bar\s*\{[^}]*pointer-events:\s*none !important;[^}]*\}/,
    '底栏容器必须让出命中层，否则 transparent footer 会吃掉模式按钮的点击');
  assert.match(skin, /[^{}]*\.sidebar-footer-bar :is\(button,a,\[role="button"\]\)[^{}]*\{[^}]*pointer-events:\s*auto !important;[^}]*\}/,
    '底栏里的设置、更多和连接状态要自己接收点击');
  assert.match(skin, /[^{}]*\.laolao-mode-switcher\s*\{[^}]*pointer-events:\s*auto !important;[^}]*\}/,
    '模式按钮要自己接收点击');
});

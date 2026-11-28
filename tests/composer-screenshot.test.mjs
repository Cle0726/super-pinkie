// 「以后」S 级 I5（ui2，11-25）：截图 / 拍照附图。
// 原生附件菜单已有「拍照 / 照片 / 文件」，工具箱整组照搬；原生没有「截图」，工具箱补一项：
// 浏览器屏幕选择框抓一帧 → PNG → 交给原生「照片」文件框，走原生自己的附件路径。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const TRAY = read('ui/injections/laolao-composer-tray.js');
const SHOT = read('ui/injections/laolao-composer-shot.js');
const DOMWATCH = read('ui/injections/laolao-dom-watch.js');

test('I5 截图不自己造附件：只往原生 .agent-chat__photo-input 塞文件、发 change；不碰 chatAttachments；用共用通知；用完停掉屏幕流', () => {
  const code = SHOT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /querySelector\('\.agent-chat__photo-input'\)/);
  assert.match(code, /target\.dispatchEvent\(new Event\('change', \{bubbles: true\}\)\)/);
  assert.doesNotMatch(code, /chatAttachments|onAttachmentsChange/);
  assert.match(code, /new CustomEvent\('laolao:toast'/);
  assert.match(code, /track\.stop\(\)/);
  // 不新增观察器、定时器、window 全局名，不拼 HTML；页面变化走 domWatch。
  assert.doesNotMatch(code, /new\s+MutationObserver|setInterval\s*\(|window\.__[A-Za-z]|innerHTML/);
  // 只有「等第一帧」那一个一次性定时器（监工 07:57 要的 3 秒上限），而且一定清掉。
  assert.equal((code.match(/setTimeout\s*\(/g) || []).length, 1, '只有一个一次性定时器');
  assert.match(code, /finally \{ clearTimeout\(timer\); \}/);
  assert.match(code, /const FRAME_WAIT_MS = 3000;/);
  // uireview 11-28 00:29Z：「系统设置 → 隐私与安全性 → 屏幕录制」只有 Mac 有。这条路径只许出现一次，而且只在 onMac() 为真的那一支；
  // 非 Mac（Windows / Linux）那一支照样提示「没截到图」，但不写系统设置。
  assert.match(code, /const onMac = \(\) => \/\^Mac\/i\.test\(navigator\.platform/);
  assert.equal((code.match(/系统设置/g) || []).length, 1, 'Mac 设置路径只写一处');
  assert.match(code, /notice\(onMac\(\)\s*\?\s*'没截到图：[^']*系统设置[^']*'\s*:\s*'没截到图：(?![^']*系统设置)[^']*'\)/, 'NotAllowedError：Mac 指到屏幕录制，非 Mac 不写 Mac 的设置路径');
  assert.match(SHOT, /window\.Pinkie\?\.domWatch\?\.watch\(/);
  // 监工 07:13：已有的工具箱脚本不变长；截图整块在新文件里，工具箱里没有截图代码。
  assert.doesNotMatch(TRAY, /getDisplayMedia|attach-shot/);
  assert.match(read('ui/injections/laolao-head.fragment.html'), /<script defer src="\/laolao-composer-shot\.js\?v=@hash"><\/script>/);
  const regions = JSON.parse(read('ui/injections/regions.json'));
  assert.ok((Array.isArray(regions) ? regions : regions.regions).find((r) => r.id === 'composer').files.includes('laolao-composer-shot.js'));
});

// 和原生同形状的最小输入框：外壳里有工具按钮位、原生附件菜单（三项）、照片文件框。
const page = (photoDisabled = false) => `<!doctype html><html data-laolao-mode="metre"><body>
<div class="agent-chat__composer-shell"><div class="agent-chat__input"><div class="agent-chat__composer-actions">
<details class="agent-chat__attach-menu"><summary>+</summary><div class="agent-chat__attach-menu-popover" role="menu">
<button type="button" class="agent-chat__attach-menu-option" onclick="window.__clicked.push('camera')"><svg></svg><span>拍照</span></button>
<button type="button" class="agent-chat__attach-menu-option" onclick="window.__clicked.push('photo')"><svg></svg><span>照片</span></button>
<button type="button" class="agent-chat__attach-menu-option" onclick="window.__clicked.push('file')"><svg></svg><span>文件</span></button>
</div></details></div></div>
<input type="file" accept="image/*" multiple class="agent-chat__photo-input" ${photoDisabled ? 'disabled' : ''} style="display:none"></div>
<script>window.__clicked=[];window.__toasts=[];window.__files=[];window.__streams=[];
addEventListener('laolao:toast',e=>__toasts.push(e.detail.message));
document.querySelector('.agent-chat__photo-input').addEventListener('change',e=>{for(const f of e.target.files)__files.push({name:f.name,type:f.type,size:f.size});});</script>
</body></html>`;

test('I5 真浏览器：工具箱「添加」里有拍照 / 照片 / 文件 / 截图；截图成 PNG 进原生照片框并停流；取消不提示；失败提示；不支持或停用时不出这一项', {timeout: 60_000}, async (t) => {
  const {playwright} = await import('../tools/study-desk/harness.mjs');
  let lib;
  try { lib = playwright(); } catch { t.skip('Playwright is not installed here'); return; }
  const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
  let browser;
  try { browser = await lib[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: process.env.PINKIE_UI_CHANNEL || 'msedge'} : {})}); }
  catch (error) { t.skip('no browser: ' + error.message.split('\n')[0]); return; }
  t.after(() => browser.close());

  // 假的屏幕选择：ok 给一条 320×200 的画布流；cancel 抛 AbortError（选择框被关掉）；denied 抛 NotAllowedError（Mac 没给屏幕录制权限 /
  // 系统拒绝也是它，mac1 任务 64）；broken 抛别的错；none 表示环境不支持。
  // platform：造假的 navigator.platform（MacIntel / Win32 / Linux x86_64），只在给了时才改。
  const open = async ({mode = 'ok', photoDisabled = false, platform = ''} = {}) => {
    const tab = await browser.newPage();
    await tab.setContent(page(photoDisabled));
    await tab.evaluate(([mode, platform]) => {
      if (platform) Object.defineProperty(Navigator.prototype, 'platform', {get: () => platform, configurable: true});
      if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', {value: {}, configurable: true});
      const fake = mode === 'none' ? undefined : async () => {
        if (mode === 'cancel') throw new DOMException('The user aborted a request', 'AbortError');
        if (mode === 'denied') throw new DOMException('Permission denied', 'NotAllowedError');
        if (mode === 'broken') throw new DOMException('Could not start video source', 'NotReadableError');
        // 不出帧的三种流（mac2 任务 42 第 5 条在 WebKit 上都卡住过）：0×0 画布流、空 MediaStream、只有音轨。
        if (mode === 'zero') { const c = document.createElement('canvas'); c.width = 0; c.height = 0; const s = c.captureStream(0); window.__streams.push(s); return s; }
        if (mode === 'empty') { const s = new MediaStream(); window.__streams.push(s); return s; }
        if (mode === 'audio') { const ac = new AudioContext(); const s = ac.createMediaStreamDestination().stream; window.__streams.push(s); return s; }
        // noblob：toBlob 回 null（无头 WebKit 见过），要走 toDataURL 退路。
        if (mode === 'noblob') HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); };
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
        const g = canvas.getContext('2d'); g.fillStyle = '#2f4bb0'; g.fillRect(0, 0, 320, 200);
        const stream = canvas.captureStream(5);
        const tick = () => { g.fillRect(0, 0, 1, 1); if (stream.active) requestAnimationFrame(tick); }; tick();
        window.__streams.push(stream);
        return stream;
      };
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {value: fake, configurable: true});
    }, [mode, platform]);
    await tab.addScriptTag({content: DOMWATCH});
    await tab.addScriptTag({content: TRAY});
    await tab.addScriptTag({content: SHOT});
    await tab.click('.pinkie-tray-btn');
    // 截图那格由新文件在下一轮页面变化（domWatch，一帧）里补上，等它落定。
    await tab.waitForTimeout(250);
    return tab;
  };
  const names = (tab) => tab.$$eval('.pinkie-tray__tiles .pinkie-tray__name', (list) => list.map((n) => n.textContent));
  const shot = (tab) => tab.click('.pinkie-tray__row[data-key="attach-shot"] .pinkie-tray__item');

  {
    const tab = await open();
    assert.deepEqual(await names(tab), ['拍照', '照片', '文件', '截图'], '原生三项照搬，截图排最后');
    await shot(tab);
    await tab.waitForFunction(() => window.__files.length > 0, null, {timeout: 10_000});
    const got = await tab.evaluate(() => ({files: window.__files, toasts: window.__toasts, live: window.__streams.flatMap((s) => s.getTracks()).filter((x) => x.readyState === 'live').length, menu: Boolean(document.querySelector('.pinkie-tray'))}));
    assert.equal(got.files.length, 1);
    assert.equal(got.files[0].type, 'image/png');
    assert.match(got.files[0].name, /^截图 \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/);
    assert.ok(got.files[0].size > 100, 'PNG 有内容');
    assert.equal(got.live, 0, '抓完一帧就停掉屏幕流（系统的「正在共享」提示随之消失）');
    assert.deepEqual(got.toasts, []);
    assert.equal(got.menu, false, '点了就关菜单');
    // 原生三项照旧转给原按钮。
    await tab.click('.pinkie-tray-btn');
    await tab.click('.pinkie-tray__row[data-key="attach-0"] .pinkie-tray__item');
    assert.deepEqual(await tab.evaluate(() => window.__clicked), ['camera']);
    await tab.close();
  }
  {
    const tab = await open({mode: 'cancel'});
    await shot(tab);
    await tab.waitForTimeout(400);
    assert.deepEqual(await tab.evaluate(() => [window.__files.length, window.__toasts]), [0, []], '取消（AbortError）：不附图、不提示');
    await tab.close();
  }
  for (const platform of ['MacIntel', 'Win32', 'Linux x86_64']) {
    // mac1 任务 64：NotAllowedError（没给屏幕录制权限 / 系统拒绝）不能静默，要说一句，且不附图。
    // uireview 11-28 00:29Z：「系统设置 → 隐私与安全性 → 屏幕录制」只有 Mac 有，Windows / Linux 上不能写这条路径。
    const tab = await open({mode: 'denied', platform});
    await shot(tab);
    await tab.waitForFunction(() => window.__toasts.length > 0, null, {timeout: 5_000});
    const got = await tab.evaluate(() => ({toasts: window.__toasts, files: window.__files.length}));
    t.diagnostic(`denied ${platform}：` + JSON.stringify(got));
    assert.equal(got.toasts.length, 1, `${platform}：只说一句`);
    assert.match(got.toasts[0], /^没截到图：/, `${platform}：NotAllowedError 要提示`);
    if (platform === 'MacIntel') assert.match(got.toasts[0], /屏幕录制/, 'Mac：提示指到屏幕录制权限');
    else assert.doesNotMatch(got.toasts[0], /系统设置|隐私与安全性|屏幕录制/, `${platform}：不写 Mac 才有的设置路径`);
    assert.equal(got.files, 0, `${platform}：NotAllowedError 不附图`);
    await tab.close();
  }
  {
    const tab = await open({mode: 'broken'});
    await shot(tab);
    await tab.waitForFunction(() => window.__toasts.length > 0, null, {timeout: 5_000});
    assert.match((await tab.evaluate(() => window.__toasts))[0], /^没截到图/);
    assert.equal(await tab.evaluate(() => window.__files.length), 0);
    await tab.close();
  }
  for (const mode of ['zero', 'empty', 'audio']) {
    // 监工 07:57 / 08:36（mac2 任务 42 第 5 条）：流不出画面时，3 秒上限内停掉共享、说一句「没截到」，不附图。
    const tab = await open({mode});
    const t0 = Date.now();
    await shot(tab);
    await tab.waitForFunction(() => window.__toasts.length > 0, null, {timeout: 6_000});
    const took = Date.now() - t0;
    const got = await tab.evaluate(() => ({toast: window.__toasts[0], files: window.__files.length, live: window.__streams.flatMap((s) => s.getTracks()).filter((x) => x.readyState === 'live').length}));
    t.diagnostic(`${mode}：${took}ms 后提示「${got.toast}」`);
    assert.match(got.toast, /^没截到图/, `${mode}：提示没截到`);
    assert.equal(got.files, 0, `${mode}：不附图`);
    assert.equal(got.live, 0, `${mode}：屏幕共享已停`);
    assert.ok(took < 5_000, `${mode}：3 秒上限内停（实际 ${took}ms）`);
    await tab.close();
  }
  {
    // toBlob 回 null：走 toDataURL 退路，照样把一张 PNG 交给照片框。
    const tab = await open({mode: 'noblob'});
    await shot(tab);
    await tab.waitForFunction(() => window.__files.length > 0 || window.__toasts.length > 0, null, {timeout: 10_000});
    const got = await tab.evaluate(() => ({files: window.__files, toasts: window.__toasts}));
    assert.deepEqual(got.toasts, [], 'toBlob 回空不算失败');
    assert.equal(got.files.length, 1);
    assert.equal(got.files[0].type, 'image/png');
    assert.ok(got.files[0].size > 100, '退路解出的 PNG 有内容');
    await tab.close();
  }
  for (const opts of [{mode: 'none'}, {photoDisabled: true}]) {
    const tab = await open(opts);
    assert.deepEqual(await names(tab), ['拍照', '照片', '文件'], JSON.stringify(opts) + '：不出截图');
    await tab.close();
  }
});

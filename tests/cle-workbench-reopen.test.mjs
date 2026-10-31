// 工作台重入口的命中测试（主控 P1 回归闸门）。
//
// 实测背景：19789 1280×720 双栏、右栏 508px、输入约 220 字后，`.pk-wb-reopen` 是
// position:fixed + bottom:160px 的悬浮胶囊，rect x1184.5..1266 y532..560，
// 正好盖住 send(x1235..1271 y517.8..551.8) 与 voice(x1197..1231) 的中心。
//
// 这里用真实样式引擎 + 真实模块，在复刻的双栏/多行输入场景下按中心点做
// elementFromPoint，断言命中的是按钮本身；并对双栏收窄、极窄、单栏、继续长高逐一覆盖。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const studio = path.join(here, '..', 'services/cle-studio');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const available = fs.existsSync(CHROME) && process.env.CLE_SKIP_BROWSER !== '1';

test('工作台入口不再压住语音/发送：真实几何 + 命中测试', {skip: !available && 'no Chrome on this host'}, async () => {
  // 与其它浏览器测试并发时不能抢同一个 CDP 端口，否则第二个 Chrome 会起不来
  const cdp = 9400 + Math.floor(Math.random() * 300);
  const port = 18900 + Math.floor(Math.random() * 80);
  const server = spawn(process.execPath, [path.join(studio, '.harness/serve-fusion.mjs')], {
    env: {...process.env, FUSION_HARNESS_PORT: String(port)}, stdio: 'ignore',
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    let up = false;
    for (let i = 0; i < 25 && !up; i++) {
      await wait(200);
      up = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok).catch(() => false);
    }
    assert.ok(up, 'harness 服务应已启动');

    const run = spawn(process.execPath, [path.join(studio, '.harness/audit-run.mjs')], {
      env: {
        ...process.env,
        CLE_AUDIT_BASE: `http://127.0.0.1:${port}`,
        CLE_AUDIT_PAGE: '/chat/wb-hit',
        CLE_AUDIT_CDP: String(cdp),
        CLE_AUDIT_W: '1280',
        CLE_AUDIT_H: '720',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    run.stdout.on('data', (d) => { out += d; });
    run.stderr.on('data', (d) => { out += d; });
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => { run.kill('SIGKILL'); resolve(-1); }, 90000);
      run.on('exit', (c) => { clearTimeout(timer); resolve(c); });
    });
    assert.equal(code, 0, `命中场景应正常结束\n${out}`);
    assert.match(out, /AUDIT_DONE/);

    // 入口必须真的在 composer 里，而不是 fixed 浮层
    assert.match(out, /REOPEN parent=agent-chat__composer-controls/, '应插进输入区的 controls 行');
    assert.match(out, /REOPEN inComposer=true/);
    assert.match(out, /REOPEN position=static|position=static/);

    // 主控判据：点发送/语音的中心，命中的必须是它们自己
    assert.match(out, /HIT send centre=\d+,\d+ -> chat-send-btn ok=true/);
    assert.match(out, /HIT voice centre=\d+,\d+ -> chat-voice-btn ok=true/);

    // 不与任何核心控件重叠
    for (const name of ['send', 'voice', 'textarea']) {
      assert.match(out, new RegExp(`OVERLAP reopen-vs-${name} no`), `不应与 ${name} 重叠`);
    }

    // 双栏收窄 / 极窄 / 单栏：仍然命中原按钮
    assert.match(out, /NARROW HIT send -> chat-send-btn ok=true/);
    assert.match(out, /TIGHT reopen .* insidePane=true hitSend=true/);
    assert.match(out, /TIGHT overlapsText false/);
    assert.match(out, /SINGLE HIT send -> chat-send-btn ok=true/);

    // 继续长高后仍然不遮发送
    assert.match(out, /GROWN textareaH=\d+ hitSend=true overlapSend=false parent=agent-chat__composer-controls/);
  } finally {
    server.kill('SIGKILL');
  }
});

test('样式契约：重入口没有 fixed+bottom 硬偏移，也不再用玻璃/粉渐变', () => {
  const css = fs.readFileSync(path.join(studio, 'static/legacy/laolao-workbench.css'), 'utf8');
  const block = css.slice(css.indexOf('.pk-wb-reopen {'), css.indexOf('.pk-wb-reopen[hidden]'));
  assert.match(block, /position:\s*static/, '默认必须是文档流内的 chrome 元素');
  assert.doesNotMatch(block, /bottom:\s*\d+px/, '不能在组件本体里写死 bottom');
  // 允许显式关闭（none），不允许真的启用玻璃
  assert.doesNotMatch(block, /backdrop-filter:\s*blur/, '不要玻璃层');
  assert.match(block, /var\(--cle-line-strong|var\(--cle-gaze/);

  // 兜底分支仍然存在（脚本拿不到 composer 时），而且避让量来自变量而不是魔法数字
  assert.match(css, /body > \.pk-wb-reopen:not\(\.is-in-composer\)[\s\S]{0,220}bottom: var\(--pk-wb-fallback-bottom/);
  // 旧的 bottom:160px 绝对定位必须消失
  assert.doesNotMatch(css, /bottom:\s*160px/);
});

test('脚本逐 pane 选择插入点，不写死第一个 pane', () => {
  const js = fs.readFileSync(path.join(studio, 'static/legacy/laolao-workbench.js'), 'utf8');
  assert.match(js, /const activePane = \(\) =>[\s\S]{0,220}chat-pane-cache__pane--active/);
  const place = js.slice(js.indexOf('function placeReopen()'), js.indexOf('function placeReopen()') + 1400);
  assert.match(place, /agent-chat__composer-controls/, '优先放进 controls 行');
  assert.match(place, /agent-chat__composer-footer/, '其次 footer');
  assert.match(place, /chat-pane__actions|chat-pane__header/, '再次 pane header');
  assert.match(place, /is-in-composer/);
  // 只检查真正的代码行（去掉注释与 style.removeProperty 的清理调用）
  const code = place.split('\n').filter((line) => !/^\s*(\/\/|\*)/.test(line)).join('\n');
  assert.doesNotMatch(code, /(left|right|bottom|top)\s*[:=]\s*['"`][^'"`]*px/, '放置逻辑不再自行算固定偏移');
});

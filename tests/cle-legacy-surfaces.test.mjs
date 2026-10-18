// 已移植模块的表面验收（本轮返修的主体闸门）。
//
// 判定方式严格按主控要求：在真实样式引擎里给元素赋值、让浏览器解析 var()，
// 再读回 computed style；不用 CSS.supports 判含 var 的字符串来"证明"有效。
//   1) token 类型：--cle-shadow* 是整组阴影，作为整条 box-shadow 有效；
//      塞进颜色槽后 computed 必须是 none（这就是"无效声明"的可测特征）。
//   2) 每个可点入口/打开面板：深浅主题的文字对比 >= 4.5，焦点环是实色。
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

function run(port, cdp) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(studio, '.harness/audit-run.mjs')], {
      env: {
        ...process.env,
        CLE_AUDIT_BASE: `http://127.0.0.1:${port}`,
        CLE_AUDIT_PAGE: '/surface-audit.html',
        CLE_AUDIT_CDP: String(cdp),
        CLE_AUDIT_W: '1280',
        CLE_AUDIT_H: '900',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { p.kill('SIGKILL'); resolve({code: -1, out}); }, 120000);
    p.on('exit', (code) => { clearTimeout(timer); resolve({code, out}); });
  });
}

test('表面验收：token 类型正确，所有文字对比 >= 4.5，焦点环为实色', {skip: !available && 'no Chrome on this host'}, async () => {
  const port = 19080 + Math.floor(Math.random() * 40);
  const cdp = 9600 + Math.floor(Math.random() * 300);
  const server = spawn(process.execPath, [path.join(studio, '.harness/serve-fusion.mjs')], {
    env: {...process.env, FUSION_HARNESS_PORT: String(port)}, stdio: 'ignore',
  });
  try {
    let up = false;
    for (let i = 0; i < 25 && !up; i++) {
      await new Promise((r) => setTimeout(r, 200));
      up = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok).catch(() => false);
    }
    assert.ok(up, 'harness 服务应已启动');

    const {code, out} = await run(port, cdp);
    assert.equal(code, 0, `验收页应正常结束\n${out}`);
    assert.match(out, /AUDIT_DONE/);

    // 1) token 类型：整组阴影整条使用有效；塞进颜色槽必须失效
    assert.match(out, /SHADOW --cle-shadow valid=yes/, '--cle-shadow 作为整条 box-shadow 应有效');
    assert.match(out, /SHADOW --cle-shadow-as-colour valid=no/, '整组阴影塞进颜色槽必须被判为无效');
    assert.match(out, /SHADOW --cle-shadow-pop valid=yes/);
    assert.match(out, /SHADOW --cle-shadow-pop-as-colour valid=no/);
    assert.match(out, /SHADOW combined valid=yes/, '描边色 + 整组阴影的叠加仍应有效');

    // 2) 所有量到的对比度都要 >= 4.5
    const lines = out.split('\n').filter((l) => /contrast=\d/.test(l));
    assert.ok(lines.length >= 55, `应量到足够多的文字行，实际 ${lines.length}`);
    const bad = lines.map((l) => ({l, v: Number(l.split('contrast=')[1])})).filter((x) => !(x.v >= 4.5));
    assert.deepEqual(bad.map((x) => x.l), [], '低于 4.5:1 的行');

    // 3) 焦点环必须是实色（软色 8% 不透明不能当描边）
    assert.match(out, /ASK focus-ring valid=yes resolved=rgb\(\d+, \d+, \d+\) solid 2px/);
    assert.match(out, /CARD switch .*focusRing=valid/);
    assert.match(out, /CARD input focus-ring valid=yes/);
    assert.match(out, /NIGHT focus-ring valid=yes resolved=rgb\(\d+, \d+, \d+\) solid 2px/);

    // 4) 采样必须建立在"已稳定"上，而不是睡够墙钟时间。
    //    这条断言的意义：如果哪天有人把 settle 改回固定 sleep，负载下会先出现
    //    SETTLE FAILED 或 1.0x 的对比度，这条会先炸，而不是偶发漂移。
    assert.doesNotMatch(out, /SETTLE FAILED/, '主题切换后未在预算内稳定（不能靠加长 sleep 掩盖）');

    // 5) 运行时注入样式的模块（样式写在 JS 里）：深浅两套都要真的量到，且不含低对比行
    assert.match(out, /^MODULE LIGHT DS pop injected=yes/m);
    assert.match(out, /^MODULE LIGHT THINK menu injected=yes/m);
    assert.match(out, /^MODULE NIGHT DS pop injected=yes/m);
    assert.match(out, /^MODULE NIGHT THINK menu injected=yes/m);
    assert.doesNotMatch(out, /^MODULE .* LOW /m, '模块内部不应有低于 4.5:1 的文字');
    assert.match(out, /^MODULE LIGHT THINK menu ring=yes/m);
    assert.match(out, /^MODULE NIGHT THINK menu ring=yes/m);

    // 6) 深浅两套都必须真的被量到
    assert.match(out, /^NIGHT ASK surface/m);
    assert.match(out, /^NIGHT MEM primary/m);
    assert.match(out, /^NIGHT USAGE cost/m);
  } finally {
    server.kill('SIGKILL');
  }
});

test('样式源文件里不再有"整组阴影进颜色槽"的写法', () => {
  const files = [
    'static/legacy/capabilities.css',
    'static/legacy/laolao-ask-user.css',
    'static/legacy/laolao-memory.css',
    'static/legacy/laolao-usage-stats.css',
    'static/legacy/laolao-settings-user.css',
    'static/legacy/laolao-workbench.css',
    'static/legacy/laolao-workbench-notebook.css',
    'src/styles/bridge.css',
    'src/styles/tiers.css',
  ];
  const offenders = [];
  for (const f of files) {
    const css = fs.readFileSync(path.join(studio, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [i, line] of css.split('\n').entries()) {
      if (!/var\(--cle-shadow(-pop)?\)/.test(line)) continue;
      // 合法用法只有两种：
      //   a) box-shadow: var(--cle-shadow[ -pop]) [!important]
      //   b) 作为变量别名（--pk-shadow / --wb-card-shadow 之类）
      const trimmed = line.trim();
      if (/^box-shadow:\s*var\(--cle-shadow(-pop)?\)\s*(!important)?;?\s*$/.test(trimmed)) continue;
      if (/^--[a-z0-9-]+:\s*var\(--cle-shadow(-pop)?\)\s*;?\s*$/.test(trimmed)) continue;
      // 一行里可能有多条声明：逐条判断
      const decls = trimmed.split(';').map((d) => d.trim()).filter(Boolean);
      const bad = decls.filter((d) => /var\(--cle-shadow(-pop)?\)/.test(d) && !/^box-shadow:\s*var\(--cle-shadow(-pop)?\)\s*(!important)?$/.test(d));
      if (bad.length) offenders.push(`${f}:${i + 1} ${bad.join(' | ').slice(0, 90)}`);
    }
  }
  assert.deepEqual(offenders, [], '这些声明会把整条 box-shadow 变成 none');
});

test('依赖 emoji 的控件文字已换成线性图标或纯文字', () => {
  const caps = fs.readFileSync(path.join(studio, 'static/legacy/laolao-capabilities.js'), 'utf8');
  assert.doesNotMatch(caps, /'⏰'/, '定时任务卡片不再用 emoji 当图标');
  assert.doesNotMatch(caps, /'🔌'/, '连接器卡片不再用 emoji 当图标');
  const ask = fs.readFileSync(path.join(studio, 'static/legacy/laolao-ask-user.css'), 'utf8');
  assert.doesNotMatch(ask, /backdrop-filter:\s*blur/, '提问卡不再用玻璃层');
});

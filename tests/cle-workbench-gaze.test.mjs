// 工作台的品牌色规则：gaze 是唯一强调色，只给"此刻正在被看/正在发生"的一处用。
// 它不能当通用图标色，更不能当实心底 —— 主控在 19789 实拍看到的是：文件页签实心浅蓝底、
// 五个操作图标全蓝、未打开/营造模式浅蓝胶囊、欢迎区一团模糊蓝光斑。
//
// 这里做两层验证：
//   1. 静态：工作台样式里不再把 accent/cle 指向会铺开的地方，光斑伪元素已删除；
//   2. 真实：用无头 Chrome 读 computed style，确认上述元素既不是 gaze 底、也不是 gaze 字。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const studio = path.join(here, '..', 'services/cle-studio');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browserAvailable = fs.existsSync(CHROME) && process.env.CLE_SKIP_BROWSER !== '1';

test('工作台不再把 gaze 当通用图标色或实心底', () => {
  const css = fs.readFileSync(path.join(studio, 'static/legacy/laolao-workbench.css'), 'utf8');
  const bridge = fs.readFileSync(path.join(studio, 'src/styles/bridge.css'), 'utf8');

  // --wb-accent / --wb-cle 不得指向 gaze（否则活动栏、胶囊、图标会整片变蓝）
  const scope = bridge.slice(bridge.indexOf('html[data-cle] .pk-wb {'), bridge.indexOf('}', bridge.indexOf('html[data-cle] .pk-wb {')));
  assert.doesNotMatch(scope, /--wb-accent:\s*var\(--cle-gaze\)/, '--wb-accent 不得指向 gaze');
  assert.doesNotMatch(scope, /--wb-cle:\s*var\(--cle-gaze\)/, '--wb-cle 不得指向 gaze');
  // 唯一强调留给细线
  assert.match(scope, /--wb-sig:\s*var\(--cle-gaze\)/, '--wb-sig 应保留 gaze');

  // 欢迎区那团模糊光斑必须删干净，且不许换成别的装饰
  const welcome = css.slice(css.indexOf('.pk-wb-welcome__mark::before'));
  const rule = welcome.slice(0, welcome.indexOf('}') + 1);
  assert.match(rule, /content:\s*none/, '欢迎区伪元素应被移除');
  assert.doesNotMatch(rule, /radial-gradient|blur\(/, '不要用另一个装饰替代光斑');

  // 选中页签/活动栏不能是 gaze 实底
  assert.doesNotMatch(css, /\.pk-wb-act\.is-active\s*\{[^}]*--wb-accent/, '活动栏选中不应是 accent 实底');
});

test('真实计算样式：日/夜两套下 gaze 不出现在图标、胶囊、光斑上', {skip: !browserAvailable && 'no Chrome on this host'}, async () => {
  const port = 19240 + Math.floor(Math.random() * 40);
  const cdp = 9800 + Math.floor(Math.random() * 200);
  const server = spawn(process.execPath, [path.join(studio, '.harness/serve-fusion.mjs')], {
    env: {...process.env, FUSION_HARNESS_PORT: String(port)}, stdio: 'ignore',
  });
  try {
    let up = false;
    for (let i = 0; i < 25 && !up; i++) {
      await new Promise((r) => setTimeout(r, 200));
      up = await fetch(`http://127.0.0.1:${port}/wb-gaze.html`).then((r) => r.ok).catch(() => false);
    }
    assert.ok(up, 'harness 应启动');

    const out = await new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(studio, '.harness/audit-run.mjs')], {
        env: {...process.env,
          CLE_AUDIT_BASE: `http://127.0.0.1:${port}`,
          CLE_AUDIT_PAGE: '/wb-gaze.html',
          CLE_AUDIT_CDP: String(cdp),
          CLE_AUDIT_W: '1440', CLE_AUDIT_H: '900'},
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let buf = '';
      p.stdout.on('data', (d) => { buf += d; });
      p.stderr.on('data', (d) => { buf += d; });
      const t = setTimeout(() => { p.kill('SIGKILL'); resolve({code: -1, buf}); }, 120000);
      p.on('exit', (code) => { clearTimeout(t); resolve({code, buf}); });
    });

    assert.equal(out.code, 0, `验收页应正常结束\n${out.buf}`);
    assert.match(out.buf, /AUDIT_DONE/);

    // 日/夜两段都必须量到
    for (const tag of ['LIGHT', 'DARK']) {
      assert.match(out.buf, new RegExp(`== ${tag} ==`), `${tag} 应被测量`);
    }
    // 任何被点名的元素都不许 << BG=GAZE / FG=GAZE
    const flagged = out.buf.split('\n').filter((l) => /<< .*(BG=GAZE|FG=GAZE)/.test(l));
    assert.deepEqual(flagged, [], '这些元素仍在用 gaze 当底色或字色');
    // 光斑不许以渐变形式回来
    assert.doesNotMatch(out.buf, /欢迎区光斑.*BEFORE=GRADIENT/, '欢迎区不应再有渐变装饰');

    // 名字槽至少 8 个汉字宽（em 比通常 ≥ 8）
    const ems = [...out.buf.matchAll(/名字槽 width=[\d.]+px\s+fontSize=[\d.]+px\s+≈([\d.]+)em/g)].map((m) => Number(m[1]));
    assert.equal(ems.length, 2, '日夜两段都应报出名字槽宽度');
    for (const em of ems) assert.ok(em >= 8, `名字槽应至少 8em，实际 ${em}em`);

    // 底栏按钮不能有实底方块
    const btnBgs = [...out.buf.matchAll(/按钮 (b-space|b-demo|b-wand): bg=([^)\n]*\)?)/g)];
    assert.ok(btnBgs.length >= 6, '按钮底色应被测量');
    for (const m of btnBgs) {
      assert.match(m[2].trim(), /^rgba\(0, 0, 0, 0\)$/, `按钮 ${m[1]} 不应有实底`);
    }
  } finally {
    server.kill('SIGKILL');
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function loadSplashFx({reduced = false, webgl = true, setting = null} = {}) {
  const context = {
    module: {exports: {}},
    matchMedia: () => ({matches: reduced}),
    localStorage: {getItem: (key) => (key === 'laolao:splash-fx' ? setting : null)},
    document: {
      createElement: () => ({getContext: () => (webgl ? {getExtension: () => ({loseContext() {}})} : null)}),
    },
  };
  context.window = context;
  vm.runInNewContext(read('ui/injections/laolao-splash-fx.js'), context, {filename: 'laolao-splash-fx.js'});
  return context.module.exports;
}

test('splash FX ships every asset it loads and declines when it cannot animate', () => {
  const fx = loadSplashFx();
  assert.equal(fx.supported(), true);
  for (const url of Object.values(fx.assetUrls())) {
    const relative = url.split('?', 1)[0].replace(/^\//, '');
    assert.ok(fs.existsSync(path.join(root, 'ui', 'assets', relative)), relative);
  }
  // 首帧 CSS 和动效读同一张原图，不会因为查询参数不同而重复下载。
  assert.equal(fx.assetUrls().image, '/laolao-splash.png');
  assert.equal(loadSplashFx({reduced: true}).supported(), false, 'reduced motion');
  assert.equal(loadSplashFx({webgl: false}).supported(), false, 'no WebGL');
  assert.equal(loadSplashFx({setting: 'off'}).supported(), false, 'user switch');
  assert.equal(fx.play({}), null, 'no host');
});

test('the exit charges toward the camera and bursts a hole instead of sliding sideways', () => {
  const source = read('ui/injections/laolao-splash-fx.js');
  // 往旁边滑会露出碧琪身后补出来的背景；冲刺只绕脸放大，圆洞在冲到镜头前之后才开。
  assert.doesNotMatch(source, /pose\.tx|tx: -/);
  assert.match(source, /uniform float[^;]*uCharge/);
  assert.match(source, /holeK: clamp\(\(t - exitAt - IMPACT\) \/ HOLE\)/);
  const {timings} = loadSplashFx()._test;
  assert.ok(timings.IMPACT < timings.CHARGE, 'the hole opens while she is still lunging');
  // 被隐藏的窗口动画时钟会停：结束有兜底计时，隐藏时立即收尾。
  assert.match(source, /if \(root\.document\.hidden\) cleanup\(\)/);
  assert.match(source, /fallbackTimer = root\.setTimeout\(\(\) => cleanup\(\)/);
  // 失败退回静态开屏时要把加上去的节点和类名都撤掉。
  assert.match(source, /ready\.catch\(\(\) => cleanup\(\{restore: true\}\)\)/);
});

test('first paint stays CSS-only: blurred art that focuses by itself and letters split before paint', () => {
  const css = read('ui/injections/laolao-splash.css');
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.laolao-splash:not\(\.is-mode-progress\)::after \{[\s\S]*?filter: blur\(18px\)[\s\S]*?animation: laolao-splash-focus 900ms[^;]*700ms both/);
  assert.match(css, /\.laolao-splash\.laolao-splash--fx \{ background: transparent; \}/);
  assert.match(css, /\.laolao-splash--fx \.laolao-splash__progress-fill \{[\s\S]*?transform: none !important/);
  assert.doesNotMatch(css, /is-art-ready/);

  const bootstrap = read('ui/injections/laolao-handoff-bootstrap.js');
  assert.match(bootstrap, /prefers-reduced-motion: reduce/);
  assert.match(bootstrap, /letter\.style\.setProperty\("--i", String\(index\)\)/);
  assert.match(bootstrap, /title\.removeAttribute\("aria-label"\);\s*title\.textContent = details\.label;/);
  // 拆字的脚本是同步脚本，跟在开屏标记后面，所以首帧就已经拆好。
  assert.match(read('ui/injections/laolao-body.fragment.html'), /<\/section>\s*<script src="\.\/laolao-handoff-bootstrap\.js\?v=handoff7"><\/script>/);
});

test('splash.js hands the cold start to the FX only after first paint and keeps every gate', () => {
  const splash = read('ui/injections/laolao-splash.js');
  assert.match(splash, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*?requestIdleCallback\(startFx, \{timeout: 400\}\)/);
  assert.match(splash, /if \(completed \|\| splashFx \|\| switching\) return;/);
  assert.match(splash, /onImpact: \(\) => \{ fxEntered = true; motion\.enter\(\); \}/);
  assert.match(splash, /if \(splashFx\?\.active\) \{/);
  for (const gate of [/elapsed >= 6500/, /loginReady\(now\) && elapsed >= 5000/, /\}, 30000\);/, /const minimum = motion\.reduced\(\) \? 400 : switching \? 700 : 2600/]) {
    assert.match(splash, gate);
  }
});

test('both installers load the splash FX once, before the startup controller', () => {
  const mac = read('installer/macos/apply-theme.sh');
  const windows = read('installer/windows/apply-theme.ps1');
  assert.match(mac, /^\s+laolao-splash-fx\.js \\$/m);
  assert.ok(mac.indexOf('laolao-splash-fx.js?v=splashfx2"></script>\\n</head>') < mac.indexOf('laolao-splash.js?v=splash28"></script>\\n</head>'));
  assert.match(mac, /laolao-splash-fx\\\.js\(\?:\\\?\[\^" \]\*\)\?"\[\^>\]\*><\/script>/);
  assert.ok(windows.includes('"laolao-splash-fx.js",'));
  assert.ok(windows.indexOf("'<script defer src=\"./laolao-splash-fx.js?v=splashfx2\"></script>'") < windows.indexOf("'<script defer src=\"./laolao-splash.js?v=splash28\"></script>'"));
  assert.match(windows, /'laolao-splash-fx\.js' = 'splashfx2'/);
});

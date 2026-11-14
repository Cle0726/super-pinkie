// 批 4 · Metre 皮肤、像素黑猫、空状态引导语（PLAN 2.10、2.11、6.1、6.3；ACCEPTANCE A4-*）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const INJ = 'ui/injections/';

function sandbox(extra = {}) {
  const listeners = {};
  const timers = [];
  const attrs = {'data-laolao-mode': 'metre'};
  const documentElement = {
    getAttribute: (name) => attrs[name] ?? null, hasAttribute: (name) => name in attrs,
    setAttribute: (name, value) => { attrs[name] = String(value); }, dataset: {},
  };
  const store = new Map();
  const window = {
    addEventListener: (name, fn) => (listeners[name] ??= []).push(fn), dispatchEvent() {},
    matchMedia: () => ({matches: false}), innerHeight: 800,
  };
  const document = {
    documentElement, hidden: false, readyState: 'complete',
    addEventListener: (name, fn) => (listeners['doc:' + name] ??= []).push(fn),
    querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}),
  };
  const ctx = {
    window, document, console, Date, Math, JSON, Map, Set, Promise, URL, Event: class {}, CustomEvent: class {},
    localStorage: {getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k)},
    location: {href: 'http://x/chat?session=agent:metre:main'},
    setTimeout: (fn, ms) => { timers.push({fn, ms}); return timers.length; }, clearTimeout() {},
    setInterval: () => 0, requestAnimationFrame: () => 0, ...extra,
  };
  window.localStorage = ctx.localStorage;
  ctx.globalThis = ctx;
  return {ctx, window, document, attrs, timers, listeners, store};
}
function load(files, env = sandbox()) {
  vm.createContext(env.ctx);
  for (const file of files) vm.runInContext(read(INJ + file), env.ctx, {filename: file});
  return env;
}

// ---------- A4-4 黑猫是用户点头的那一版 ----------
test('A4-4: the shipped frames are byte-identical to the approved preview file; the menu head is drawn from them', () => {
  const shipped = fs.readFileSync(path.join(ROOT, INJ, 'laolao-metre-cat-frames.js'));
  const approved = fs.readFileSync(path.join(ROOT, 'briefs/metre-mode-1113/ref/metre-cat.js'));
  assert.ok(shipped.equals(approved), 'laolao-metre-cat-frames.js 必须和 ref/metre-cat.js 逐字节相同');
  const cat = require(path.join(ROOT, INJ, 'laolao-metre-cat-frames.js'));
  assert.equal(Object.keys(cat.STATES).length, 16);
  const svg = read('ui/assets/laolao-mode-metre.svg');
  const pixels = cat.HEAD.join('').replace(/\./g, '').length;
  assert.equal((svg.match(/<rect /g) || []).length, pixels, '菜单猫头的每个像素都来自 HEAD');
  for (const color of new Set(cat.HEAD.join('').replace(/\./g, ''))) assert.ok(svg.includes(cat.PALETTE[color]));
  const head = read(INJ + 'laolao-head.fragment.html');
  assert.ok(head.indexOf('laolao-metre-cat-frames.js') < head.indexOf('laolao-metre-cat.js?'), '帧数据先于控制器加载');
  for (const file of ['laolao-mode-switcher.js', 'laolao-classic-shell.js', 'laolao-splash.js']) {
    assert.match(read(INJ + file), /laolao-mode-metre\.svg\?v=cathead1/, file);
  }
});

// ---------- A4-5 16 个状态都能被对应的事件触发 ----------
test('A4-5: every one of the 16 states is reached by its event', () => {
  const env = load(['laolao-metre-cat-frames.js', 'laolao-metre-cat.js']);
  const {stateFor, SLEEP_AFTER_MS} = env.window.__pinkieMetreCat;
  const now = 10_000_000;
  const work = (tool, toolName = '') => ({kind: 'plain', live: {active: true, state: 'working', tool, toolName}});
  const cases = {
    idle: [{kind: 'idle', live: {}}, now, now - 1000],
    sleep: [{kind: 'idle', live: {}}, now, now - SLEEP_AFTER_MS - 1],
    think: [{kind: 'plain', live: {active: true, state: 'thinking'}}],
    read: [work('', 'read')],
    write: [work('write', 'write')],
    create: [work('create', 'write')],
    exec: [work('', 'exec')],
    search: [work('', 'web_search')],
    image: [work('view', 'read')],
    dispatch: [work('dispatch', 'pinkie_session_start')],
    waiting: [{kind: 'wait', live: {active: true, state: 'working', tool: 'wait'}}],
    review: [{kind: 'review', live: {active: true}}],
    ask: [{kind: 'ask', live: {active: true, state: 'asking'}}],
    done: [{kind: 'done', live: {}, ended: {outcome: 'done'}}],
    error: [{kind: 'stopped', live: {}, ended: {outcome: 'error'}}],
    stopped: [{kind: 'stopped', live: {}, ended: {outcome: 'stopped'}}],
  };
  const cat = env.ctx.LaolaoMetreCat;
  assert.deepEqual(Object.keys(cases).sort(), Object.keys(cat.STATES).sort());
  for (const [state, [detail, at = now, idleSince = now]] of Object.entries(cases)) {
    assert.equal(stateFor(detail, at, idleSince), state, state);
  }
  // 工具刚报错：短暂炸毛
  assert.equal(stateFor({kind: 'plain', live: {active: true, state: 'thinking', toolError: now - 500}}, now), 'error');
  assert.equal(stateFor({kind: 'offline', live: {active: true}}, now), 'stopped');
});

// ---------- A4-6 不可见不重绘、减少动效只画第一帧 ----------
test('A4-6: reduced motion shows only the first frame; idle blinks once then holds; hidden pages stop the timer', () => {
  const env = load(['laolao-metre-cat-frames.js', 'laolao-metre-cat.js']);
  const {frameIndex} = env.window.__pinkieMetreCat;
  for (const [name, def] of Object.entries(env.ctx.LaolaoMetreCat.STATES)) {
    for (let tick = 0; tick < 40; tick++) assert.equal(frameIndex(name, def, tick, true, null), 0, name);
    assert.ok(def.fps <= 8, `${name} 最高 8 帧每秒`);
  }
  const idle = env.ctx.LaolaoMetreCat.STATES.idle;
  assert.equal(frameIndex('idle', idle, 50, false, null), 0, '没在眨眼时停在第一帧');
  const blink = new Set(Array.from({length: 8}, (_, i) => frameIndex('idle', idle, 10 + i, false, 10)));
  assert.ok(blink.size > 1, '眨眼那一段在动');
  assert.equal(frameIndex('idle', idle, 10 + 64, false, 10), 0, '眨完回到第一帧');
  const source = read(INJ + 'laolao-metre-cat.js');
  assert.match(source, /if \(document\.hidden \|\| !isMetre\(\)/, '页面不可见时不画');
  assert.match(source, /visibilitychange', \(\) => \{ if \(document\.hidden\) halt\(\)/);
  assert.doesNotMatch(source, /requestAnimationFrame|gsap|webgl/i, '不用 rAF 空转、GSAP、WebGL');
});

// ---------- A4-1 / A4-2 皮肤只在 Metre 下生效、不带粉色 ----------
test('A4-1/A4-2: every skin rule is scoped to Metre (or to Metre-only classes), with no pink and no glass', () => {
  const css = read(INJ + 'laolao-metre-skin.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}@]+)\{[^{}]*\}/g)].map((m) => m[1].trim()).filter((sel) => sel && !/^(?:from|to|\d+%)/.test(sel));
  for (const rule of rules) {
    // 只按顶层逗号切（:is(...) 里的逗号不算）
    const parts = []; let depth = 0, cur = '';
    for (const ch of rule) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch; }
    parts.push(cur);
    for (const sel of parts.map((s) => s.trim()).filter(Boolean)) {
      const scoped = /^html\[data-laolao-mode="metre"\]/.test(sel) || /^\.pk-metre-/.test(sel)
        || /^html:not\(\[data-laolao-mode="metre"\]\) \.pk-metre-/.test(sel)
        || /^html\[data-pinkie-reduce-motion\] \.pk-metre-/.test(sel);
      assert.ok(scoped, `没限定在 Metre 下的规则：${sel}`);
    }
  }
  assert.doesNotMatch(css, /#e94f91|#ff7aa2|#d64f79|#b72d6b|233,\s*79,\s*145|pink/i);
  assert.match(css, /backdrop-filter: none !important/);
  for (const token of ['#FAF9F5', '#1F1E1D', '#73726C', '#E8E6DC', '#C96442', '#262624', '#F0EEE6']) assert.ok(css.includes(token), token);
  const cat = read(INJ + 'laolao-metre-cat.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(cat, /html:not\(\[data-laolao-mode="metre"\]\) \.pk-metre-cat/);
  const head = read(INJ + 'laolao-head.fragment.html');
  assert.ok(head.indexOf('laolao-night.css') < head.indexOf('laolao-metre-skin.css'), '皮肤在黑夜模式之后加载');
});

test('A4-1: the ambient canvas stops drawing in Metre (not just hidden); Metre status words carry no 碧琪', () => {
  assert.match(read(INJ + 'laolao-companion.js'), /getAttribute\("data-laolao-mode"\) !== "metre"/);
  const env = sandbox();
  env.window.__pinkieToolKind = {ING: {create: '正在创建', memory: '正在翻项目记忆'}};
  load(['laolao-run-status.js'], env);
  const {describe} = env.window.__pinkieRunStatus;
  const base = {now: 1000, conn: {online: true}};
  const say = (live, more = {}) => describe({...base, metre: true, live: {active: true, startedAt: 1, ...live}, ...more});
  for (const view of [say({state: 'thinking'}), say({state: 'writing'}), say({state: 'working', tool: 'create'}),
    say({state: 'working', toolName: 'read'}), say({state: 'working', toolName: 'exec'}), say({state: 'working', tool: 'memory'})]) {
    assert.equal(view.visible, true);
    assert.doesNotMatch(view.text, /碧琪|啦|！/);
  }
  assert.equal(say({state: 'working', toolName: 'read'}).text, '正在读取');
  assert.equal(say({state: 'thinking'}).text, '思考中');
  // 空闲时 Metre 的条常驻（只有猫），老模式照旧不出现
  assert.equal(describe({...base, metre: true, live: {}}).visible, true);
  assert.equal(describe({...base, metre: true, live: {}}).kind, 'idle');
  assert.equal(describe({...base, live: {}}).visible, false);
  assert.equal(describe({...base, live: {active: true, startedAt: 1, state: 'thinking'}}).visible, false, '老模式的「在想」仍由过程卡说');
  assert.match(describe({...base, live: {active: true, startedAt: 1, state: 'thinking'}}).text, /碧琪/);
});

// ---------- A4-9 Baton / Virtuoso ----------
test('A4-9: the switch shows only Baton｜Virtuoso; Chinese only in the tooltip and the i; toast is English', () => {
  const source = read(INJ + 'laolao-session-tools.js');
  const block = source.slice(source.indexOf('const BATON = ['), source.indexOf('function modeChip'));
  assert.match(block, /label: 'Baton', tip: '指挥棒/);
  assert.match(block, /label: 'Virtuoso', tip: '独奏/);
  assert.match(block, /dataset\.pinkieTooltip = item\.tip/);
  assert.match(block, /pinkie-baton__info/);
  assert.match(block, /item\.label \+ ' · from your next message' : item\.label/);
  assert.doesNotMatch(block, /nextTurn\(/);
});

// ---------- A4-10 引导语题库和换句 ----------
const data = JSON.parse(read('briefs/metre-mode-1113/ref/metre-prompts.json'));
function homeEnv() {
  const env = sandbox();
  load(['laolao-metre-prompts.js', 'laolao-metre-home.js'], env);
  return {env, home: env.window.__pinkieMetreHome, bank: env.ctx.LaolaoMetrePrompts};
}

test('A4-10: the bank is the JSON sentence for sentence — 120, five kinds, the user\'s 40 all there', () => {
  const {bank, home} = homeEnv();
  assert.deepEqual(JSON.parse(JSON.stringify(bank)), data);
  const all = home.allPrompts(bank);
  assert.ok(all.length >= 120);
  assert.deepEqual([...new Set(all.map((item) => item.category))].sort(), ['heuristic', 'koan', 'powerful', 'reflective', 'socratic']);
  const user = data.categories.flatMap((c) => c.user);
  assert.equal(user.length, 40);
  for (const sentence of user) assert.ok(all.some((item) => item.text === sentence), sentence);
});

test('A4-10: interval by hour is 25 / 45 / 90 seconds; categories weighted by time of day', () => {
  const {home} = homeEnv();
  const expect = {0: 90, 3: 90, 8: 90, 9: 25, 11: 25, 12: 45, 13: 45, 14: 25, 17: 25, 18: 45, 22: 45, 23: 90};
  for (const [hour, seconds] of Object.entries(expect)) assert.equal(home.intervalFor(Number(hour)), seconds * 1000, `${hour} 点`);
  assert.equal(home.weightsFor(8).heuristic, 3); assert.equal(home.weightsFor(8).powerful, 3);
  assert.equal(home.weightsFor(15).socratic, 3);
  assert.equal(home.weightsFor(20).reflective, 3);
  assert.equal(home.weightsFor(2).koan, 3);
});

test('A4-10: no sentence repeats within 24 hours; the 下午好 line only shows 12–18 and drops the name when none is set', () => {
  const {home, bank} = homeEnv();
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const start = new Date(2026, 10, 14, 15, 0, 0).getTime();
  const history = {};
  const seen = new Set();
  for (let i = 0; i < 110; i++) {
    const item = home.pickPrompt({data: bank, now: start + i * 25_000, history, random});
    assert.ok(!seen.has(item.key), `24 小时内重复：${item.key}`);
    seen.add(item.key); history[item.key] = start + i * 25_000;
  }
  const greeted = data.categories.flatMap((c) => [...c.user, ...c.fable]).find((s) => s.startsWith('下午好，C.le.'));
  assert.equal(home.personalize(greeted, '', 10), null, '上午不出');
  assert.match(home.personalize(greeted, '', 15), /^此时此刻/);
  assert.match(home.personalize(greeted, 'C.le.', 15), /^下午好，C\.le\.。此时此刻/);
});

test('A4-10: hovering or a hidden page never schedules the next sentence', () => {
  const source = read(INJ + 'laolao-metre-home.js');
  const arm = source.slice(source.indexOf('function arm()'), source.indexOf('async function refreshToday'));
  assert.match(arm, /if \(!box \|\| !box\.isConnected \|\| document\.hidden \|\| hovering\) return;/);
  assert.match(arm, /intervalFor\(new Date\(\)\.getHours\(\)\)/);
  assert.match(source, /visibilitychange', \(\) => \{ if \(document\.hidden\) \{ clearTimeout\(timer\)/);
  assert.match(source, /mouseenter', \(\) => \{ hovering = true; \}/);
});

// ---------- A4-11 彩蛋 ----------
test('A4-11: eggs come only from real data — festival, term, season, greeting, recent memory; none invented', () => {
  const {home} = homeEnv();
  const now = new Date(2026, 9, 1, 10, 0, 0).getTime();
  const national = home.eggCandidates({today: {festivals: [{name: '国庆节', kind: 'big'}], holiday: '国庆节', term: '', season: 'autumn'}, now});
  assert.ok(national.some((egg) => egg.type === 'festival' && /国庆节/.test(egg.text)));
  assert.ok(national.some((egg) => egg.type === 'season' && /秋天/.test(egg.text)));
  assert.ok(national.some((egg) => egg.type === 'greeting' && /上午好/.test(egg.text)));
  assert.ok(!national.some((egg) => egg.type === 'memory'), '没有记忆就不出记忆彩蛋');
  const term = home.eggCandidates({today: {festivals: [], term: '立冬', season: 'winter'}, now});
  assert.ok(term.some((egg) => egg.type === 'term' && /立冬/.test(egg.text)));
  assert.ok(!term.some((egg) => egg.type === 'season'), '有节气就不再说季节');
  const recent = home.eggCandidates({today: {festivals: [], recent: {category: 'open', text: '表单校验', folderName: 'site'}}, now});
  assert.ok(recent.some((egg) => egg.type === 'memory' && /site/.test(egg.text) && /表单校验/.test(egg.text)));
  assert.equal(home.eggCandidates({today: null, now}).length, 1, '没有今天的数据只剩时段问候');
  // 同一天同一类最多一次
  assert.ok(!home.eggCandidates({today: null, now, eggsToday: {greeting: true}}).length);
  // 没名字时不留空称呼
  assert.doesNotMatch(home.eggCandidates({today: null, now}).map((e) => e.text).join(''), /\{name\}|，。|，，/);
  assert.match(home.eggCandidates({today: null, now, name: 'C.le.'})[0].text, /C\.le\./);
  // 时段六组
  assert.deepEqual([6, 10, 14, 18, 21, 2].map(home.bucketOf), ['early', 'morning', 'afternoon', 'dusk', 'night', 'late']);
});

test('A4-11: eggs never exceed three in ten; no network request for weather', () => {
  const {home} = homeEnv();
  let seed = 3;
  const random = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  let shown = 0, eggs = 0;
  for (let i = 0; i < 2000; i++) {
    if (home.shouldEgg({shownToday: shown, eggsCount: eggs, candidates: [{type: 'x'}], random})) eggs++;
    shown++;
    assert.ok(eggs / shown <= home.EGG_SHARE + 1e-9);
  }
  assert.ok(eggs > 100, '有候选时确实会出');
  assert.equal(home.shouldEgg({shownToday: 0, eggsCount: 0, candidates: [], random: () => 0}), false);
  const source = read(INJ + 'laolao-metre-home.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|weather|天气/);
});

// ---------- A4-12 动画只动 opacity / transform ----------
test('A4-12: prompt animation only moves opacity / transform; keywords stand out; reduced motion has none', () => {
  const css = read(INJ + 'laolao-metre-skin.css');
  for (const [, name, body] of css.matchAll(/@keyframes ([\w-]+)\s*\{([\s\S]*?)\n\}/g)) {
    const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    assert.ok(props.length && props.every((p) => p === 'opacity' || p === 'transform'), `${name}: ${props}`);
  }
  assert.match(css, /\.pk-metre-kw \{[^}]*color: var\(--metre-accent/);
  assert.match(css, /html\[data-pinkie-reduce-motion\] \.pk-metre-prompt__text \.pk-metre-ch \{ animation: none !important; opacity: 1 !important; \}/);
  const {home} = homeEnv();
  const tokens = home.tokens('先把[[哪块基石]]落位');
  assert.deepEqual(tokens.filter((t) => t.kw).map((t) => t.ch).join(''), '哪块基石');
  assert.equal(home.charDelay(10), 18);
  assert.ok(home.charDelay(200) * 200 <= 1200, '最长 1.2 秒');
  assert.equal(home.stripMarks('先把[[哪块基石]]落位'), '先把哪块基石落位');
});

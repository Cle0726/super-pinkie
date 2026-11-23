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
  for (const file of ['laolao-mode-switcher.js', 'laolao-classic-shell.js']) {
    assert.match(read(INJ + file), /asset\("\/laolao-mode-metre\.svg"\)/, file);
  }
  // 启动 / 切换闪屏在 Metre 时用像素 M（11-15），不用猫头，也不用碧琪的图
  assert.match(read(INJ + 'laolao-splash.js'), /__pinkieMetreBrand\?\.mark/);
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
  // 类名里的 pinkie（.pinkie-baton 这类）不算粉色：先去掉再查颜色。
  assert.doesNotMatch(css.replace(/pinkie/gi, ''), /#e94f91|#ff7aa2|#d64f79|#b72d6b|233,\s*79,\s*145|pink/i);
  assert.match(css, /backdrop-filter: none !important/);
  // 11-23：颜色合并成日间、深色各一段，这里核对的是现在真正生效的那一组（「谱纸」：暖白底、墨色字、钴蓝笔）；
  // PLAN 2.10 最早那组（#FAF9F5 底、#C96442 陶土强调）早被后面的版本盖掉了，合并时随之删掉。
  for (const token of ['#F7F6F3', '#1B1A18', '#77736B', '#E4E2DC', '#2F4BB0', '#151514', '#ECEAE4', '#93A5EE']) assert.ok(css.includes(token), token);
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
  assert.match(block, /item\.label \+ ' · next turn' : item\.label/);
  assert.doesNotMatch(block, /nextTurn\(/);
});

// ---------- A4-10 引导语题库和换句 ----------
const data = JSON.parse(read('briefs/metre-mode-1113/ref/metre-prompts.json'));
function homeEnv() {
  const env = sandbox();
  load(['laolao-metre-prompts.js', 'laolao-metre-home.js'], env);
  return {env, home: env.window.__pinkieMetreHome, bank: env.ctx.LaolaoMetrePrompts};
}

test('A4-10: the bank is the JSON sentence for sentence; every original line the user sent (11-13 and 11-17) is in it', () => {
  const {bank, home} = homeEnv();
  assert.deepEqual(JSON.parse(JSON.stringify(bank)), data);
  const all = home.allPrompts(bank);
  const kinds = [...new Set(all.map((item) => item.category))];
  assert.equal(kinds.length, 54);
  for (const id of ['heuristic', 'koan', 'powerful', 'reflective', 'socratic', 'orchestral', 'latenight', 'razor', 'warmth', 'cosmic', 'lowtide', 'ultimate']) assert.ok(kinds.includes(id), id);
  for (const c of data.categories) assert.ok(c.zh && c.en, `${c.id} 有中英文名`);
  const plain = (s) => s.replace(/\[\[|\]\]/g, '');
  const user = new Set(data.categories.flatMap((c) => c.user).map(plain));
  const lines = (day) => read(`briefs/metre-mode-1113/ref/metre-prompts-${day}-user.txt`).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('@'));
  const sent = ['1117', '1117b'].flatMap(lines);
  assert.equal(sent.length, 400);
  // 11-17 第四批进来时撤掉了原来的长句：首页显示超过 51 字的不在题库里，其余原句都在。
  const shown = (s) => plain(s).replace(/[（(][A-Za-z][^）)]*[）)]/g, '').length;
  for (const sentence of sent) assert.equal(user.has(sentence), shown(sentence) <= 51, sentence);
  for (const c of data.categories) for (const s of [...c.user, ...c.fable]) assert.ok(shown(s) <= 51, s);
  // 第四批（1117c）200 句原样在题库里，每句都标了关键词。
  const batch4 = lines('1117c');
  assert.equal(batch4.length, 200);
  const marked = new Set(data.categories.flatMap((c) => c.user));
  for (const sentence of batch4) { assert.match(sentence, /\[\[[^\]]+\]\]/, sentence); assert.ok(marked.has(sentence), sentence); }
  assert.equal(user.size, 510);
});

test('A4-10: every kind in the bank can come up, with a few boosted by time of day', () => {
  const {home, bank} = homeEnv();
  const ids = bank.categories.map((c) => c.id);
  for (const hour of [2, 8, 15, 20]) {
    const w = home.weightsFor(hour, ids);
    assert.deepEqual(Object.keys(w).sort(), [...ids].sort(), `${hour} 点所有类都有权重`);
  }
  assert.equal(home.weightsFor(2, ids).latenight, 3);
  assert.equal(home.weightsFor(8, ids).ignition, 3);
  assert.equal(home.weightsFor(20, ids).warmth, 3);
  assert.equal(home.weightsFor(15, ids).razor, 1);
  let seed = 11;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const start = new Date(2026, 10, 17, 21, 0, 0).getTime();
  const history = {};
  const seen = new Set();
  for (let i = 0; i < 600; i++) {
    const item = home.pickPrompt({data: bank, now: start + i * 45_000, history, random});
    history[item.key] = start + i * 45_000; seen.add(item.category);
  }
  assert.equal(seen.size, ids.length, '轮得到每一类');
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
    // 11-23：多放行 translate（弹层上浮：它们的 transform 被 !important 锁着）和 clip-path（关键词那排点一颗颗亮）；都不触发重排
    assert.ok(props.length && props.every((p) => ['opacity', 'transform', 'translate', 'clip-path'].includes(p)), `${name}: ${props}`);
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

// ---------- 第三版：入口是一个按钮；总控台骨架只占位、不发请求 ----------
test('Metre entry is a text-only button; the board skeleton has all slots, placeholders only, and no timers or requests', () => {
  const switcher = read(INJ + 'laolao-mode-switcher.js');
  assert.match(switcher, /id: "metre"[\s\S]{0,900}plain: true/, 'Metre 的入口不放头像');
  assert.match(switcher, /if \(mode\.plain\) \{[\s\S]{0,200}button\.replaceChildren\(label, arrow\)/);
  const head = read(INJ + 'laolao-head.fragment.html');
  assert.match(head, /laolao-metre-board\.css/);
  assert.match(head, /laolao-metre-board\.js/);
  const board = read(INJ + 'laolao-metre-board.js');
  for (const slot of ['plan', 'sessions', 'pending', 'timeline', 'changes', 'runtime', 'memory', 'raw']) assert.match(board, new RegExp(`\{id: '${slot}'`), slot);
  assert.match(board, /dataset\.metreSlot = 'overview'/);
  assert.match(board, /待接入/);
  assert.doesNotMatch(board, /setInterval|requestAnimationFrame|gwRequest|fetch\(/, '骨架不轮询、不发请求');
  const css = read(INJ + 'laolao-metre-board.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /html:not\(\[data-laolao-mode="metre"\]\) \.pk-metre-board/);
  assert.doesNotMatch(css.replace(/pinkie/gi, ''), /#e94f91|#ff7aa2|pink|backdrop-filter/i);
  const skin = read(INJ + 'laolao-metre-skin.css');
  assert.match(skin, /aside\.sidebar::after \{ content: none !important/, '侧栏那条亮线去掉了');
});

// ---------- 11-15 对话页的像素背景：只在 Metre 对话页有，只用一个半拍的 setTimeout，减少动态效果时不走 ----------
test('Metre backdrop: exists only in Metre chat pages, steps on a half-beat timeout, stops for reduced motion, gone outside Metre', () => {
  const head = read(INJ + 'laolao-head.fragment.html');
  assert.match(head, /laolao-metre-backdrop\.js/);
  assert.match(head, /laolao-metre-backdrop\.css/);
  const src = read(INJ + 'laolao-metre-backdrop.js');
  assert.doesNotMatch(src, /setInterval/, '不留常驻动画：只有一个按格子走的 setTimeout');
  // 11-16 夜：点击的波纹跟屏幕刷新走（rAF），只在点击后的那一段里排、画完就停；rAF 只出现在点击那一段
  assert.equal((src.match(/requestAnimationFrame\(/g) || []).length, 1, 'rAF 只有一处');
  assert.match(src, /function nextRipple\(\) \{\n    rippleTimer = setTimeout\(rippleTick, [^\n]+\n    if \(!document\.hidden && typeof requestAnimationFrame === 'function'\) rippleRaf = requestAnimationFrame\(rippleTick\)/, 'rAF 只给点击的波纹用，另有保底定时器');
  assert.match(src, /if \(ripples\.length && canvas\) nextRipple\(\);/, '波纹画完就停');
  const css = read(INJ + 'laolao-metre-backdrop.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css.replace(/pinkie/gi, ''), /gradient|box-shadow|filter|#e94f91|pink/i, '不发光、不用渐变、不用碧琪的色');

  const env = sandbox();
  const {ctx, attrs, timers, document} = env;
  const removeAttr = (name) => { delete attrs[name]; };
  document.documentElement.removeAttribute = removeAttr;
  document.documentElement.style = {setProperty() {}, removeProperty() {}};
  let canvas = null;
  const g2d = new Proxy({}, {get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; }});
  const rect = (left, width) => ({left, right: left + width, top: 44, width, height: 856});
  const main = {getBoundingClientRect: () => rect(280, 1160)};
  const input = {getBoundingClientRect: () => rect(476, 768)};
  document.body = {prepend: (node) => { canvas = node; }};
  document.querySelector = (sel) => (sel.includes('main.content') ? main : sel === '.agent-chat__input' ? input : null);
  document.createElement = () => ({style: {}, setAttribute() {}, remove() { canvas = null; }, getContext: () => g2d, width: 0, height: 0});
  ctx.MutationObserver = class { observe() {} disconnect() {} };
  ctx.ResizeObserver = class { observe() {} unobserve() {} };
  ctx.getComputedStyle = () => ({getPropertyValue: () => ''});
  load(['laolao-metre-backdrop.js'], env);
  const api = env.window.__pinkieMetreBackdrop;
  assert.ok(api.mounted && canvas, 'Metre 对话页上有画布');
  assert.ok('data-pk-metre-backdrop' in attrs);
  assert.equal(api.running, false, 'idle chat has no half-beat timer');
  // 11-23（用户点头改了批 6）：空闲时一拍一步地呼吸，落在拍子格子上
  assert.equal(api.breathing, true, '空闲时呼吸');
  assert.ok(timers.at(-1).ms > 0 && timers.at(-1).ms <= 60_000 / 72, '呼吸一拍一步');
  api.preview(['run']);
  api.sync();
  assert.equal(timers.at(-1).ms, 60_000 / 72 / 2, '每半拍（♩=72）走一格');
  timers.at(-1).fn();
  assert.equal(api.step, 1);

  attrs['data-pinkie-reduce-motion'] = '';
  api.sync();
  assert.equal(api.running, false, '减少动态效果：只画一帧，不走');
  assert.equal(api.breathing, false, '减少动态效果：也不呼吸');
  assert.equal(api.tap(600, 700), false, '减少动态效果：点击不起波纹');
  delete attrs['data-pinkie-reduce-motion'];

  attrs['data-laolao-mode'] = 'chat';
  api.sync();
  assert.equal(api.mounted, false, '不在 Metre：画布拿掉');
  assert.equal(canvas, null);
  assert.ok(!('data-pk-metre-backdrop' in attrs));
});

// ---------- 11-15 第六版：切换进 Metre 的「预备拍」过场、首页速度记号、看板亮在点阵上 ----------
test('Metre v6: count-in transition is wired into the switcher, declines under reduced motion, never leaves a resident loop', () => {
  const head = read(INJ + 'laolao-head.fragment.html');
  assert.match(head, /laolao-metre-transition\.js/);
  const switcher = read(INJ + 'laolao-mode-switcher.js');
  assert.match(switcher, /if \(mode\.plain\) \{[\s\S]{0,700}PinkieMetreTransition\?\.play/, 'Metre 走自己的过场');
  const src = read(INJ + 'laolao-metre-transition.js');
  assert.match(src, /if \(reduced\(\)\) return null;/, '减少动态效果时不放过场');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /setInterval|WebGL|\.png|\.webp/, '只用 canvas 点阵，不用图片、不留常驻计时器');
  assert.match(src, /const LOGO = \[/, '过场里有像素 M（当谱号）');
  assert.doesNotMatch(src, /LaolaoMetreCat/, '小猫去掉了（用户 11-23）');
  assert.match(src, /overlay\.remove\(\)/);
});

test('Metre v6 home: tempo mark above the prompt, board art drawn on the backdrop, cobalt accent', () => {
  const home = read(INJ + 'laolao-metre-home.js');
  assert.match(home, /pk-metre-tempo/);
  assert.match(home, /pk-metre-prompt__head/);
  const backdrop = read(INJ + 'laolao-metre-backdrop.js');
  assert.match(read(INJ + 'laolao-metre-board.js'), /pk-metre-quick__art/, '看板卡片的图在看板自己里画（背景不再画）');
  assert.match(backdrop, /data-laolao-startup-home/);
  const skin = read(INJ + 'laolao-metre-skin.css');
  const v6 = skin.slice(skin.indexOf('第六版「总谱」'));
  assert.match(v6, /--metre-accent: #2F4BB0;/);
  assert.match(v6, /\.pk-metre-quick__card:hover \{[\s\S]{0,200}background: transparent !important;/, '看板卡片没有卡片底');
});

// ---------- 11-16 第十二稿：点哪里都是「一个音落进水里」（RIPPLE-DETAIL-PLAN-1116 §A‴） ----------
test('Metre backdrop v12: a tap anywhere drops a note into the backdrop — a 3D ripple where you click, notes jump out, objects ride the floor, nothing is left behind', () => {
  const head = read(INJ + 'laolao-head.fragment.html');
  assert.match(head, /laolao-metre-backdrop\.js\?v=@hash/);
  const ctx = {console, Math, Date};
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read(INJ + 'laolao-metre-backdrop.js'), ctx);
  const S = ctx.__pinkieMetreScene;
  const cols = 360, rows = 120, band = 66;
  const sc = S.buildScene({cols, rows, band, dark: true, home: true, lamps: ['run', 'done']});
  const {floorY} = sc.anchors;
  // 静的一层分两份：拿掉东西的 base 和完整的 buf；东西各成一组
  assert.ok(sc.groups.length > 4, '谱台、椅子、指挥台各记成一组');
  let diff = 0; for (let i = 0; i < sc.buf.length; i++) if (sc.buf[i] !== sc.base[i]) { diff++; assert.ok(sc.obj[i], 'buf 和 base 只在东西上不同'); }
  assert.ok(diff > 0);
  const still = new Uint32Array(cols * rows); S.compose(sc, 0, false, [], 0, still);
  // 点在地板中段：落点起一圈水波，地板的像素被顶起来
  const rp = S.makeRipples(sc, 150, floorY + 30, 0);
  assert.equal(rp.length, 1);
  const mid = new Uint32Array(cols * rows); const top = S.compose(sc, 0, false, rp, rp[0].t0 + 120, mid);
  let changed = 0, far = 0;
  for (let i = 0; i < mid.length; i++) if (mid[i] !== still[i]) { changed++; if (Math.floor(i / cols) < floorY - 40) far++; }
  assert.ok(changed > 200, '地面在动');
  assert.equal(far, 0, '刚起波时只有落点附近在动');
  assert.ok(top >= 0 && top < rows);
  // 结束之后和没点过一模一样（不留残影）
  const after = new Uint32Array(cols * rows); S.compose(sc, 0, false, rp, rp[0].t0 + S.RIPPLE_MS + 1, after);
  assert.deepEqual(Array.from(after), Array.from(still));
  // 点在上面的空处：波就在点的地方（不是只有下面的地板有反应），还有音符
  const air = S.makeRipples(sc, 150, 12, 0)[0];
  assert.ok(air.air, '地板以上的点击是地板以上的水波');
  const up = new Uint32Array(cols * rows); S.compose(sc, 0, false, [air], air.t0 + 300, up);
  let near = 0; for (let y = 0; y < 40; y++) for (let x = 110; x <= 190; x++) if (up[y * cols + x] !== still[y * cols + x]) near++;
  assert.ok(near > 100, '点的地方荡开一圈');
  assert.ok(S.SPRITES.noteEighth && S.SPRITES.noteHead, '音符和符头是像素精灵');
  // 点在谱台上：波从它脚下起
  const stand = sc.groups.find((g) => g && g.kind === 'stand' && g.foot < rows);
  const hit = S.makeRipples(sc, stand.cx, stand.y0 + 3, 0)[0];
  assert.equal(hit.group, stand.id);
});

test('Metre 11-16 night: the plane above the floor is a sheet of staff paper a note dents; the cat has more pixels and its own idle moves, and pricks its ears at a tap', () => {
  const ctx = {console, Math, Date};
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read(INJ + 'laolao-metre-backdrop.js'), ctx);
  const S = ctx.__pinkieMetreScene;
  const cols = 360, rows = 160, band = 66;
  const sc = S.buildScene({cols, rows, band, dark: true, home: true, lamps: ['run']});
  const still = new Uint32Array(cols * rows); S.compose(sc, 0, false, [], 0, still);
  const air = S.makeRipples(sc, 150, 30, 0)[0];
  // 压下去的那一刻：谱纸显出来，坑在点的地方，地平线以下不动
  const dent = new Uint32Array(cols * rows); S.compose(sc, 0, false, [air], air.t0 + 100, dent);
  let near = 0, below = 0;
  for (let i = 0; i < dent.length; i++) if (dent[i] !== still[i]) { const y = Math.floor(i / cols), x = i % cols; if (y >= sc.anchors.floorY) below++; else if (Math.hypot(x - 150, y - 30) < 60) near++; }
  assert.ok(near > 300, '谱纸和坑就在点的地方');
  assert.equal(below, 0, '竖直面在墙和地板的交线截断');
  // 同一个时刻画两遍完全一样；结束后不留残影
  const again = new Uint32Array(cols * rows); S.compose(sc, 0, false, [air], air.t0 + 100, again);
  assert.deepEqual(Array.from(again), Array.from(dent));
  const after = new Uint32Array(cols * rows); S.compose(sc, 0, false, [air], air.t0 + S.RIPPLE_MS + 1, after);
  assert.deepEqual(Array.from(after), Array.from(still));
  assert.match(read(INJ + 'laolao-metre-backdrop.js'), /dispatchEvent\(new CustomEvent\('pinkie:metre-tap'/, '点背景时告诉猫');
  // 猫：多一档毛的冷光，几段自己的小动作帧，都是 16×16、最高 8 帧每秒
  const cat = require(path.join(ROOT, INJ, 'laolao-metre-cat-frames.js'));
  assert.ok(cat.PALETTE.R, '毛的冷光一档');
  assert.ok(cat.STATES.idle.frames[0].join('').includes('R'));
  for (const name of ['nod', 'groom', 'swish', 'perk']) {
    const def = cat.ACTS[name];
    assert.ok(def && def.fps <= 8, name);
    for (const f of def.frames) assert.ok(f.length === 16 && f.every((r) => r.length === 16), name);
  }
  assert.equal(Math.round(cat.ACTS.nod.frames.length / cat.ACTS.nod.fps * 1000), Math.round(60000 / 72), '点头一拍 = ♩=72');
  const source = read(INJ + 'laolao-metre-cat.js');
  assert.match(source, /addEventListener\('pinkie:metre-tap', onTap\)/, '背景被点时竖耳朵');
  assert.match(source, /name: 'nod', own: true/);
});

// ---------- 11-16 夜（二）：空中点一下，声音落到地板上接着荡开；谱线跟着波走，不留一块不动的谱纸 ----------
test('Metre 11-16 night 2: a tap above the floor also ripples the floor below (stands ride it, lamps flash), and the staff paper travels with the ring', () => {
  const ctx = {console, Math, Date};
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read(INJ + 'laolao-metre-backdrop.js'), ctx);
  const S = ctx.__pinkieMetreScene;
  const cols = 580, rows = 239, band = 126;
  const sc = S.buildScene({cols, rows, band, dark: true, home: true, lamps: ['run', 'done']});
  const {floorY} = sc.anchors;
  const still = new Uint32Array(cols * rows); S.compose(sc, 0, false, [], 0, still);
  const rs = S.makeRipples(sc, 250, 90, 0);
  assert.equal(rs.length, 2, '竖直面一个 + 落到地板上的回声一个');
  const [air, echo] = rs;
  assert.ok(air.air && echo.echo && !echo.air, '回声是地板上的波');
  assert.ok(echo.t0 > air.t0 && echo.t0 - air.t0 <= 360, '涟漪走到墙脚（最晚 360ms）才落到地板上');
  const rowsChanged = (buf, y0, y1) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < cols; x++) if (buf[y * cols + x] !== still[y * cols + x]) n++; return n; };
  const early = new Uint32Array(cols * rows); S.compose(sc, 0, false, rs, air.t0 + 100, early);
  assert.equal(rowsChanged(early, floorY, rows), 0, '还没落地时地板不动');
  const late = new Uint32Array(cols * rows); S.compose(sc, 0, false, rs, echo.t0 + 600, late);
  assert.ok(rowsChanged(late, floorY, rows) > 300, '落地后地板荡开');
  // 回声没有自己的符头和音符：只看地板以上，单独画回声和什么都不点一样
  const only = new Uint32Array(cols * rows); S.compose(sc, 0, false, [echo], echo.t0 + 200, only);
  const objTop = Math.min(...sc.groups.filter(Boolean).map((g) => g.y0));
  assert.equal(rowsChanged(only, 0, objTop - 6), 0, '回声不在空中画东西（谱台跟着地板起伏，它们以上不动）');
  // 谱纸跟着波走：涟漪走完以后不留一块不动的谱纸
  const tail = new Uint32Array(cols * rows); S.compose(sc, 0, false, [air], air.t0 + 1150, tail);
  // （音符还在往上飘，只看落点下面那半圈）
  assert.ok(rowsChanged(tail, 110, floorY) < 40, '涟漪走完，谱纸也隐回去');
  const mid = new Uint32Array(cols * rows); S.compose(sc, 0, false, [air], air.t0 + 500, mid);
  assert.ok(rowsChanged(mid, 110, floorY) > 200, '涟漪走的时候，谱纸跟着亮');
  const after = new Uint32Array(cols * rows); S.compose(sc, 0, false, rs, echo.t0 + S.RIPPLE_MS + 1, after);
  assert.deepEqual(Array.from(after), Array.from(still), '都走完了不留残影');
});

// ---------- 11-16 夜（三）：点在下面几排谱台附近，最近的那个谱台灯亮一拍（一开始那版的交互，加回来） ----------
test('Metre 11-16 night 3: a tap near a stand lights its lamp for a beat, alongside the ripple', () => {
  const ctx = {console, Math, Date};
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read(INJ + 'laolao-metre-backdrop.js'), ctx);
  const S = ctx.__pinkieMetreScene;
  const opts = {cols: 580, rows: 239, band: 126, dark: true, home: true, lamps: ['run', 'done']};
  const sc = S.buildScene(opts);
  const off = sc.anchors.slots.findIndex((sl) => sl.state === 'off' && sl.depth === 1);
  const sl = sc.anchors.slots[off];
  assert.equal(S.nearestSlot(sc, sl.cx + 2, sl.base - 20), off, '点在谱台上 / 旁边：找到它');
  assert.equal(S.nearestSlot(sc, sl.cx, 5), -1, '上面空处离谱台远：不亮');
  const lit = S.buildScene({...opts, flash: off});
  assert.equal(lit.anchors.slots[off].state, 'tap', '不亮的灯亮成 tap 色');
  let near = 0, far = 0;
  for (let i = 0; i < sc.buf.length; i++) if (sc.buf[i] !== lit.buf[i]) { const x = i % opts.cols; if (Math.abs(x - sl.cx) < 40) near++; else far++; }
  assert.ok(near > 40, '灯和光晕亮起来');
  assert.equal(far, 0, '只有那一个谱台');
  const src = read(INJ + 'laolao-metre-backdrop.js');
  assert.match(src, /const slot = nearestSlot\(scene, x, y\);/, '运行时点击会找最近的谱台');
  assert.match(src, /if \(ripples\.length && canvas\) \{ flashTimer = setTimeout\(off, 120\); return; \}/, '波纹走完再熄灯');
});

test('Metre guide sentence is read-only: clicking it does not put it into the composer', () => {
  const source = read('ui/injections/laolao-metre-home.js');
  assert.doesNotMatch(source, /line\.addEventListener\('click'/);
  assert.doesNotMatch(source, /composer-combobox textarea/);
  assert.doesNotMatch(source, /setAttribute\('role', 'button'\)/);
});

test('Metre guide sentences: every one has a highlighted keyword, and the English glosses in brackets are not shown', () => {
  const {home, bank} = homeEnv();
  for (const c of bank.categories) for (const s of [...c.user, ...c.fable]) assert.match(s, /\[\[[^\]]+\]\]/, `没有关键词：${s}`);
  assert.equal(home.dropGlosses('被一个阻塞式的等待（Blocking I/O）卡住'), '被一个阻塞式的等待卡住');
  assert.equal(home.dropGlosses('‘拱顶石（Keystone）’'), '‘拱顶石’');
  let seed = 3;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const start = new Date(2026, 10, 17, 15, 0, 0).getTime();
  const history = {};
  for (let i = 0; i < 600; i++) {
    const item = home.pickPrompt({data: bank, now: start + i * 25_000, history, random});
    history[item.key] = start + i * 25_000;
    assert.doesNotMatch(item.text, /（[^（）]*[A-Za-z][^（）]*）/, item.text);
    assert.match(item.text, /\[\[[^\]]+\]\]/, item.text);
  }
});

test('Metre home eggs (greeting, festival, holiday, term, season, memory) carry a highlighted keyword too', () => {
  const {home} = homeEnv();
  const eggs = [];
  for (let hour = 0; hour < 24; hour++) for (const minute of [0, 1]) {
    const now = new Date(2026, 10, 17, hour, minute).getTime();
    eggs.push(...home.eggCandidates({today: {festivals: [{name: '国庆节', kind: 'big'}], term: '立冬', season: 'winter', recent: {category: hour % 2 ? 'open' : 'done', text: '表单[[校验]]', folderName: 'site'}}, now, name: 'C.le.'}));
    eggs.push(...home.eggCandidates({today: {festivals: [], holiday: '国庆节', season: 'autumn'}, now}));
  }
  assert.deepEqual([...new Set(eggs.map((egg) => egg.type))].sort(), ['festival', 'greeting', 'memory', 'season', 'term']);
  for (const egg of eggs) assert.match(egg.text, /\[\[[^\[\]]+\]\]/, egg.text);
  assert.ok(eggs.some((egg) => egg.text.includes('「[[表单校验]]」')));
});

test('Metre on a festival day: the festival egg opens the day and comes up more than any other egg, never twice in a row', () => {
  const {home} = homeEnv();
  let seed = 5;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const today = {festivals: [{name: '国庆节', kind: 'big'}], holiday: '国庆节', season: 'autumn', recent: {category: 'open', text: '表单校验'}};
  const day = {shown: 0, count: 0, types: {}, last: ''};
  const seen = [];
  const start = new Date(2026, 9, 1, 9, 0).getTime();
  for (let i = 0; i < 600; i++) {
    const now = start + i * 60_000;
    const candidates = home.eggCandidates({today, now, eggsToday: day.types, lastType: day.last});
    if (home.shouldEgg({shownToday: day.shown, eggsCount: day.count, candidates, random})) {
      const egg = home.pickEgg(candidates, random, {first: day.shown === 0});
      seen.push(egg.type); day.types[egg.type] = true; day.count += 1; day.last = egg.type;
    } else { seen.push('prompt'); day.last = ''; }
    day.shown += 1;
  }
  assert.equal(seen[0], 'festival', '第一句是节日彩蛋');
  const count = (type) => seen.filter((t) => t === type).length;
  for (const type of ['greeting', 'season', 'memory']) assert.ok(count('festival') > count(type), `${type} ${count(type)} 不该多过节日 ${count('festival')}`);
  assert.ok(count('festival') > 5, `节日彩蛋一天出了 ${count('festival')} 次`);
  for (let i = 1; i < seen.length; i++) assert.ok(!(seen[i] === 'festival' && seen[i - 1] === 'festival'), `第 ${i} 句连着出节日`);
  assert.ok(seen.filter((t) => t !== 'prompt').length / seen.length <= home.EGG_SHARE + 0.01, '彩蛋总数仍不超过三成');
  const plain = {shown: 0};
  const normal = home.eggCandidates({today: {festivals: [], season: 'autumn'}, now: start});
  assert.notEqual(home.shouldEgg({shownToday: plain.shown, eggsCount: 0, candidates: normal, random: () => 0.99}), true, '平常日子第一句不强制出彩蛋');
});

test('idle CPU: the cat wakes only when a frame changes and slows its idle acts when nobody is at the keys', () => {
  const src = read('ui/injections/laolao-metre-cat.js');
  // 1 fps sleep must not tick eight times a second
  assert.match(src, /stride = Math\.max\(1, Math\.floor\(8 \/ Math\.min\(8, playing\?\.fps \|\| 8\)\)\)/);
  assert.match(src, /timer = setTimeout\(loop, TICK_MS \* stride\)/);
  assert.match(src, /tick \+= stride;/);
  assert.match(src, /ACT_GAP_UNWATCHED = \[20_000, 20_000\]/);
  assert.match(src, /now - Math\.max\(lastInput, idleSince\) < LIVELY_MS \? ACT_GAP : ACT_GAP_UNWATCHED/);
  assert.match(src, /\['pointerdown', 'pointermove', 'keydown', 'wheel'\]\) window\.addEventListener\(type, noticeInput/);
});

// ---------- 11-23 在现有设计上打磨：颜色只留一套、总谱字体统一、首页画带让开输入框、全页一个拍子 ----------
test('Metre 11-23 polish: one day and one night colour block, the score board speaks one type voice, the home band clears the composer, one shared beat', () => {
  const skin = read(INJ + 'laolao-metre-skin.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const roots = [...skin.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /--metre-bg\s*:/.test(m[2])).map((m) => m[1].trim());
  assert.equal(roots.length, 2, '只有日间、深色两段在定 --metre-bg');
  assert.match(roots[1], /\[data-pinkie-night\],\s*html\[data-laolao-mode="metre"\]:not\(#_m1\):not\(#_m2\)\[data-theme="dark"\]$/);
  const board = read(INJ + 'laolao-metre-board.css');
  assert.doesNotMatch(board, /#4F7A5E|#86AF95|#E5EEE7|#1F2A23/, '做完不再用灰绿');
  assert.match(board, /--metre-v2: #6F8466;/, '做完是偏绿的灰（11-24，和其他的暖灰拉开）');
  assert.match(board, /\.pk-metre-board__card-head h3 \{[^}]*var\(--metre-serif/, '区块标题是衬线');
  assert.match(board, /\.pk-metre-board__en \{[^}]*var\(--metre-mono[^}]*text-transform: uppercase/, '英文小标是等宽大写注记');
  assert.match(board, /@media \(hover: hover\) \{[^\n]*\.pk-mb-score__row:not\(:hover\):not\(:focus-within\) \.pk-mb-score__acts \{ opacity: 0; \}/, '每行的按钮悬停才出现，触屏照旧');
  assert.doesNotMatch(board, /\.pk-mb-score__part strong \{[^}]*ellipsis/, '声部标题不截断');
  assert.match(board, /\.pk-mb-score__line\.is-empty \{ position: absolute;/, '没有说明文字的行不留空白，按钮浮在右边');
  assert.match(read(INJ + 'laolao-metre-board-data.js'), /if \(!bits\.length\) line\.classList\.add\('is-empty'\);/);
  const backdrop = read(INJ + 'laolao-metre-backdrop.js');
  assert.match(backdrop, /window\.innerHeight - Math\.max\(col\.bottom, under\?\.bottom \|\| 0\) - 16/, '首页画带不高过输入框下沿');
  assert.match(backdrop, /timer = setTimeout\(tick, live \? STEP - \(Date\.now\(\) % STEP\) : BEAT - \(Date\.now\(\) % BEAT\)\);/, '背景的摆锤和呼吸落在全页共用的拍子格子上');
  assert.match(read(INJ + 'laolao-metre-cat.js'), /idleAct\.name === 'nod' \? Math\.floor\(\(Date\.now\(\) % BEAT_MS\) \/ BEAT_MS \* def\.frames\.length\)/, '猫点头跟同一个钟');
  assert.match(read(INJ + 'laolao-metre-brand.js'), /\(Date\.now\(\) % \(BEAT \* 2\)\) \/ \(BEAT \* 2\)/, '标志页的摆跟同一个钟');
  // 首页地平线以上退一档，但谱台本身不退：buf 和 base 仍然只在东西上不同
  const ctx = {console, Math, Date};
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(backdrop, ctx);
  const S = ctx.__pinkieMetreScene;
  for (const dark of [true, false]) {
    const home = S.buildScene({cols: 360, rows: 160, band: 66, dark, home: true, lamps: ['run']});
    const chat = S.buildScene({cols: 360, rows: 160, band: 66, dark, home: false, lamps: ['run']});
    assert.ok(home.upDim > 0 && !chat.upDim, '只有首页退');
    for (let i = 0; i < home.buf.length; i++) if (home.buf[i] !== home.base[i]) assert.ok(home.obj[i], 'buf 和 base 只在东西上不同');
  }
});

// ---------- 11-23 动画：灯换状态的过渡、空闲呼吸、总谱滑入滑出和刷新过渡、弹层淡入、关键词那排点 ----------
test('Metre 11-23 motion: lamps blink and dim on a change, the stage breathes when idle, the board slides and its refresh moves, popovers rise, keyword dots light up; reduced motion has none', () => {
  const src = read(INJ + 'laolao-metre-backdrop.js');
  assert.match(src, /const LAMP_SEQ = \{run: \[/, '灯换状态有过渡');
  assert.match(src, /if \(previewLamps \|\| reduced\(\)\) \{ realLamps = real; lampAnims\.clear\(\); return real; \}/, '预览和减少动效时直接换');
  assert.match(src, /UNWATCHED_MS = 60_000/, '一分钟没人碰就不呼吸');
  assert.match(src, /const breathing = \(\) => !still\(\) && Date\.now\(\) - lastInput < UNWATCHED_MS;/);
  const ctx = {console, Math, Date};
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const S = ctx.__pinkieMetreScene;
  for (const dark of [true, false]) {
    const opts = {cols: 580, rows: 239, band: 126, dark, home: true};
    const at = (lamp) => S.buildScene({...opts, lamps: [lamp]});
    const [run, dim1, dim2, done] = ['run', 'dim1', 'dim2', 'done'].map(at);
    const diff = (a, b) => a.buf.reduce((n, v, i) => n + (v !== b.buf[i]), 0);
    assert.ok(diff(run, dim1) > 0 && diff(dim1, dim2) > 0 && diff(dim2, done) > 0, '在奏 → 做完中间有两档');
    // 呼吸：只动舞台口的天幕，不动谱台、指挥台；不呼吸时和原来一模一样
    const still = new Uint32Array(opts.cols * opts.rows); S.compose(run, 0, false, [], 0, still);
    run.breath = 3;
    const deep = new Uint32Array(opts.cols * opts.rows); S.compose(run, 0, false, [], 0, deep);
    const {sky} = run.anchors;
    let inside = 0;
    for (let i = 0; i < deep.length; i++) if (deep[i] !== still[i]) {
      const x = i % opts.cols, y = Math.floor(i / opts.cols);
      assert.ok(x >= sky.x0 && x <= sky.x1 && y >= sky.y0 && y < sky.y1 && !run.obj[i], '只在天幕里');
      inside++;
    }
    assert.ok(inside > 200, '天幕在呼吸');
    run.breath = 0;
    const back = new Uint32Array(opts.cols * opts.rows); S.compose(run, 0, false, [], 0, back);
    assert.deepEqual(Array.from(back), Array.from(still));
  }
  const skin = read(INJ + 'laolao-metre-skin.css');
  for (const name of ['pk-metre-board-in', 'pk-metre-board-out', 'pk-metre-new', 'pk-metre-grow', 'pk-metre-slide', 'pk-metre-pop-in', 'pk-metre-dots']) assert.match(skin, new RegExp(`@keyframes ${name} \\{`), name);
  assert.match(skin, /\[data-metre-pop\] \{[^}]*animation: pk-metre-pop-in 208ms/, '弹层 ¼ 拍淡入');
  assert.match(skin, /\.pk-metre-prompt__text\.is-enter \.pk-metre-kw::after \{ animation: pk-metre-dots 520ms linear var\(--metre-reveal, 0ms\) backwards; \}/);
  assert.match(skin, /html\[data-pinkie-reduce-motion\] \.pk-metre-board, html\[data-pinkie-reduce-motion\] \.pk-metre-board :is\(\.is-new, \.is-moving\) \{ animation: none !important; \}/);
  assert.match(skin, /\[data-pinkie-reduce-motion\] :is\(\[data-metre-pop\], [^)]*\), [^{]*\[data-pinkie-reduce-motion\] \.pk-metre-kw::after \{ animation: none !important; \}/);
  assert.match(skin, /@media \(prefers-reduced-motion: reduce\) \{\n  \.pk-metre-board, \.pk-metre-board :is\(\.is-new, \.is-moving\) \{ animation: none !important; \}/);
  const board = read(INJ + 'laolao-metre-board.js');
  assert.match(board, /if \(reduced\(\)\) done\(\); else \{ page\.classList\.add\('is-leaving'\); leaveTimer = setTimeout\(done, 300\); \}/, '先滑出去再藏');
  assert.match(board, /get isOpen\(\) \{ return Boolean\(page && !page\.hidden && !page\.classList\.contains\('is-leaving'\)\); \}/);
  const data = read(INJ + 'laolao-metre-board-data.js');
  assert.match(data, /block\.style\.setProperty\('--mb-s'/, '声部条从上一次的位置长过去');
  assert.match(data, /now\$\.style\.setProperty\('--mb-dx'/, '「现在」那条线移过去');
  assert.match(data, /prevEvents && !prevEvents\.has\(key\) \? 'is-new'/, '新的小节淡入');
  assert.match(read(INJ + 'laolao-metre-home.js'), /line\.style\.setProperty\('--metre-reveal', Math\.round\(list\.length \* step \+ 320\) \+ 'ms'\)/);
});

// ---------- 11-23 整页进场 / 换页（用户：「整页的进场和换页动画，像 Son Daven」） ----------
test('Metre 11-24 page moments: the count-in lifts the baton and lands the score on the downbeat; a session switch turns the page; home lights and the melodic prompt are called directly; a low band keeps only a staff; reduced motion has none', () => {
  const transition = read(INJ + 'laolao-metre-transition.js');
  assert.doesNotMatch(transition, /LaolaoMetreCat/, '小猫去掉了（用户 11-23）');
  assert.match(transition, /const COVER = 320, LIFT = 620, ICTUS = 1097, [^;]*HOLD = 1600, OPEN = 380;/, '总长约 1.98 秒，和第六版差不多');
  assert.match(transition, /if \(!alive\) return;\n      window\.dispatchEvent\(new CustomEvent\('pinkie:metre-sweep'/, '翻开时告诉页面');
  assert.match(read(INJ + 'laolao-head.fragment.html'), /<script defer src="\/laolao-metre-stagefx\.js\?v=@hash"><\/script>/);
  const fx = read(INJ + 'laolao-metre-stagefx.js');
  assert.doesNotMatch(fx.replace(/\/\*[\s\S]*?\*\//g, ''), /setInterval|MutationObserver|window\.__/, '不加定时器循环、观察器、全局名');
  assert.match(fx, /while \(\(t = performance\.now\(\) - t0\) < 580\)/, '翻谱 ≤ 600ms');
  assert.match(fx, /src\.dataset\.podX/, '指挥台位置读 backdrop 的锚点');
  for (const f of ['turn', 'lights', 'melody']) assert.match(fx, new RegExp('function ' + f + '\\([^)]*\\) \\{[\\s\\S]{0,240}reduced\\(\\)'), f + '：减少动效时不做');
  const home = read(INJ + 'laolao-metre-home.js');
  assert.match(home, /window\.addEventListener\('pinkie:metre-sweep', \(\) => enter\(false\)\);/);
  assert.match(home, /window\.addEventListener\('pinkie:session-selected', onSwitch\);/);
  assert.match(home, /if \(!isMetre\(\) \|\| reduced\(\) \|\| document\.querySelector\('\.pk-metre-transition'\)\) return; if \(window\.PinkieMetreStage\) \{ void window\.PinkieMetreStage\.turn\(/, '换会话 = 翻谱；预备拍盖着时不另做');
  assert.match(home, /window\.PinkieMetreStage\?\.lights\(\)/);
  assert.match(home, /window\.PinkieMetreStage\?\.melody\(line\)/);
  assert.doesNotMatch(home, /setInterval|requestAnimationFrame|new MutationObserver|'pk-metre-sweep'/);
  const backdrop = read(INJ + 'laolao-metre-backdrop.js');
  assert.match(backdrop, /Math\.max\(144, window\.innerHeight/, '首页画带最矮 144px');
  assert.match(backdrop, /const lowBand = home && bandCss < 180;/, '矮于 180px 只留五线谱');
  assert.match(backdrop, /canvas\.dataset\.podX = String\(scene\.anchors\.podX\);/);
  const skin = read(INJ + 'laolao-metre-skin.css');
  assert.doesNotMatch(skin, /pk-metre-bars|pk-metre-sweep/, '竖条显出和指挥线让给翻谱');
  assert.match(skin, /\[data-metre-band-low\] canvas\.pk-metre-backdrop \{ visibility: hidden; \}/);
  assert.match(skin, /\[data-metre-enter="home"\] \.agent-chat__input \{ animation: pk-metre-rise 417ms [^;]* 417ms backwards; \}/, '输入框第二个八分音符浮起');
  assert.match(skin, /@media \(prefers-reduced-motion: reduce\) \{\n  [^\n]*\[data-metre-enter\] :is\(\.pk-metre-prompt__head, \.agent-chat__input, \.agent-chat__composer-controls\) \{ animation: none !important; \}/);
});

test('Metre 11-24 keys and backstage: one key language with every state in day and night, and a backstage band fed only by existing events and methods', () => {
  const head = read(INJ + 'laolao-head.fragment.html');
  assert.match(head, /<link rel="stylesheet" href="\/laolao-metre-keys\.css\?v=@hash">\n<script defer src="\/laolao-metre-backstage\.js\?v=@hash"><\/script>/);
  const keys = read(INJ + 'laolao-metre-keys.css');
  for (const state of [':hover:not(:disabled)', ':active:not(:disabled)', ':focus-visible', ':is(:disabled, [aria-disabled="true"])', '[aria-busy="true"]']) assert.ok(keys.includes(state), '按键状态：' + state);
  assert.match(keys, /animation: pk-mk-beat 833ms steps\(1, end\) infinite;/, '运行中的拍子线按 ♩=72');
  assert.match(keys, /@media \(prefers-reduced-motion: reduce\)/); assert.match(keys, /\[data-pinkie-reduce-motion\]/);
  assert.match(keys, /:is\(\[data-theme="dark"\], \[data-pinkie-night\]\) \{ --mk-wait: /, '日夜两套');
  assert.doesNotMatch(keys, /!important/);
  for (const rule of keys.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{/g)) {
    const sel = rule.slice(0, -1).trim();
    if (!sel || sel.startsWith('@') || /^(\d+%|from|to)$/.test(sel)) continue;
    assert.ok(/html\[data-laolao-mode="metre"\]/.test(sel) || sel === '.pk-metre-backstage', '只在 Metre 下：' + sel);
  }
  const band = read(INJ + 'laolao-metre-backstage.js');
  const code = band.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /setInterval|MutationObserver|window\.__\w+\s*=[^=]/, '不加定时器、观察器、全局名');
  assert.match(code, /window\.addEventListener\('pinkie:run-view', render\);/, '刷新挂在 run-status 已有的节拍上');
  assert.match(code, /UNSYNC_MS = 3000/, '两边不一致超过 3 秒才算不同步');
  assert.match(code, /rpc\('pinkie\.engines\.status'/); assert.match(code, /__pinkieMetreBoardData\?\.data/); assert.match(code, /__pinkieRunStatus\?\.refresh/);
  assert.match(code, /reloadHistory|chat\.history/, '同步 = 重拉 chat.history');
  assert.match(code, /if \(!isMetre\(\)\) \{ if \(band\) band\.hidden = true; root\.removeAttribute\('data-metre-bs'\); closePop\(\); return; \}/, '只在 Metre 出现');
  // 11-24 验收第 1、2 条：带子在输入框正下方那一条（对话滚不到那里），宽度 = 输入框宽度，每一格按最长的字定宽，首页和窄窗口的总谱浮层时不出现
  assert.match(code, /const top = window\.innerHeight - BOTTOM - 24;/, '输入框正下方、离窗口下沿固定 8px'); assert.match(code, /const BOTTOM = 8;/);
  assert.match(keys, /\[data-metre-bs\] \.agent-chat__composer-shell \{ margin-bottom: 24px; \}/, '输入框那一栏让出这一条');
  assert.match(code, /width: Math\.round\(r\.width\) \+ 'px'/, '宽度跟输入框走，不跟状态走');
  assert.match(code, /n\.style\.width = widths\[tier\]\[n\.dataset\.seg\] \+ 'px'/, '每一格定宽');
  assert.match(code, /if \(!r \|\| r\.width < 280 \|\| onHome\(\) \|\| root\.getAttribute\('data-metre-board'\) === 'overlay'\)/, '首页、总谱浮层时不出现');
  assert.match(code, /short: .引擎 \$\{voices\.length\}., pop: true/, '声部多了收成总数，点开看明细');
  assert.match(keys, /\.shell:not\(\.shell--nav-drawer-open\) > \.shell-nav-backdrop \{ display: none; \}/, '收着的导航遮罩不占位置');
  assert.match(keys, /\[data-metre-board="overlay"\] :is\(\.agent-chat__input, \.pk-run, \.pk-metre-cat--full\) \{ visibility: hidden; \}/, '浮层总谱打开时输入框让位');
  assert.match(read(INJ + 'laolao-metre-board.js'), /page\.style\.bottom = 'var\(--metre-bs-room, 0px\)';/);
  // 第 5 条：日夜每一格字对底 ≥ 4.5:1、色块对底 ≥ 3:1
  const lum = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((m, n) => n - m); return (hi + 0.05) / (lo + 0.05); };
  for (const block of [/html\[data-laolao-mode="metre"\] \{\n  --bs-chip[^}]*\}/, /:is\(\[data-theme="dark"\], \[data-pinkie-night\]\) \{\n  --bs-chip[^}]*\}/]) {
    const css = keys.match(block)[0], v = (name) => css.match(new RegExp('--bs-' + name + ': (#[0-9A-F]{6})'))[1];
    for (const t of ['ink', 'muted', 'run-t', 'wait-t', 'fail-t']) assert.ok(ratio(v(t), v('chip')) >= 4.5, t + ' 字对底 ≥ 4.5:1');
    for (const q of ['run', 'wait', 'fail', 'ok', 'off']) assert.ok(ratio(v(q), v('chip')) >= 3, q + ' 色块对底 ≥ 3:1');
  }
  assert.match(keys, /\.pk-metre-backstage:not\(\[hidden\]\) \{[^}]*gap: 6px;/, '格与格之间有间距');
});

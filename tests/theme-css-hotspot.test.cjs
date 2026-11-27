// 热点 30（ui/injections/laolao-theme.css）复发锁：近 60 天修复里此前没有测试会在「只回退该修复」时变红的部分。
//   afb38b98 运行中多出的「立即追加」/ 停止 / 发送跨 9–12 列靠右，输入框下面的控件不再随运行状态挪位。
//   c092fc4b / 546c0356 断线只留碧琪顶部提示（原生胶囊与黄色 callout 隐藏，真错误照常显示）；
//                       「立即追加」按钮只在运行中出现、文字走 data-pinkie-followup-label；窄栏排法不再按窗口宽度拆三行。
//   86d04f2e 雾板变量与两行输入框栅格（12 列、输入盒占第 1 行）。
//   0b60aa41 档位光晕不再用盖在文字上的 ::before 层（规则已迁去 laolao-model-picker.css，这里锁住不回流）。
// 已有测试锁住、这里不重复的：d7c99f35（tests/desktop-apps.test.mjs）、943df29a→a2514d6e（tests/ui-d-sweep.test.cjs）、
//   d60a3070/0b60aa41 在 laolao-model-picker.css 里的部分（tests/model-picker.test.cjs）。
// 纯静态：读 CSS 文本，用最小解析器拆规则、算优先级，不启动浏览器，不改产品代码。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const THEME = 'ui/injections/laolao-theme.css';

/* ── 最小 CSS 解析 ──────────────────────────────────────────────────────── */

// 找到与 open 处括号配对的位置（跳过字符串）。
function closeParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'") { i = s.indexOf(ch, i + 1); continue; }
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}

// 在括号 / 字符串之外按分隔符切开。
function splitTop(s, sep) {
  const out = [];
  let depth = 0, last = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'") { i = s.indexOf(ch, i + 1); continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === sep && depth === 0) { out.push(s.slice(last, i)); last = i + 1; }
  }
  out.push(s.slice(last));
  return out.map((x) => x.trim()).filter(Boolean);
}

function parseDecls(body) {
  return splitTop(body, ';').map((d) => {
    const colon = d.indexOf(':');
    if (colon < 0) return null;
    let value = d.slice(colon + 1).trim();
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
    return {prop: d.slice(0, colon).trim(), value, important};
  }).filter(Boolean);
}

// 返回规则列表：{selector, selectors, decls, at（外层 @ 规则头）, order}。
function parseCss(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = [];
  let headStart = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'") { i = src.indexOf(ch, i + 1); continue; }
    if (ch === ';' && (!stack.length || stack[stack.length - 1].at)) headStart = i + 1;
    if (ch === '{') {
      const head = src.slice(headStart, i).trim();
      stack.push({head, at: head.startsWith('@'), start: i + 1});
      headStart = i + 1;
    } else if (ch === '}') {
      const frame = stack.pop();
      if (frame && !frame.at) {
        rules.push({
          selector: frame.head,
          selectors: splitTop(frame.head, ','),
          decls: parseDecls(src.slice(frame.start, i)),
          at: stack.filter((f) => f.at).map((f) => f.head),
          order: rules.length,
        });
      }
      headStart = i + 1;
    }
  }
  return rules;
}

function skipIdent(s, i) { while (i < s.length && /[\w-]/.test(s[i])) i++; return i; }
function cmp(a, b) { for (let k = 0; k < 3; k++) if (a[k] !== b[k]) return a[k] - b[k]; return 0; }

// 选择器优先级 [id, class/属性/伪类, 类型/伪元素]；:is/:not/:has 取参数里最大的，:where 记 0。
function specificity(sel) {
  const sp = [0, 0, 0];
  const add = (x) => { sp[0] += x[0]; sp[1] += x[1]; sp[2] += x[2]; };
  const max = (list) => list.map(specificity).reduce((m, x) => (cmp(x, m) > 0 ? x : m), [0, 0, 0]);
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === '#') { sp[0]++; i = skipIdent(sel, i + 1) - 1; }
    else if (ch === '.') { sp[1]++; i = skipIdent(sel, i + 1) - 1; }
    else if (ch === '[') { sp[1]++; i = sel.indexOf(']', i); }
    else if (ch === ':') {
      if (sel[i + 1] === ':') { sp[2]++; i = skipIdent(sel, i + 2) - 1; continue; }
      const end = skipIdent(sel, i + 1);
      const name = sel.slice(i + 1, end);
      if (sel[end] === '(') {
        const close = closeParen(sel, end);
        const args = splitTop(sel.slice(end + 1, close), ',');
        if (['is', 'not', 'has', 'matches'].includes(name)) add(max(args));
        else if (name !== 'where') sp[1]++;
        i = close;
      } else {
        sp[1]++;
        i = end - 1;
      }
    } else if (/[a-zA-Z]/.test(ch)) { sp[2]++; i = skipIdent(sel, i) - 1; }
  }
  return sp;
}

// 选择器最后一个复合选择器（真正被命中的那个元素）。
function lastCompound(sel) {
  let depth = 0, last = 0;
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && /[\s>+~]/.test(ch)) last = i + 1;
  }
  return sel.slice(last).trim();
}

const rules = parseCss(read(THEME));
const topLevel = rules.filter((r) => r.at.length === 0);
const decl = (rule, prop) => [...rule.decls].reverse().find((d) => d.prop === prop);

function findRule(selector, list = topLevel) {
  const hit = list.filter((r) => r.selectors.includes(selector));
  assert.ok(hit.length, `${THEME} 里找不到规则：${selector}`);
  return hit[hit.length - 1];
}

// 断言 fix 规则里的 !important 声明不会被同一元素上其他 !important 规则盖掉
// （优先级更高，或同优先级但排在后面，都算盖掉）。
function assertNotOverridden(fixRule, fixSelector, prop, targets, fixProp = prop) {
  const fix = decl(fixRule, fixProp);
  assert.ok(fix && fix.important, `${fixSelector} 应带 ${fixProp} !important`);
  const fixSp = specificity(fixSelector);
  for (const r of topLevel) {
    if (r === fixRule) continue;
    const d = decl(r, prop);
    if (!d || !d.important || (prop === fixProp && d.value === fix.value)) continue;
    for (const s of r.selectors) {
      if (!targets(lastCompound(s))) continue;
      const c = cmp(specificity(s), fixSp);
      assert.ok(c < 0 || (c === 0 && r.order < fixRule.order),
        `${fixProp}: ${fix.value} 被别的规则盖掉：${s} { ${prop}: ${d.value} !important }`);
    }
  }
}

test('解析器自检：优先级与最后复合选择器', () => {
  assert.deepEqual(specificity('html:not([data-x]) .a :is(button.b, button.c):not(#p1):not(#p2)'), [2, 3, 2]);
  assert.deepEqual(specificity('html:is([data-w], :has(.cb)) section.card.chat > .callout:not(.danger)'), [0, 5, 2]);
  assert.deepEqual(specificity('.m:where(.x) .t::before'), [0, 2, 1]);
  assert.equal(lastCompound('html .a:has(.b c) > button.d:not(.e f)'), 'button.d:not(.e f)');
  assert.ok(topLevel.length > 500, `解析出的顶层规则太少（${topLevel.length}），解析器可能坏了`);
});

/* ── afb38b98：运行中按钮跨 9–12 列，不撑宽第 12 列 ─────────────────────── */

test('运行中的发送 / 停止 /「立即追加」跨 9 / -1 列且不被其他 !important 列号盖掉 (afb38b98)', () => {
  const sel = 'html:not([data-laolao-plain-composer]) .agent-chat__input :is(button.chat-send-btn, button.laolao-followup-mode-btn):not(#__p1):not(#__p2):not(#__p3)';
  const rule = findRule(sel);
  assert.equal(decl(rule, 'grid-column').value, '9 / -1');
  // 原来「立即追加」用 grid-column: 12 !important（0,4,2），发送按钮也钉在 12 列，按钮一多就把第 12 列撑宽、
  // 下面一行的模型 / 思考强度 / 容量圈跟着挪位。修复靠三个 :not(#…) 压过它们。
  const targets = (c) => /(^|button)\.(chat-send-btn|laolao-followup-mode-btn)/.test(c) && !c.includes('::');
  assertNotOverridden(rule, sel, 'grid-column', targets);
  const followup = findRule('html:not([data-laolao-plain-composer]) .agent-chat__input:has(.chat-send-btn--stop) button.laolao-followup-mode-btn');
  assert.equal(decl(followup, 'grid-column').value, '12', '前提：「立即追加」自己仍写着 12 列，靠修复规则覆盖');
  assert.ok(cmp(specificity(sel), specificity(followup.selectors[0])) > 0, '修复规则必须压过「立即追加」自己的 grid-column: 12');
});

test('运行中且有「立即追加」时输入文字给按钮让出 120px，不被后来的 padding 盖掉 (afb38b98)', () => {
  const sel = 'html:not([data-laolao-plain-composer]) .agent-chat__input:has(.chat-send-btn--stop):has(button.laolao-followup-mode-btn) .agent-chat__composer-combobox';
  const rule = findRule(sel);
  assert.equal(decl(rule, 'padding-right').value, '120px');
  const targets = (c) => c.includes('agent-chat__composer-combobox') && !/textarea|::/.test(c);
  assertNotOverridden(rule, sel, 'padding-right', targets);
  assertNotOverridden(rule, sel, 'padding', targets, 'padding-right');
});

/* ── c092fc4b / 546c0356：断线提示去重 ─────────────────────────────────── */

test('断线时原生「Gateway 连接已断开」胶囊隐藏，只留碧琪顶部提示 (c092fc4b)', () => {
  const sel = 'html[data-laolao-watchdog-state] .connection-banner';
  const rule = findRule(sel);
  assert.equal(decl(rule, 'display').value, 'none');
  assertNotOverridden(rule, sel, 'display', (c) => c.includes('connection-banner'));
});

test('聊天区重复的黄色断线 callout 隐藏，但 danger / info / warn / success 真提示不受影响 (c092fc4b)', () => {
  const rule = topLevel.find((r) => r.selectors.some((s) => s.includes('section.card.chat > .callout')
    && s.startsWith('html:is([data-laolao-watchdog-state], :has(.connection-banner))')));
  assert.ok(rule, '找不到隐藏重复断线 callout 的规则');
  const sel = rule.selectors.find((s) => s.includes('section.card.chat > .callout'));
  for (const kind of ['danger', 'info', 'warn', 'success']) {
    assert.ok(lastCompound(sel).includes(`:not(.${kind})`), `.callout.${kind} 是真提示，不能一起被藏掉`);
  }
  assert.equal(decl(rule, 'display').value, 'none');
  assert.ok(decl(rule, 'display').important);
});

/* ── c092fc4b / 546c0356：「立即追加」按钮 ─────────────────────────────── */

const FOLLOWUP_BASE = 'html:not([data-laolao-plain-composer]) .agent-chat__input button.laolao-followup-mode-btn';
const FOLLOWUP_RUNNING = 'html:not([data-laolao-plain-composer]) .agent-chat__input:has(.chat-send-btn--stop) button.laolao-followup-mode-btn';

test('「立即追加」平时隐藏、只在有停止按钮（运行中）时出现，文字来自 data-pinkie-followup-label (c092fc4b/546c0356)', () => {
  const base = findRule(FOLLOWUP_BASE);
  assert.equal(decl(base, 'display').value, 'none');
  assert.ok(decl(base, 'display').important);
  const running = findRule(FOLLOWUP_RUNNING);
  assert.equal(decl(running, 'display').value, 'inline-flex');
  assert.ok(decl(running, 'display').important);
  assert.ok(cmp(specificity(FOLLOWUP_RUNNING), specificity(FOLLOWUP_BASE)) > 0, '运行中规则必须压过默认隐藏');
  // 不能有别的 !important display 规则以更高优先级把它再藏起来或提前露出来。
  for (const r of topLevel) {
    const d = decl(r, 'display');
    if (!d || !d.important || r === base || r === running) continue;
    for (const s of r.selectors) {
      const c = lastCompound(s);
      if (!c.includes('laolao-followup-mode-btn') || c.includes('::')) continue;
      assert.ok(cmp(specificity(s), specificity(FOLLOWUP_RUNNING)) < 0, `「立即追加」的显示状态被盖掉：${s}`);
    }
  }
  const label = findRule(`${FOLLOWUP_BASE}::before`);
  assert.equal(decl(label, 'content').value, 'attr(data-pinkie-followup-label)');
  const queue = findRule(`${FOLLOWUP_BASE}[data-pinkie-followup-mode="queue"]`);
  assert.match(decl(queue, 'background').value, /color-mix\(in srgb, var\(--accent\) 20%, #fff\)/, '排队态要和立即态区分开');
  const night = findRule('html[data-pinkie-night]:not([data-laolao-plain-composer]) .agent-chat__input:has(.chat-send-btn--stop) button.laolao-followup-mode-btn');
  assert.match(decl(night, 'color').value, /color-mix\(in srgb, var\(--accent\) 75%, #fff\)/, '夜间文字用浅色');
});

test('窄聊天栏不再按窗口宽度另拆三行，排法交给 laolao-ui-subtraction.css 的 @container pinkiechat (c092fc4b)', () => {
  const stray = rules.filter((r) => r.at.some((a) => /^@media\b.*max-width:\s*640px/.test(a))
    && r.selectors.some((s) => s.includes('.agent-chat__input')));
  assert.deepEqual(stray.map((r) => r.selector), [], '旧的 @media (max-width: 640px) 输入框三行排法回来了');
  assert.match(read('ui/injections/laolao-ui-subtraction.css'), /@container pinkiechat\b/);
});

/* ── 86d04f2e：雾板变量与两行输入框 ────────────────────────────────────── */

test('雾板变量在 html:not([data-laolao-plain-composer]) 上定义并跟随模式色，文件里用到的 --fog-* 都有定义 (86d04f2e)', () => {
  const root = findRule('html:not([data-laolao-plain-composer])');
  const defined = new Map(root.decls.filter((d) => d.prop.startsWith('--fog-')).map((d) => [d.prop, d.value]));
  for (const name of ['--fog-tint', '--fog-deep', '--fog-line', '--fog-line-soft']) {
    assert.match(defined.get(name) || '', /^color-mix\(in srgb, var\(--accent\) \d+%, /, `${name} 要从 --accent 混出来`);
  }
  assert.match(defined.get('--fog-ink') || '', /var\(--text-strong\)/);
  assert.match(defined.get('--fog-muted') || '', /var\(--muted\)/);
  const used = new Set([...read(THEME).matchAll(/var\((--fog-[\w-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((name) => !defined.has(name));
  assert.deepEqual(missing, [], `用到了却没定义的雾板变量：${missing.join(', ')}`);
});

test('输入框是 12 列两行栅格：输入盒占第 1 行，停止在第 12 列，外层包装 display: contents (86d04f2e)', () => {
  const grid = findRule('html:not([data-laolao-plain-composer]) .agent-chat__input');
  assert.equal(decl(grid, 'display').value, 'grid');
  const tracks = decl(grid, 'grid-template-columns').value;
  assert.equal(tracks, 'repeat(8, auto) minmax(0, 1fr) auto auto auto', '12 列：前 8 列按钮、第 9 列弹性、10–12 模型 / 思考 / 容量');
  const box = findRule('html:not([data-laolao-plain-composer]) .agent-chat__input::before');
  assert.equal(decl(box, 'grid-row').value, '1');
  assert.equal(decl(box, 'grid-column').value, '1 / -1');
  const combo = findRule('html:not([data-laolao-plain-composer]) .agent-chat__composer-combobox');
  assert.equal(decl(combo, 'grid-row').value, '1');
  assert.equal(decl(combo, 'grid-column').value, '1 / 12');
  const stopSel = 'html:not([data-laolao-plain-composer]) .agent-chat__input button.chat-send-btn.chat-send-btn--stop.chat-send-btn--stop:not(#__p1):not(#__p2)';
  const stop = topLevel.filter((r) => r.selectors.includes(stopSel));
  assert.ok(stop.some((r) => decl(r, 'grid-column')?.value === '12' && decl(r, 'grid-row')?.value === '1'), '停止按钮和发送同在输入盒右侧');
  const wrappers = topLevel.find((r) => r.selectors.some((s) => s.startsWith('html:not([data-laolao-plain-composer]) .agent-chat__input :is(.agent-chat__composer-input-row')));
  assert.ok(wrappers && decl(wrappers, 'display')?.value === 'contents' && decl(wrappers, 'display').important, '外层包装必须 display: contents，子控件才进得了栅格');
  for (const s of ['.chat-avatar.user', '.chat-group-footer .chat-sender-name']) {
    assert.equal(decl(findRule(`html:not([data-laolao-plain-composer]) ${s}`), 'display').value, 'none', `${s} 不再重复显示`);
  }
});

/* ── 0b60aa41：档位光晕不再盖住文字 ────────────────────────────────────── */

test('主题样式里不再出现盖在档位文字上的 .pinkie-external-tier::before 光晕层 (0b60aa41)', () => {
  const back = rules.filter((r) => r.selectors.some((s) => /\.pinkie-external-tier::before\b/.test(s)));
  assert.deepEqual(back.map((r) => r.selector), [], '::before 光晕层回到了 laolao-theme.css');
  const isolated = rules.filter((r) => r.selectors.some((s) => lastCompound(s).includes('pinkie-external-tier'))
    && decl(r, 'isolation')?.value === 'isolate');
  assert.deepEqual(isolated.map((r) => r.selector), [], '档位文字重新建了 isolation 层');
});

/* ── 对比度（只做下限，不放宽也不硬造）────────────────────────────────── */

function parseColor(v, accent) {
  v = v.trim();
  if (v === 'var(--accent)') return parseColor(accent, accent);
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16)).concat(1);
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  m = v.match(/^color-mix\(in srgb,\s*(.+)\)$/);
  if (m) {
    const [a, b] = splitTop(m[1], ',');
    const pa = /\s(\d+)%$/.exec(a), pb = /\s(\d+)%$/.exec(b);
    const wa = pa ? pa[1] / 100 : 1 - pb[1] / 100;
    const wb = pb ? pb[1] / 100 : 1 - wa;
    const ca = parseColor(a.replace(/\s\d+%$/, ''), accent), cb = parseColor(b.replace(/\s\d+%$/, ''), accent);
    const alpha = ca[3] * wa + cb[3] * wb;
    return [0, 1, 2].map((k) => (ca[k] * ca[3] * wa + cb[k] * cb[3] * wb) / alpha).concat(alpha);
  }
  throw new Error(`解析不了颜色：${v}`);
}
const over = (c, bg) => [0, 1, 2].map((k) => c[k] * c[3] + bg[k] * (1 - c[3]));
const lum = (c) => c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; })
  .reduce((s, x, k) => s + x * [0.2126, 0.7152, 0.0722][k], 0);
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const accents = topLevel.map((r) => [/^html\[data-laolao-mode="(\w+)"\]$/.exec(r.selector)?.[1], decl(r, '--accent')?.value])
  .filter(([mode, accent]) => mode && accent);

function followupContrast(accent) {
  const running = findRule(FOLLOWUP_RUNNING);
  // 白天背景近似为白色输入盒（::before 顶部 rgba(255,255,255,.96)），半透明胶囊叠在它上面。
  const bg = over(parseColor(decl(running, 'background').value, accent), [255, 255, 255]);
  const ink = over(parseColor(decl(running, 'color').value, accent), bg);
  return contrast(ink, bg);
}

test('白天「立即追加」胶囊文字对比度至少 3:1（各模式强调色都算一遍）(c092fc4b)', (t) => {
  assert.ok(accents.length >= 4, `模式强调色解析不全：${JSON.stringify(accents)}`);
  for (const [mode, accent] of accents) {
    const ratio = followupContrast(accent);
    t.diagnostic(`${mode} ${accent} → ${ratio.toFixed(2)}:1`);
    assert.ok(ratio >= 3, `${mode} 模式「立即追加」文字对比度只有 ${ratio.toFixed(2)}:1`);
  }
});

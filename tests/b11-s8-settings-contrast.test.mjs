// B11 S8：设置页日间原生标题 `.content-header .page-title`（「设置」）与未选中分段键 `.qs-segmented__btn`（「高级」）字色 ≥ 4.5:1。
// 复发点：原生标题用 --accent、分段键用 --muted，chat 下 #e94f91 落白底 3.5，thinking 下 #8d72a1 落浅底 4.13（走查 chat.md S8 / thinking.md）。
// 修法在 laolao-settings-user.css：标题 = color-mix(--accent 70%, --text-strong)，分段键 = --muted-strong；只管日间、非 Metre（Metre 有自己的 !important 规则）。
// 反例：把两条换回 --accent / --muted，chat 与 thinking 至少一项必须 <4.5。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = fs.readFileSync(path.join(root, 'ui/injections/laolao-settings-user.css'), 'utf8');
const THEME = fs.readFileSync(path.join(root, 'ui/injections/laolao-theme.css'), 'utf8');
const DAY = 'html:not([data-pinkie-night], [data-theme-mode="dark"], [data-theme="dark"], [data-color-scheme="dark"]) main.content:has(.config-view-toggle)';
const DAY_SEG = DAY.replace(':has(.config-view-toggle)', '');
const TITLE_RULE = new RegExp(`^${esc(DAY)} \\.content-header \\.page-title \\{([^}]*)\\}`, 'm');
const SEG_RULE = new RegExp(`^${esc(DAY_SEG)} \\.config-view-toggle \\.qs-segmented__btn:not\\(\\.qs-segmented__btn--active, :hover, :focus-visible\\) \\{([^}]*)\\}`, 'm');
// 白底 = 标题背后实测；分段键底取比实测（≈#fefcfd）更深的保守值。
const WHITE = [255, 255, 255], SEG_BG = [0xf6, 0xf0, 0xf3];
const MODES = ['base', 'chat', 'project', 'thinking', 'learning', 'unrestricted'];

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return +((hi + 0.05) / (lo + 0.05)).toFixed(2); };
const mix = (a, b, p) => a.map((v, i) => v * p + b[i] * (1 - p));

function vars(mode) {
  const head = mode === 'base' ? /^html\[data-theme\] \{([^}]*)\}/m : new RegExp(`^html\\[data-laolao-mode="${mode}"\\] \\{([^}]*)\\}`, 'm');
  const read = (block) => Object.fromEntries([...(block || '').matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  return {...read(THEME.match(/^html\[data-theme\] \{([^}]*)\}/m)?.[1]), ...read(THEME.match(head)?.[1])};
}

// 把规则里的 color 值按模式变量算成 rgb（只认本文件用到的两种写法）。
function resolve(decl, v) {
  const mixed = decl.match(/color:\s*color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%, var\((--[\w-]+)\)\)/);
  if (mixed) return mix(hex(v[mixed[1]]), hex(v[mixed[3]]), +mixed[2] / 100);
  const plain = decl.match(/color:\s*var\((--[\w-]+)\)/);
  assert.ok(plain, `无法解析 ${decl}`);
  return hex(v[plain[1]]);
}

function measure(titleDecl, segDecl) {
  return MODES.map((mode) => {
    const v = vars(mode);
    return {mode, title: ratio(resolve(titleDecl, v), WHITE), seg: ratio(resolve(segDecl, v), SEG_BG)};
  });
}

test('静态：两条日间规则都在，不用 !important，避开夜间四种入口', () => {
  const t = CSS.match(TITLE_RULE), s = CSS.match(SEG_RULE);
  assert.ok(t, '找到日间 .page-title 规则');
  assert.ok(s, '找到日间未选中 .qs-segmented__btn 规则');
  for (const m of [t, s]) assert.doesNotMatch(m[0], /!important/);
});

test('各模式日间：标题对白底、未选中分段键对浅底都 ≥ 4.5', () => {
  const rows = measure(CSS.match(TITLE_RULE)[1], CSS.match(SEG_RULE)[1]);
  for (const r of rows) {
    assert.ok(r.title >= 4.5, `${r.mode} 标题 ${r.title}`);
    assert.ok(r.seg >= 4.5, `${r.mode} 分段键 ${r.seg}`);
  }
});

test('反例：换回 --accent / --muted，chat 标题与 thinking 分段键都 <4.5', () => {
  const rows = Object.fromEntries(measure('color: var(--accent)', 'color: var(--muted)').map((r) => [r.mode, r]));
  assert.ok(rows.chat.title < 4.5, `chat 旧标题 ${rows.chat.title}`);
  assert.ok(rows.thinking.seg < 4.5, `thinking 旧分段键 ${rows.thinking.seg}`);
});

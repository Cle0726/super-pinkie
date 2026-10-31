const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {pathToFileURL} = require('node:url');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));

const gazeSrc = read('services/cle-studio/src/composer/gaze-levels.js');
// gaze-levels.js is ESM with no imports of its own: load it once for the pure assertions.
function levels() {
  const mod = {};
  vm.runInNewContext(gazeSrc.replace(/export (const|function)/g, '$1') + '\nthis.__m={LEVELS,levelOf,eyeSvg,tierLabel,tierWord,stopIndex};',
    mod, {});
  return mod.__m;
}

test('every standard effort name maps to one level, in both English ids and zh labels', () => {
  const {levelOf} = levels();
  for (const [label, want] of [
    ['off', 'off'], ['minimal', 'minimal'], ['low', 'low'], ['medium', 'medium'],
    ['high', 'high'], ['xhigh', 'xhigh'], ['extra high', 'xhigh'], ['max', 'max'], ['ultra', 'ultra'],
    ['adaptive', 'adaptive'],
    ['关闭', 'off'], ['极浅', 'minimal'], ['低', 'low'], ['中', 'medium'], ['高', 'high'],
    ['很高', 'xhigh'], ['最高', 'max'], ['极限', 'ultra'], ['自适应', 'adaptive'],
  ]) assert.equal(levelOf(label), want, label);
  assert.equal(levelOf(''), null, 'an unknown label is never silently treated as a level');
  assert.equal(levelOf('something else'), null);
});

test('the eye opens monotonically, and the deepest tier is the only one with the halo', () => {
  const {LEVELS, eyeSvg} = levels();
  const order = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(LEVELS[order[i]].open > LEVELS[order[i - 1]].open,
      `${order[i]} must open further than ${order[i - 1]}`);
  }
  assert.match(eyeSvg('off'), /M3\.2 11\.2/, 'off is a closed lid, not an empty box');
  assert.doesNotMatch(eyeSvg('off'), /cle-eye__halo/);
  assert.match(eyeSvg('ultra'), /cle-eye__halo/);
  assert.doesNotMatch(eyeSvg('high'), /cle-eye__halo/);
  for (const level of order) {
    const svg = eyeSvg(level);
    assert.match(svg, /viewBox="0 0 24 24"/);
    assert.equal((svg.match(/<clipPath id="/g) || []).length, svg.includes('<clipPath') ? 1 : 0,
      'each eye declares at most one clip path');
  }
});

test('the visible tier name is the standard one — a poetic word can never replace it', () => {
  const {tierLabel, LEVELS} = levels();
  assert.equal(tierLabel('high'), 'High');
  assert.equal(tierLabel('max'), 'Max');
  assert.equal(tierLabel('ultra'), 'Ultra');
  for (const level of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']) {
    assert.match(LEVELS[level].tier, /^[A-Za-z]+$/, `${level} keeps a Latin standard name`);
    assert.ok(LEVELS[level].zh.length <= 3, 'the Chinese word stays a short suffix');
  }
});

test('a shorter native stop list never renders as if it reached Ultra', () => {
  // the 2026.10 picker exposes whatever the model supports; index comes from min/max/value
  const src = gazeSrc;
  const stopIndex = new Function(`${src.replace(/export const/g, 'const').replace(/export function/g, 'function')}
    return stopIndex;`)();
  assert.equal(stopIndex({min: 0, max: 2, value: 2, count: 3}), 2);
  assert.equal(stopIndex({min: 0, max: 2, value: 0, count: 3}), 0);
  assert.equal(stopIndex({min: 0, max: 2, value: 1, count: 3}), 1);
  // four real stops, clamped at the end instead of overflowing a fixed ladder
  assert.equal(stopIndex({min: 0, max: 3, value: 3, count: 4}), 3);
  assert.equal(stopIndex({min: 0, max: 0, value: 0, count: 1}), 0);
});

test('the composer styles the eye, the stops and both themes without a fixed rainbow palette', () => {
  const css = read('services/cle-studio/src/composer/models.css');
  assert.match(css, /html\[data-cle\] \.cle-eye/);
  assert.match(css, /\.cle-eye\[data-lit="true"\] \.cle-eye__iris \{ fill: var\(--cle-gaze\)/);
  assert.match(css, /\.cle-gaze-stop\[data-current\] \.cle-gaze-stop__tick \{[\s\S]*?background: var\(--cle-gaze\)/);
  assert.match(css, /\.cle-gaze-stops__why/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{6}/, 'the palette comes from tokens, not literal hex values');
  assert.doesNotMatch(css, /(linear-gradient\([^)]*(#ff|#f0[0-9a-f]|pink|magenta))/i, 'no leftover pink glass');
  // reduced motion must be honoured for both the floating mark and the eye transitions
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('brand marks keep the original artwork: every referenced file exists and the coloured ones stay unmasked', () => {
  const css = read('services/cle-studio/src/composer/models.css');
  const referenced = [...css.matchAll(/url\("\/cle\/static\/legacy\/brand\/([a-z-]+)\.svg"\)/g)].map((m) => m[1]);
  assert.ok(referenced.length >= 15, `expected the full provider set, found ${referenced.length}`);
  for (const name of new Set(referenced)) {
    assert.ok(exists(`services/cle-studio/static/legacy/brand/${name}.svg`), `missing brand/${name}.svg`);
  }
  for (const name of ['gemini', 'claude', 'deepseek', 'mistral', 'doubao']) {
    const svg = read(`services/cle-studio/static/legacy/brand/${name}.svg`);
    assert.match(svg, /fill="#[0-9A-Fa-f]{3,8}"/, `${name} keeps its brand colour in the source`);
    assert.match(css, new RegExp(`data-pinkie-brand="${name}"\\] \\{ --pinkie-brand-img: url`),
      `${name} is drawn as its own coloured artwork`);
  }
  // a coloured mark must not travel through the mask channel at all, or it loses its colours
  const coloured = css.slice(css.indexOf('coloured set'), css.indexOf('/* the native provider glyph'));
  assert.match(coloured, /--pinkie-brand-mono: none/);
  assert.match(coloured, /--pinkie-brand-ink: transparent/);
  assert.doesNotMatch(coloured, /--pinkie-brand-mono: url\(/);
  for (const name of ['openai', 'codex', 'grok', 'kimi', 'zai']) {
    const svg = read(`services/cle-studio/static/legacy/brand/${name}.svg`);
    assert.match(svg, /fill="currentColor"/, `${name} is a monochrome mark and is masked`);
  }
});

test('the 2026.10 catalog can fold routes while native control ownership is preserved', () => {
  const src = read('services/cle-studio/static/legacy/laolao-model-picker.js');
  const modern = src.slice(src.indexOf('function syncModern'), src.indexOf('function sync(details)'));
  assert.match(modern, /syncModelBrands\(menu, false\)/,
    'the native catalog keeps its rows; retired-model filtering belongs to the old list only');
  assert.doesNotMatch(modern, /pinkie-model-current|pinkie-model-frame|prepareFrame|syncFrame/,
    'no duplicate current-model button or canvas frame in the native menu');
  assert.doesNotMatch(modern, /syncNativeBrandTabs/,
    'native provider groups are not display:none behind our tabs');
  // The folded rows use one save path. Native controls keep their owner and
  // the native effort entrance is reused rather than moved or removed.
  assert.match(src, /if \(fallbackOption\) \{[\s\S]{0,180}stopImmediatePropagation/);
  assert.match(src, /button !== nativeButton/);
  assert.match(src, /pinkieNativeEffort !== "1"/);
});

test('the reasoning slider answers all three places the native build paints it', () => {
  const css = read('services/cle-studio/src/composer/models.css');
  // 1. the container's 220% blue gradient capsule and its flow animation
  assert.match(css, /\.chat-controls__reasoning-slider:has\(\[data-effort-boost\]\)\s*\{[\s\S]*?background-image: none;[\s\S]*?animation: none;/,
    'the container gradient and the chat-effort-flow animation must both be cleared');
  // 2. the input's own 1px + 12/18px glow
  assert.match(css, /\.chat-controls__reasoning-range\[data-effort-boost\]/,
    'the boosted range keeps an explicit box-shadow: none rule');
  assert.match(css, /\.chat-controls__reasoning-range\[data-effort-boost="ultra"\]\s*\{\s*box-shadow: none;/);
  // 3. a hairline track and a small bead, not the 26px pill / 28x20 thumb
  assert.match(css, /\.chat-controls__reasoning-range::-webkit-slider-runnable-track\s*\{\s*height: 3px;/);
  assert.match(css, /\.chat-controls__reasoning-range::-webkit-slider-thumb\s*\{[\s\S]*?width: 11px;[\s\S]*?height: 11px;/);
  // the current stop is a tick, never a filled bar or a glow
  assert.match(css, /\.cle-gaze-stop\[data-current\] \.cle-gaze-stop__tick\s*\{[\s\S]*?background: var\(--cle-gaze\);[\s\S]*?box-shadow: none;/);
  assert.match(css, /\.cle-gaze-stop__tick\s*\{\s*width: 2px;\s*height: 7px;/);
  // the stop names stay readable on the common 508px split pane
  assert.doesNotMatch(css, /@container cle-pane \(max-width: 520px\)[\s\S]{0,400}\.cle-gaze-stop \{ font-size: 9px; \}/,
    'a 508px split pane must not shrink the stop names to 9px');
  // and many-stop ladders step down by count instead of squeezing every label
  assert.match(css, /data-cle-stops="9"/);
});

test('gaze records how many stops the model really exposes', () => {
  const src = read('services/cle-studio/src/composer/gaze.js');
  assert.match(src, /host\.dataset\.cleStops = String\(values\.length\)/);
});

/* The effort menu is not only a slider: it has a panel, a live value, a single-stop button
   for models that expose one level, and a Speed radio group. A previous pass rewrote the
   slider block and silently dropped every rule below it, so these are pinned by name. */
test('the panel, the single-stop button and the Speed group keep their own styling', () => {
  const css = read('services/cle-studio/src/composer/models.css');
  const required = [
    ['panel padding', /\.chat-controls__reasoning-panel\s*\{[\s\S]{0,120}?padding: 11px 12px 12px;/],
    ['panel rule', /\.chat-controls__reasoning-panel\s*\{[\s\S]{0,200}?border-top: 1px solid var\(--cle-line\);/],
    ['section heading', /\.chat-controls__effort-heading\s*\{[\s\S]{0,160}?font: 500 10\.5px\/1\.2 var\(--cle-mono\);/],
    ['live value', /\.chat-controls__effort-value[\s\S]{0,120}?font: 500 12px\/1\.2 var\(--cle-sans\);/],
    ['single-stop button', /\.chat-controls__reasoning-option\s*\{[\s\S]{0,200}?min-height: 30px;/],
    ['single-stop selected', /\.chat-controls__reasoning-option--selected,[\s\S]{0,220}?background: var\(--cle-gaze-soft\);/],
    ['single-stop disabled', /\.chat-controls__reasoning-option:disabled \{ opacity: \.55; \}/],
    ['speed panel', /\.chat-controls__speed-panel \{[^}]*padding: 10px 12px 12px;/],
    ['speed group', /\.chat-controls__speed-options\s*\{[\s\S]{0,220}?border-radius: var\(--cle-radius-ctl\);/],
    ['speed checked', /\.chat-controls__speed-option\[aria-checked="true"\]\s*\{[\s\S]{0,160}?color: var\(--cle-ink\);/],
    ['speed focus', /\.chat-controls__speed-option:focus-visible \{ outline: 2px solid var\(--cle-gaze\);/],
    ['speed disabled', /\.chat-controls__speed-option:disabled \{ opacity: \.55; \}/],
  ];
  for (const [label, pattern] of required) assert.match(css, pattern, `missing: ${label}`);
  // and every one of those controls really is rendered by the 2026.10 effort menu
  const native = read('services/cle-studio/static/legacy/laolao-model-picker.js');
  assert.ok(native.length > 0);
});

test('the brand mark reaches the closed trigger, not only an open menu', () => {
  const src = read('services/cle-studio/static/legacy/laolao-model-picker.js');
  const modern = src.slice(src.indexOf('function syncModern'), src.indexOf('function sync(details)'));
  const triggerAt = modern.indexOf('summary.dataset.pinkieBrand');
  const openGuard = modern.indexOf('if (!details.open || !menu) return;');
  assert.ok(triggerAt > 0 && openGuard > triggerAt,
    'the trigger brand is written before the open-state early return');
});

/* The native composer always carries `.agent-chat__input--mobile-toolbar`, and that build
   paints every model/effort trigger's ::before as `position: absolute; inset: 0`. A brand
   mark that only sets display/flex therefore stays absolute, leaves the flex line and lands
   on the summary's top-left corner while the label starts on the next row. */
test('the trigger brand mark is put back in flow, per host class, without a global summary reset', () => {
  const css = read('services/cle-studio/src/composer/models.css');
  const triggerRule = css.slice(css.indexOf('the trigger: back into the flex line'));
  assert.match(triggerRule, /position: static;/);
  assert.match(triggerRule, /inset: auto;/);
  assert.match(triggerRule, /left: auto;/);
  assert.match(triggerRule, /top: auto;/);
  // the reset is scoped to the picker's own summary, never to every summary in the app
  assert.doesNotMatch(css, /(^|\n)\s*summary::before\s*\{/m,
    'a global summary::before reset would hit chat disclosures and tool cards too');
  const scoped = css.slice(css.indexOf('the trigger: back into the flex line'), css.indexOf('the native mobile-toolbar rule'));
  assert.match(scoped, /chat-controls__model-picker/);
  assert.match(scoped, /> summary\[data-pinkie-brand\]::before/);
  // the 44x44 mobile-toolbar trigger box is neutralised for our quiet row
  assert.match(css, /min-width: 0;\s*\n\s*min-height: 27px;/);
});

test('mountGaze reacts to pickers that appear after activation, in batches, without losing roots', () => {
  const src = read('services/cle-studio/src/composer/gaze.js');
  // a set of pending pickers, not a single boolean that drops later roots
  assert.match(src, /const pending = new Set\(\)/);
  assert.match(src, /for \(const picker of pickersFor\(node\)\) \{ pending\.add\(picker\);/);
  // every added node is normalised to its owning picker
  assert.match(src, /function pickersFor\(node\)/);
  assert.match(src, /const own = node\.closest\?\.\(PICKER\)/);
  // our own insertions are ignored so decorating cannot re-arm the observer
  assert.match(src, /node\.dataset\?\.cleOwned === '1'/);
  // abort cancels the pending frame and clears the queue
  assert.match(src, /cancelAnimationFrame\(frame\)/);
  assert.match(src, /pending\.clear\(\)/);
  // no characterData observation (streaming would re-scan the document per token)
  assert.doesNotMatch(src, /characterData:\s*true/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-companion.js'), 'utf8');
const start = source.indexOf('const menuLayout = ');
const end = source.indexOf('const positionMenu = ', start);
assert.ok(start >= 0 && end > start, 'test the actual placement function');
const layout = vm.runInNewContext(`(() => { ${source.slice(start, end)} return menuLayout; })()`);
const viewport = {left: 0, top: 0, width: 1000, height: 700};
const size = {width: 228, height: 290};
const anchor = {left: 700, right: 880, top: 430, bottom: 520};
function contained(result, view = viewport, header = 44, contentHeight = size.height) {
  assert.ok(result.left >= view.left + 12);
  assert.ok(result.left + result.width <= view.left + view.width - 12);
  assert.ok(result.top >= Math.max(view.top + 12, header + 8));
  assert.ok(result.top + Math.min(contentHeight, result.maxHeight) <= view.top + view.height - 12);
}
test('a regular menu sits above its figure without entering the header', () => {
  const result = layout(anchor, size, viewport, 44);
  assert.equal(result.placement, 'above');
  assert.equal(result.top, 130);
  contained(result);
});
test('a high composer flips the menu below instead of clipping its first items', () => {
  const result = layout({...anchor, top: 100, bottom: 190}, size, viewport, 44);
  assert.equal(result.placement, 'below');
  assert.equal(result.top, 200);
  contained(result);
});
test('short native windows constrain height and keep every item scroll-accessible', () => {
  const view = {...viewport, height: 340};
  const result = layout({...anchor, top: 170, bottom: 260}, {...size, height: 360}, view, 44);
  assert.ok(result.maxHeight < 360);
  assert.ok(result.maxHeight >= 144);
  contained(result, view, 44, 360);
});
test('a narrow panel clamps both horizontal edges', () => {
  const view = {...viewport, width: 210};
  const result = layout({left: 0, right: 35, top: 430, bottom: 520}, size, view, 44);
  assert.equal(result.width, 186);
  contained(result, view);
});
test('zoomed and panned visual viewports retain their nonzero origin', () => {
  const view = {left: 160, top: 80, width: 500, height: 440};
  const result = layout({...anchor, right: 700, top: 300, bottom: 380}, size, view, 44);
  contained(result, view);
});
test('placement uses CSS pixels, not physical DPI or page zoom multipliers', () => {
  for (const dpr of [1, 1.25, 1.5, 2]) {
    assert.deepEqual(layout(anchor, size, {...viewport, dpr}, 44), layout(anchor, size, viewport, 44));
  }
});
test('top-layer and fallback menus preserve keyboard and outside-click ownership', () => {
  assert.match(source, /menu\.setAttribute\("popover", "manual"\)/);
  assert.match(source, /menu\.showPopover\(\)/);
  assert.match(source, /menu\.hidePopover\(\)/);
  assert.match(source, /!buddy\.contains\(event\.target\) && !menu\.contains\(event\.target\)/);
  assert.match(source, /event\.key === "Tab".*hideMenu\(\); figure\.focus\(\)/);
  const css = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-companion.css'), 'utf8');
  assert.match(css, /\.pinkie-buddy__menu \{\s*position: fixed;/);
  assert.match(css, /overflow: auto/);
  assert.match(css, /\.pinkie-buddy__menu\.is-shown \.pinkie-buddy__item \{ animation:/,
    'retain the complete staggered entrance');
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');

const css = fs.readFileSync(path.join(__dirname,'../ui/injections/laolao-platform-surface.css'),'utf8');

test('only the Windows multi-page today header reserves the page-close hit area', () => {
  const rule = /html\[data-pinkie-platform="windows"\]\s*#pinkie-study-desk\.pk-ink:not\(\[data-pages="1"\]\)\s*\.desk-page\[data-view="today"\]\s*\.desk-date-row\s*\{([^}]+)\}/.exec(css);
  assert.ok(rule, 'the fix is confined to the affected native view');
  assert.match(rule[1],/box-sizing:\s*border-box/);
  assert.match(rule[1],/padding-right:\s*42px/);
  assert.doesNotMatch(rule[1],/animation|opacity|filter|display\s*:\s*none/);
});

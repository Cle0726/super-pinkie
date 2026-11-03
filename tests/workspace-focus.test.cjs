const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('workspace rail prioritises work material without changing native file access', () => {
  const source = read('ui/injections/laolao-workspace-focus.js');
  const css = read('ui/injections/laolao-workspace-focus.css');

  assert.match(source, /This only changes the file rail's presentation/);
  assert.match(source, /"本轮重点文件"/);
  assert.match(source, /"会话附件"/);
  assert.match(source, /"会话资料"/);
  assert.match(source, /"工作目录"/);
  assert.match(source, /"avatars", "memory", "persona", "skills"/);
  assert.match(source, /"agents\.md"/);
  assert.match(source, /openclaw-workspace-state/);
  assert.match(source, /const showExtras = searchActive \|\| rail\.dataset\.laolaoSystemRequested === "true"/);
  assert.match(source, /const classifyPath =/);
  assert.match(source, /DELIVERY_FOLDERS/);
  assert.match(source, /MATERIAL_FOLDERS/);
  assert.match(source, /PROCESS_FOLDERS/);
  assert.match(source, /本轮产出\|本轮重点文件/);
  assert.match(css, /data-laolao-system-visible="false"/);
  assert.match(css, /data-laolao-focus-hidden="true"/);
  assert.match(css, /data-laolao-workspace-section="changed"/);
  assert.match(css, /data-laolao-workspace-section="artifacts"/);
});

test('process rows fold by default while delivery, material, and attachments remain usable', () => {
  const source = read('ui/injections/laolao-workspace-focus.js');
  const css = read('ui/injections/laolao-workspace-focus.css');

  assert.match(source, /kind !== "changed" && kind !== "read"/);
  assert.match(source, /const extra = fileKind === "internal";/);
  assert.match(source, /browser\?\.querySelectorAll\("\.chat-workspace-rail__file"\)/);
  assert.match(source, /row\.dataset\.laolaoFocusHidden = extra && !showExtras/);
  assert.match(source, /row\.dataset\.laolaoFocusKind = fileKind/);
  assert.doesNotMatch(css, /data-laolao-focus-kind="delivery"\][\s\S]{0,180}display: none/);
});

test('both desktop installers ship the focused workspace rail', () => {
  const head = require('./fixtures/shared-ui.cjs').sharedUi({'entries': ['laolao-workspace-focus.css', 'laolao-workspace-focus.js'], 'assets': []});

});

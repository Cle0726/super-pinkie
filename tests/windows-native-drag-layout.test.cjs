const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../app/windows_desktop.py'), 'utf8');
const start = source.indexOf('const chooseDragInterval = ');
const end = source.indexOf('const selector = ', start);
assert.ok(start >= 0 && end > start, 'use the actual injected Windows drag calculation');
const choose = vm.runInNewContext(`(() => {${source.slice(start,end)} return chooseDragInterval;})()`);
const plain = value => value === null ? null : JSON.parse(JSON.stringify(value));

test('a blank title bar remains draggable over its full available area', () => {
  assert.deepEqual(plain(choose(264,1082,[])),{left:264,width:818});
});
test('workbench actions and the mode selector are never under the drag surface', () => {
  const blocked=[{left:807,right:831},{left:832,right:856},{left:857,right:881},{left:920,right:999}];
  const result=choose(264,1082,blocked);
  assert.deepEqual(plain(result),{left:264,width:539});
  for(const rect of blocked) assert.ok(result.left+result.width<=rect.left || result.left>=rect.right);
});
test('overlapping and partially outside controls are merged before choosing the longest gap', () => {
  const result=choose(100,600,[{left:90,right:135},{left:130,right:165},{left:360,right:405},{left:400,right:430}]);
  assert.deepEqual(plain(result),{left:169,width:187});
});
test('a fully occupied bar disables only that drag surface rather than hiding buttons', () => {
  assert.equal(choose(100,200,[{left:90,right:210}]),null);
  assert.match(source,/else drag\.style\.pointerEvents='none'/);
  assert.doesNotMatch(source,/\.pk-wb-icon\s*\{[^}]*display\s*:\s*none/);
});
test('header layout is refreshed for window resizing, scrolling and changing controls', () => {
  assert.match(source,/window\.addEventListener\('resize',schedule/);
  assert.match(source,/document\.addEventListener\('scroll',schedule/);
  assert.match(source,/MutationObserver\(records=>/);
  assert.match(source,/drag\.addEventListener\('dblclick'/);
  assert.match(source,/drag\.className = 'pywebview-drag-region'/);
});

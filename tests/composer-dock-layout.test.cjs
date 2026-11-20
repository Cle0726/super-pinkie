const {test} = require('node:test');
const assert = require('node:assert/strict');
const {layout} = require('../ui/injections/laolao-composer-dock.js');

const bar = {height:34};
const dot = {...bar, dot:true};
const work = {height:30};

test('run status and Ultra share space without overlapping in a wide or a narrow composer', () => {
  for (const [width, run] of [[880, bar], [390, dot]]) {
    const result = layout(width, run, work);
    assert.equal(result.workOffset, 0);
    assert.ok(result.runWidth + result.workWidth + 6 <= width);
    assert.equal(result.reserve, 46);
  }
});

test('medium panes and open panels get separate rows inside the reserved slot', () => {
  const mid = layout(540, bar, work);
  assert.equal(mid.runWidth, 540);
  assert.equal(mid.workOffset, 40);
  assert.equal(mid.reserve, 82);
  const expanded = layout(390, {...dot, extra:88}, {...work, extra:92});
  assert.equal(expanded.workOffset, 134);
  assert.ok(expanded.reserve > expanded.workOffset + 30 + 92);
  assert.equal(layout(390, null, work).reserve, 42);
  assert.equal(layout(390, null, null).reserve, 0);
});

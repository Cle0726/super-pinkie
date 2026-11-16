import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = (name) => readFileSync(new URL(`../ui/injections/${name}`, import.meta.url), 'utf8');

test('ordinary assistant prose is never folded into a fake 思路 row', () => {
  const stage = read('laolao-cle-stage.js');
  const styles = read('laolao-tool-rows.css');
  for (const source of [stage, styles]) {
    assert.doesNotMatch(source, /shapePlans|openPlans|PLAN_MIN|PLAN_TAIL|cle-plan|data-cle-plan/);
  }
  assert.doesNotMatch(stage, /<b>思路<\/b>/);
});

test('the real model-thinking presentation remains installed', () => {
  const card = read('laolao-process-card.js');
  const styles = read('laolao-process-card.css');
  assert.match(card, /思考了/);
  assert.match(card, /pinkie:gateway-event/);
  assert.match(card, /payload\.stream === "thinking"/);
  assert.match(card, /const MAX_TEXT = 32000/);
  assert.match(card, /const holdFor =/);
  assert.doesNotMatch(card, /hurryTyping\(/);
  assert.match(styles, /\.pinkie-thinking\.is-live \.pinkie-thinking__body \{\s*max-height: 68px; overflow: hidden;/);
  assert.doesNotMatch(styles, /background-color: #17151b|\u274f|SFMono-Regular|repeating-linear-gradient/);
});

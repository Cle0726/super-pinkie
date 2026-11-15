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
  assert.match(card, /思考了/);
  assert.match(card, /pinkie:gateway-event/);
  assert.match(card, /payload\.stream === "thinking"/);
});

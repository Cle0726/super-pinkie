import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore, calculateReviewSchedule} from '../../services/mode-architecture/learning.mjs';
import {LearningPact} from '../../services/mode-architecture/learning-pact.mjs';
import {LearningDrill} from '../../services/mode-architecture/learning-drill.mjs';
import {LearningGame} from '../../services/mode-architecture/learning-game.mjs';

const T0 = Date.parse('2026-11-08T04:00:00Z');
export function gameFixture(t, {at = T0} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-game-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  let clock = at;
  const store = new LearningInteractionStore({root, workspace: path.join(root, 'workspace')});
  const pact = new LearningPact(store, {now: () => clock});
  store.pact = pact;
  const game = new LearningGame(store, {now: () => clock});
  store.game = game;
  const organizer = {status: () => ({available: false, model: ''}), requestModel: async () => { throw new Error('不该调用模型'); }};
  const drill = new LearningDrill(store, {organizer, schedule: calculateReviewSchedule, pact, now: () => clock});
  return {root, store, pact, game, drill, setClock: v => { clock = v; }, tick: ms => { clock += ms; }};
}

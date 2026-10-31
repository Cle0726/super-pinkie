import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningLibrary, registerLearningLibrary} from '../services/mode-architecture/learning-library.mjs';
import {LearningInteractionStore} from '../services/mode-architecture/learning.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-library-evidence-'));
  const library = new LearningLibrary({root: path.join(root, 'library')});
  t.after(() => { library.db.close(); fs.rmSync(root, {recursive: true, force: true}); });
  const learning = new LearningInteractionStore({root: path.join(root, 'learning'), workspace: path.join(root, 'workspace')});
  const id = '1234567890abcdef12345678';
  library.commitBook({id, title: '临时测试教材', type: 'pdf', outline: []}, [
    {text: 'source = 来源', label: '第 1 页'}, {text: 'review = 复习', label: '第 2 页'},
  ]);
  return {library, learning, id};
}

test('reading coverage records visited pages without claiming knowledge mastery', t => {
  const {library, id} = fixture(t);
  library.progress(id, {location: 2, scroll: 0.6, zoom: 1.4});
  library.progress(id, {location: 2});
  const progress = library.progress(id, {location: 1}).book.progress;
  assert.deepEqual(progress.visitedLocations, [1, 2]);
  assert.equal(progress.visitedCount, 2);
  assert.equal(progress.coverage, 1);
  assert.equal(progress.evidence, 'visited_only');
  assert.equal(progress.scroll, 0.6);
  assert.equal(progress.zoom, 1.4);
  assert.equal('mastered' in progress, false);
});

test('chapter reading saves structured page sources and requests independent item assessments', async t => {
  const {library, learning, id} = fixture(t);
  const handlers = new Map();
  registerLearningLibrary({registerGatewayMethod(name, handler) {handlers.set(name, handler);}, on() {}}, {library, learning});
  let response;
  await handlers.get('pinkie.learning.library.chapter')({params: {sessionKey: 'agent:learning:chapter', id, start: 1, end: 2},
    respond(ok, result, error) {response = {ok, result, error};}});
  assert.equal(response.ok, true);
  assert.equal(response.result.sources.length, 2);
  assert.match(response.result.prompt, /items/);
  const note = learning.findOwnedNote('agent:learning:chapter', response.result.ids[0]);
  assert.equal(note.sourceAnchor.bookId, id);
  assert.deepEqual(note.sourceAnchors.map(source => source.location), [1, 2]);
  const shown = learning.present('agent:learning:chapter', {kind: 'fill_blank', question: 'source?', correct_answer: '来源', note_ids: [note.id]});
  assert.deepEqual(shown.current.sources.map(source => source.location), [1, 2]);
  assert.equal(learning.library, library);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningLesson} from '../services/mode-architecture/learning-lesson.mjs';

function root(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-lesson-corrupt-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}

for (const [name, body] of [['truncated JSON', '{"v":1,"lessons":[{"id":'], ['JSON null', 'null'], ['lessons not an array', '{"v":1,"lessons":{}}']]) {
  test(`a damaged lessons.json (${name}) is set aside instead of stopping startup`, async t => {
    const dir = root(t), file = path.join(dir, 'lessons.json');
    fs.writeFileSync(file, body);
    const lessons = new LearningLesson({root: dir}, {now: () => 1700000000000});
    assert.deepEqual(lessons.all(), []);
    assert.ok(lessons.corruptFile.startsWith(file + '.corrupt-1700000000000-'));
    assert.equal(fs.readFileSync(lessons.corruptFile, 'utf8'), body, 'the damaged record is kept byte for byte');
    assert.equal(fs.existsSync(file), false);
    await lessons.save();
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {v: 1, lessons: []});
    assert.equal(fs.readFileSync(lessons.corruptFile, 'utf8'), body, 'saving does not touch the set-aside copy');
  });
}

test('a valid lessons.json still loads as before', t => {
  const dir = root(t), file = path.join(dir, 'lessons.json');
  fs.writeFileSync(file, JSON.stringify({v: 1, lessons: [{id: 'a', status: 'done'}]}));
  const lessons = new LearningLesson({root: dir});
  assert.deepEqual(lessons.all(), [{id: 'a', status: 'done'}]);
  assert.equal(lessons.corruptFile, undefined);
  assert.deepEqual(fs.readdirSync(dir), ['lessons.json']);
});

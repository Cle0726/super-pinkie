import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ArtifactStore} from '../services/mode-architecture/artifacts.mjs';
import {DesktopApps, appIdFor} from '../services/mode-architecture/desktop-apps.mjs';

const KEY = 'agent:project:dashboard:7d2c1f4e';

function setup() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apps-dup-')));
  const artifacts = new ArtifactStore(path.join(dir, 'artifacts'));
  const record = (name, body) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, body);
    return artifacts.record({file, sessionKey: KEY, runId: 'r1'});
  };
  let clock = 1000;
  const apps = new DesktopApps(path.join(dir, 'apps'), {artifacts, now: () => ++clock});
  return {record, apps};
}

test('两件作品落到同一个快捷方式名字时，后一件装不进去，先装的文件还在', () => {
  const {record, apps} = setup();
  const first = record('one.html', '<p>one</p>');
  const installed = apps.install({id: first.id, name: 'Weather'});
  const entry = fs.readFileSync(installed.app.entry, 'utf8');
  const second = record('two.html', '<p>two</p>');
  assert.throws(() => apps.install({id: second.id, name: 'weather'}), /已经有一个同名的应用/);
  assert.equal(fs.readFileSync(installed.app.entry, 'utf8'), entry);
  assert.equal(apps.list().apps.length, 1);
  assert.equal(fs.existsSync(apps.dirOf(appIdFor(second.id))), false);

  const spaced = record('three.html', '<p>three</p>');
  apps.install({id: spaced.id, name: 'a b'});
  const slash = record('four.html', '<p>four</p>');
  assert.throws(() => apps.install({id: slash.id, name: 'a/b'}), /已经有一个同名的应用/);
  assert.equal(fs.existsSync(apps.dirOf(appIdFor(slash.id))), false);
  assert.match(fs.readFileSync(apps.forArtifact(spaced.id).app.entry, 'utf8'), /<p>three<\/p>/);

  const composed = record('five.html', '<p>five</p>');
  const accent = apps.install({id: composed.id, name: 'caf\u00e9'});
  const decomposed = record('six.html', '<p>six</p>');
  assert.throws(() => apps.install({id: decomposed.id, name: 'cafe\u0301'}), /已经有一个同名的应用/);
  assert.equal(accent.app.name, 'caf\u00e9');
  assert.equal(fs.existsSync(apps.dirOf(appIdFor(decomposed.id))), false);
});

test('同一件作品重装、更新可以沿用名字；改成别人占用的名字会拒绝，两边的文件都留着', () => {
  const {record, apps} = setup();
  const weather = record('weather.html', '<p>w1</p>');
  const notes = record('notes.html', '<p>n</p>');
  const first = apps.install({id: weather.id, name: '天气'});
  const other = apps.install({id: notes.id, name: '笔记'});
  const again = apps.install({id: weather.id, name: '天气'});
  assert.equal(again.replaced, true);
  record('weather.html', '<p>w2</p>');
  const updated = apps.update(first.app.id);
  assert.equal(updated.ok, true);
  assert.equal(updated.app.name, '天气');
  assert.match(fs.readFileSync(updated.app.entry, 'utf8'), /<p>w2<\/p>/);
  assert.throws(() => apps.install({id: weather.id, name: '笔记'}), /已经有一个同名的应用/);
  assert.match(fs.readFileSync(first.app.entry, 'utf8'), /<p>w2<\/p>/);
  assert.match(fs.readFileSync(other.app.entry, 'utf8'), /<p>n<\/p>/);
  assert.equal(apps.get(first.app.id).app.name, '天气');
  assert.equal(apps.get(other.app.id).app.name, '笔记');
});

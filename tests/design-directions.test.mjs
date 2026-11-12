import test from 'node:test';
import assert from 'node:assert/strict';
import {DIRECTIONS, wantsDesign, pickDirections, designDirectionBlock, forgetDirections} from '../services/mode-architecture/design-directions.mjs';

test('library: unique ids, every field filled', () => {
  assert.ok(DIRECTIONS.length >= 30);
  assert.equal(new Set(DIRECTIONS.map(item => item.id)).size, DIRECTIONS.length);
  for (const item of DIRECTIONS) for (const key of ['name', 'feel', 'type', 'color', 'layout', 'signature', 'motion']) assert.ok(item[key].length >= (key === 'name' ? 2 : 8), `${item.id}.${key}`);
});
test('wantsDesign: new visual work yes, small tweaks and non-visual no', () => {
  assert.equal(wantsDesign(['web_ui'], '帮我做一个奶茶店的网页'), true);
  assert.equal(wantsDesign([], '设计一张社团招新海报'), true);
  assert.equal(wantsDesign(['web_ui'], '把按钮改大一点'), false);
  assert.equal(wantsDesign(['code'], '写一个脚本批量改文件名'), false);
  assert.equal(wantsDesign(['simple'], '今天天气怎么样'), false);
});
test('pickDirections: fits the subject, avoids recent ones', () => {
  const picked = pickDirections('做一个茶馆的网页', {count: 3, random: () => 0.5});
  assert.equal(picked.length, 3);
  assert.ok(picked.slice(0, 2).every(item => item.fits.test('做一个茶馆的网页')));
  const again = pickDirections('做一个茶馆的网页', {count: 3, avoid: picked.map(item => item.id), random: () => 0.5});
  assert.ok(again.every(item => !picked.includes(item)));
});
test('block: different directions each time in a session, stricter in ideas mode, none for unrestricted', () => {
  forgetDirections();
  const first = designDirectionBlock(['web_ui'], '帮我做一个咖啡店的主页', {mode: 'project', sessionKey: 's'});
  const second = designDirectionBlock(['web_ui'], '帮我做一个咖啡店的主页', {mode: 'project', sessionKey: 's'});
  const names = block => [...block.matchAll(/^\d\. 「(.+?)」/gm)].map(match => match[1]);
  assert.equal(names(first).length, 3);
  assert.ok(names(second).every(name => !names(first).includes(name)));
  assert.match(first, /默认脸/); assert.match(first, /8 分/);
  const ideas = designDirectionBlock(['web_ui'], '帮我做一个咖啡店的主页', {mode: 'ideas', sessionKey: 't'});
  assert.equal(names(ideas).length, 4); assert.match(ideas, /想法模式的要求再高一级/);
  assert.equal(designDirectionBlock(['web_ui'], '帮我做一个咖啡店的主页', {mode: 'none'}), '');
  assert.equal(designDirectionBlock(['web_ui'], '把标题改大', {mode: 'project'}), '');
});

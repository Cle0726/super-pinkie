#!/usr/bin/env node
// 把用户发来的引导语（briefs/metre-mode-1113/ref/metre-prompts-*-user.txt）合进 metre-prompts.json，
// 再生成 ui/injections/laolao-metre-prompts.js。句子原样，只做两件事：
//   1. 和题库里已有的句子（去掉 [[ ]] 后）一样的不再加；
//   2. 句子里第一处 ‘…’（12 个字以内）标成关键词：‘[[…]]’。没有的就不标。
// 用法：node tools/metre/build-prompts.mjs [txt ...]（不给就用 ref 下全部 *-user.txt）
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const refDir = path.join(root, 'briefs/metre-mode-1113/ref');
const jsonPath = path.join(refDir, 'metre-prompts.json');
const jsPath = path.join(root, 'ui/injections/laolao-metre-prompts.js');

const strip = (text) => String(text).replace(/\[\[|\]\]/g, '');
const mark = (text) => text.replace(/‘([^‘’\[\]]{1,12})’/, '‘[[$1]]’');

export function parseUserText(text) {
  const groups = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('@')) {
      const [id, zh, en, note] = line.slice(1).split('|').map((part) => part.trim());
      current = {id, zh, en, note, sentences: []};
      groups.push(current);
    } else if (current) current.sentences.push(line);
  }
  return groups;
}

export function merge(data, groups) {
  const out = JSON.parse(JSON.stringify(data));
  const seen = new Set(out.categories.flatMap((c) => [...(c.user || []), ...(c.fable || [])]).map(strip));
  for (const group of groups) {
    let category = out.categories.find((c) => c.id === group.id);
    if (!category) {
      if (!group.zh || !group.en) throw new Error(`新类 ${group.id} 缺中文名或英文名`);
      category = {id: group.id, zh: group.zh, en: group.en, note: group.note || '', user: [], fable: []};
      out.categories.push(category);
    }
    for (const sentence of group.sentences) {
      if (seen.has(strip(sentence))) continue;
      seen.add(strip(sentence));
      category.user.push(mark(sentence));
    }
  }
  return out;
}

function renderJs(data) {
  return `/* laolao-metre-prompts —— Metre 空状态引导语题库（PLAN 6.3）。
 * 由 briefs/metre-mode-1113/ref/metre-prompts.json 原样生成，不改句子（tests/metre-skin-cat.test.cjs 逐句比对）。
 * 要加句子：把用户原句写进 ref/metre-prompts-<日期>-user.txt，跑 node tools/metre/build-prompts.mjs。 */
(function (root) {
  'use strict';
  const data = ${JSON.stringify(data, null, 1).replace(/\n/g, '\n  ')};
  root.LaolaoMetrePrompts = data;
  if (typeof module === 'object' && module.exports) module.exports = data;
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2).length
    ? process.argv.slice(2)
    : fs.readdirSync(refDir).filter((name) => /^metre-prompts-.*-user\.txt$/.test(name)).sort().map((name) => path.join(refDir, name));
  let data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  for (const file of files) data = merge(data, parseUserText(fs.readFileSync(file, 'utf8')));
  data.note = '「user」是用户给的原句（2026-11-13 第一批，2026-11-17 第二、三批，见 ref/metre-prompts-*-user.txt），除 [[ ]] 关键词标记外一个字不改；「fable」是 Fable 5.2 于 2026-11-14 照用户的例子扩写的。[[…]] 标的是要突出的关键词；后几批先把句中第一处 ‘…’ 标成关键词，其余按 ref/metre-prompts-keywords-1117.txt 标；句中（英文）注释首页不显示。新类的 note 是用户写的「特点」。';
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 1) + '\n');
  fs.writeFileSync(jsPath, renderJs(data));
  const count = data.categories.reduce((sum, c) => sum + c.user.length + c.fable.length, 0);
  console.log(`${data.categories.length} 类，${count} 句`);
}

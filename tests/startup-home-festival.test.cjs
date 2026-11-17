'use strict';
// 碧琪首页问候：节日 / 放假当天第一句是节日问候，之后节日问候被选中的机会是普通问候的 3 倍。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-startup-home.js'), 'utf8');
function data() {
  const window = {__laolaoStartupHome: true};
  vm.runInNewContext(source, {window, document: {}, Object, Map, Math, Date, URL});
  return window.PinkieStartupHomeData;
}

test('every Biqi mode has a festival greeting naming the day', () => {
  const {lines, festivalLines} = data();
  assert.deepEqual(Object.keys(festivalLines).sort(), Object.keys(lines).sort());
  for (const line of Object.values(festivalLines)) assert.match(line, /^今天是\{f\}，/);
});

test('festival day: the first greeting is the festival one, and afterwards it comes up more than any single ordinary line', () => {
  const {lines, greeting} = data();
  const date = new Date(2026, 9, 1, 9, 0);
  for (const mode of Object.keys(lines)) {
    assert.equal(greeting(mode, date, () => 0, new Map(), {name: '国庆节', first: true}).startsWith('今天是国庆节'), true, mode);
    let seed = 9;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const counts = new Map();
    for (let i = 0; i < 3000; i++) {
      const line = greeting(mode, date, random, new Map(), {name: '国庆节', first: false});
      counts.set(line, (counts.get(line) || 0) + 1);
    }
    const festival = [...counts].find(([line]) => line.startsWith('今天是国庆节'))[1];
    for (const [line, n] of counts) if (!line.startsWith('今天是')) assert.ok(festival > n, `${mode}：${line} ${n} ≥ 节日 ${festival}`);
  }
});

test('ordinary day: no festival line, same greeting as before', () => {
  const {lines, greeting} = data();
  const date = new Date(2026, 10, 18, 9, 0);
  for (const mode of Object.keys(lines)) {
    const line = greeting(mode, date, () => 0, new Map());
    assert.equal(line, lines[mode].morning[0]);
  }
});

test('the page asks the gateway for today once a day, keeps it locally, and Metre keeps its own guide sentences', () => {
  assert.match(source, /gwRequest\('pinkie\.metre\.today', \{date: day\}\)/);
  assert.match(source, /localStorage\.setItem\(FESTIVAL_KEY/);
  assert.match(source, /selected === 'metre' \? null : todayFestival\(\)/);
});

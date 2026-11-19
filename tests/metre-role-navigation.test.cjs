const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const read = file => fs.readFileSync(path.resolve(__dirname, '../ui/injections', file), 'utf8');
const part = (text, first, last) => {
  const from = text.indexOf(first), to = text.indexOf(last, from);
  assert.ok(from >= 0 && to > from, first);
  return text.slice(from, to);
};
const child = 'agent:roles:pinkie-child:0efc610f';
const roleName = '后端修 bug';

test('role child resolves to Metre in the switcher and sidebar without a roles mode', () => {
  const switcher = read('laolao-mode-switcher.js');
  const sidebar = read('laolao-sidebar.js');
  const slice = part(switcher, 'const metreRoleChild', 'const agentIdForMode');
  const routes = vm.runInNewContext(slice + '\n({modeIdForSession, modeFromSession})',
    {currentSessionKey: () => child});
  assert.equal(routes.modeIdForSession(child), 'metre');
  assert.equal(routes.modeFromSession(), 'metre');
  assert.equal(routes.modeIdForSession('agent:roles:main'), null);
  assert.equal(routes.modeIdForSession('agent:project:main'), 'project');
  assert.doesNotMatch(switcher, /\bid:\s*["']roles["']/);
  const resolve = vm.runInNewContext(part(sidebar, 'const modeForSession', 'const pageSessionKey')
    + '\nmodeForSession', {AGENT_MODE: {main: 'chat', project: 'project', metre: 'metre'}});
  assert.equal(resolve(child), 'metre');
  assert.equal(resolve('agent:roles:main'), null);
  assert.equal(resolve('agent:main:main'), 'chat');
});

test('a Metre sidebar child displays its role name and opens the correct key', () => {
  const events = [];
  const el = (tag, cls, text = '') => ({tag, cls, text, dataset: {}, kids: [],
    append(...items) { this.kids.push(...items); }});
  const row = vm.runInNewContext(part(read('laolao-session-list.js'), 'function awayRow(', 'function addWorkers(') + '\nawayRow', {
    MODE_SHORT: {project: '项目'}, el,
    window: {dispatchEvent(ev) { events.push(ev); }},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  });
  const role = row({key: child, title: '修回调', roleName});
  assert.equal(role.kids[1].kids[0].text, roleName);
  assert.equal(role.kids[0].dataset.pinkieTooltip, '修回调（角色：后端修 bug）');
  role.kids[0].onclick({preventDefault() {}});
  assert.equal(events[0].type, 'pinkie:open-session-in-mode');
  assert.equal(events[0].detail.sessionKey, child);
  const old = row({key: 'agent:project:pinkie-child:old', mode: 'project', title: '旧任务'});
  assert.equal(old.kids[1].kids[0].text, '项目');
  assert.equal(old.kids[0].dataset.pinkieTooltip, '旧任务（在项目模式，点了切过去）');
});

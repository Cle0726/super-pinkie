// 11-12 audit: sessions that live in another mode, as the sidebar and the cards show them.
// Source checks, plus the switcher's handler run on its own. The switch itself (transition,
// landing on the session) was not exercised in a real App.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const source = name => fs.readFileSync(path.join(__dirname, '../ui/injections', name), 'utf8');
const has = (text, piece, message) => assert.ok(text.includes(piece), message || piece);
const plain = value => JSON.parse(JSON.stringify(value));

test('a link to a session in another mode goes through the mode switcher, same-mode links stay with the sidebar', () => {
  const cards = source('laolao-session-cards.js');
  has(cards, "if (agentOf(key) !== agentOf(currentKey())) window.dispatchEvent(new CustomEvent('pinkie:open-session-in-mode', {detail: {sessionKey: key}}));");
  has(cards, 'else window.__laolaoSidebar?.navigateSession(key);');
  has(cards, "card.modeName ? card.modeName + ' · ' : ''", 'the card names the other mode');
  has(cards, "if (!card.consult) actions.append(link(card.childKey, card.modeName ? '去' + card.modeName + '打开 ›' : '打开子会话 ›'));", 'an archived consult offers nothing to open');
  has(cards, "(fromMode ? '来自' + fromMode + '：' : '来自：') + data.parentTitle", 'a child that came from another mode says which');
  has(source('laolao-sidebar.js'), 'if(modeForSession(key)!==stateMode)return;', 'the sidebar itself still refuses other modes');
});

test('the mode switcher opens the asked session: remembers it for that mode, then plays the normal switch', () => {
  const switcher = source('laolao-mode-switcher.js');
  const start = switcher.indexOf('window.addEventListener("pinkie:open-session-in-mode", (event) => {');
  assert.ok(start > 0, 'handler present');
  const from = switcher.indexOf('(event) => {', start), end = switcher.indexOf('\n  });', from);
  const body = switcher.slice(from, end) + '\n  }';
  const run = (key, {active = 'project', switching = false} = {}) => {
    const calls = [];
    const handler = vm.runInNewContext('(' + body + ')', {
      String, switching, activeMode: () => active,
      modeIdForSession: k => ({main: 'chat', project: 'project', thinking: 'thinking', learning: 'learning'})[String(k).split(':')[1]] || null,
      rememberSession: k => calls.push(['remember', k]), modeById: id => ({id}), switchMode: mode => calls.push(['switch', mode.id]),
      window: {__laolaoSidebar: {navigateSession: k => calls.push(['navigate', k])}},
    });
    handler({detail: {sessionKey: key}});
    return plain(calls);
  };
  assert.deepEqual(run('agent:thinking:pinkie-child:1'), [['remember', 'agent:thinking:pinkie-child:1'], ['switch', 'thinking']]);
  assert.deepEqual(run('agent:project:abc'), [['navigate', 'agent:project:abc']], 'same mode: plain navigation, no transition');
  assert.deepEqual(run('agent:thinking:x', {switching: true}), [], 'never interrupts a switch already playing');
  assert.deepEqual(run('agent:thinking:subagent:x'), []);
  assert.deepEqual(run('nonsense'), []);
  assert.deepEqual(run(undefined), []);
  // The remembered key is only kept if that session is still listed; otherwise the mode's usual one.
  has(switcher, 'if (usable.some((item) => item.key === preferred)) return preferred;');
});

test('the sidebar marks a child that came from another mode and offers a way to the ones it sent away', () => {
  const list = source('laolao-session-list.js');
  has(list, "for (const [childKey, child] of Object.entries(lineage?.away || {})) (awayBy[child.parentKey] ||= []).push({key: childKey, ...child});");
  has(list, "const origin = s.lineage?.cross ? MODE_SHORT[s.lineage.fromMode] : '';");
  has(list, "if (origin) link.append(el('span', 'pinkie-session-origin', origin));");
  has(list, '(!worker && !archived && s.away || []).slice(0, 2)', 'at most two, never on archived or persona rows');
  has(list, "new CustomEvent('pinkie:open-session-in-mode', {detail: {sessionKey: child.key}})");
  has(list, "MODE_SHORT = {chat: '唠嗑', project: '项目', ideas: '想法', learning: '学习'}", 'keys are the backend mode names');
  const css = source('laolao-sidebar-surface.css');
  for (const name of ['pinkie-session-origin', 'pinkie-session-away']) has(css, '.' + name + ' {');
});

test('the changed scripts are served under new cache names', () => {
  const head = source('laolao-head.fragment.html');
  for (const name of ['laolao-session-list.js?v=audit1112.', 'laolao-session-cards.js?v=audit1112.', 'laolao-sidebar-surface.css?v=audit1112.', 'laolao-mode-switcher.js?v=mode47']) has(head, name);
});

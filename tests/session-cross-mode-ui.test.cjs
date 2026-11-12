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
  has(list, 'const away = !worker && !archived && s.away || [];', 'never on archived or persona rows');
  has(list, "button('↗' + (away.length > 1 ? away.length : where),", 'one chip per row, so the title is never squeezed out (seen in a real render)');
  has(list, 'if (!phase && !s.unread && !s.away?.length) {', 'the chip takes the place of the time');
  has(list, "new CustomEvent('pinkie:open-session-in-mode', {detail: {sessionKey: child.key}})");
  has(list, "MODE_SHORT = {chat: '唠嗑', project: '项目', ideas: '想法', learning: '学习'}", 'keys are the backend mode names');
  const css = source('laolao-sidebar-surface.css');
  for (const name of ['pinkie-session-origin', 'pinkie-session-away']) has(css, '.' + name + ' {');
});

// 分工气球 (laolao-crew.js): the rule for what shows is a pure function; the drawing was checked
// in Edge through tools/ui-parity/capture.mjs --rpc, not here.
const crew = () => {
  const window = {};
  vm.runInNewContext(source('laolao-crew.js'), {window});
  return window.PinkieCrew;
};
const child = (key, status, mode = 'chat') => ({key, title: key, mode, status});

test('crew balloons: nothing without children, busy ones first, five at most, and the label counts who is back', () => {
  const {summarize} = crew();
  assert.deepEqual(plain(summarize([])), {rows: [], busy: 0, total: 0, hidden: 0, label: '', waiting: 0});
  assert.equal(summarize(null).total, 0);
  assert.equal(summarize([child('a', 'running'), child('b', 'running'), child('c', 'running')]).label, '碧琪分成 3 路在忙');
  const mixed = summarize([child('a', 'done'), child('b', 'running'), child('c', 'waiting', 'ideas'), child('d', 'error'), child('x', 'nonsense'), null]);
  assert.equal(mixed.label, '碧琪分头在忙 · 2/4 回来了');
  assert.deepEqual(plain(mixed.rows.map(row => row.key)), ['c', 'b', 'd', 'a'], 'waiting for the user comes first, finished last');
  assert.deepEqual([mixed.busy, mixed.waiting, mixed.total], [2, 1, 4], 'unknown statuses are dropped');
  assert.equal(summarize([child('a', 'done'), child('b', 'done')]).label, '2 路都回来啦');
  const many = summarize(Array.from({length: 8}, (_, i) => child('k' + i, i < 2 ? 'running' : 'done')));
  assert.deepEqual([many.rows.length, many.hidden, many.total], [5, 3, 8]);
});

test('crew balloons draw only from what the cards already fetched: no requests, timers or observers of their own', () => {
  const script = source('laolao-crew.js');
  for (const banned of ['gwRequest', 'fetch(', 'setInterval', 'MutationObserver', 'requestAnimationFrame']) assert.equal(script.includes(banned), false, banned);
  const cards = source('laolao-session-cards.js');
  has(cards, 'window.PinkieCrew?.render(composer, data.family, key);');
  has(cards, 'window.PinkieCrew?.clear();');
  has(cards, "status: reported.has(childKey) ? 'done' : 'running'", 'a child in another mode is done once its report card exists');
  has(cards, "!child.cross && !/:subagent:/i.test(childKey) && rows.has(childKey)", 'personas and archived children are not balloons');
  const head = source('laolao-head.fragment.html');
  assert.ok(head.indexOf('/laolao-crew.js') > 0 && head.indexOf('/laolao-crew.js') < head.indexOf('/laolao-session-cards.js'), 'loads before the cards');
  has(source('laolao-crew.css'), 'html[data-reduce-motion] .pinkie-crew, html[data-reduce-motion] .pinkie-crew * { animation: none !important;');
});

test('the 临时 button no longer sits on top of the new-session shortcut', () => {
  has(source('laolao-session-tools.css'), 'html .sidebar :has(> .pinkie-temp-entry) .sidebar-new-session:not(.sidebar-new-session--worktree)::after { margin-right:54px }');
});

test('the changed scripts are served under new cache names', () => {
  const head = source('laolao-head.fragment.html');
  for (const name of ['laolao-session-list.js?v=audit1112.', 'laolao-session-cards.js?v=audit1112.', 'laolao-sidebar-surface.css?v=audit1112.', 'laolao-mode-switcher.js?v=mode48']) has(head, name);
});

// Clean-up from the same audit (duplicates seen on a real render of the chat page).
test('one day/night switch on the chat page, two different controls no longer share the name 思考强度, and dead art is gone', () => {
  has(source('laolao-sidebar.css'), 'html:has(#pinkie-night-rail-entry) .sidebar-shell__footer .laolao-sidebar-theme-toggle { display: none !important; }');
  const deep = source('laolao-deep-think.js');
  assert.equal(deep.includes('"选择思考强度"'), false, 'the model picker owns that name');
  has(deep, '"极致思考：让碧琪多想几轮再答"');
  has(source('laolao-model-picker.js'), 'pinkie-effort-trigger');
  const assets = path.join(__dirname, '../ui/assets');
  for (const id of ['chat', 'project', 'thinking', 'learning', 'unrestricted']) {
    assert.equal(fs.existsSync(path.join(assets, `laolao-mode-${id}.png`)), false, `${id}: the unreferenced 1.2 MB copy is not shipped`);
    assert.ok(fs.existsSync(path.join(assets, `laolao-mode-${id}-hd.png`)), `${id}: the picture in use stays`);
  }
});

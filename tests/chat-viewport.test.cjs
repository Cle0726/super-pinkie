const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {createDocument} = require('./fixtures/mini-dom.cjs');
const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-perf.js'), 'utf8');

function harness() {
  const document = createDocument();
  const make = document.createElement.bind(document);
  document.createElement = (tag) => {
    const el = make(tag), values = new Map();
    el.style = {setProperty: (key, value) => values.set(key, String(value)),
      getPropertyValue: (key) => values.get(key) || '', removeProperty: (key) => values.delete(key)};
    el.hasAttribute = (name) => el.attributes.has(name);
    el.appendChild = (child) => { el.append(child); return child; };
    return el;
  };
  document.documentElement.appendChild = (el) => document.documentElement.append(el);
  const observers = {intersection: [], resize: [], mutation: []};
  const observer = (kind) => class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers[kind].push(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); this.disconnected = true; }
    fire(entries) { this.callback(entries); }
  };
  const IntersectionObserver = observer('intersection');
  const ResizeObserver = observer('resize');
  const MutationObserver = observer('mutation');
  const frames = new Map(), intervals = new Map(), listeners = new Map();
  let nextId = 1;
  const window = {CSS: {supports: () => true}, IntersectionObserver, ResizeObserver,
    requestAnimationFrame(fn) { const id = nextId++; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setInterval(fn) { const id = nextId++; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); }};
  function addPane({native = false, count = 15, top = 450} = {}) {
    const pane = document.createElement('openclaw-chat-pane');
    pane.state = {sessionKey: `session-${document.documentElement.children.length}`, chatUserNearBottom: false, chatFollowLocked: true};
    pane.updateComplete = Promise.resolve();
    const thread = document.createElement('div'), inner = document.createElement('div');
    thread.className = 'chat-thread';
    inner.className = `chat-thread-inner${native ? ' chat-thread-inner--virtual' : ''}`;
    thread.scrollTop = top;
    thread.clientHeight = 300;
    thread.width = 800;
    thread.getBoundingClientRect = () => ({top: 20, bottom: 320, height: 300, width: thread.width});
    const height = (el) => el.hasAttribute('data-pinkie-offscreen')
      ? Number.parseFloat(el.style.getPropertyValue('contain-intrinsic-block-size'))
      : el.baseHeight * (thread.width < 600 ? 2 : 1);
    const rect = (el) => {
      const index = inner.children.indexOf(el);
      const top = 20 + inner.children.slice(0, index).reduce((sum, row) => sum + height(row), 0) - thread.scrollTop;
      const h = height(el);
      return {top, bottom: top + h, height: h, width: thread.width};
    };
    Object.defineProperty(thread, 'scrollHeight', {get: () => inner.children.reduce((sum, row) => sum + height(row), 0)});
    inner.getBoundingClientRect = () => ({top: 20 - thread.scrollTop, bottom: 20 + thread.scrollHeight - thread.scrollTop,
      height: thread.scrollHeight, width: thread.width});
    function addRow(id, baseHeight = 100) {
      const row = document.createElement('div');
      row.className = native ? 'chat-virtual-row' : 'chat-group';
      row.id = id;
      row.baseHeight = baseHeight;
      row.getBoundingClientRect = () => rect(row);
      inner.append(row);
      return row;
    }
    const rows = Array.from({length: count}, (_, index) => addRow(`message-${index}`));
    thread.append(inner); pane.append(thread); document.documentElement.append(pane);
    return {pane, thread, inner, rows, addRow};
  }
  function start() {
    vm.runInNewContext(source, {window, document, CSS: window.CSS, IntersectionObserver, ResizeObserver, MutationObserver,
      getComputedStyle: () => ({paddingTop: '0', paddingBottom: '0', borderTopWidth: '0', borderBottomWidth: '0'}),
      Map, Set, Array, Promise, Math, Number, parseFloat}, {filename: 'laolao-perf.js'});
    return window.__pinkieChatViewport;
  }
  async function flush() {
    for (let turn = 0; turn < 8; turn++) {
      await Promise.resolve();
      const batch = [...frames.values()]; frames.clear(); batch.forEach((fn) => fn());
    }
  }
  return {document, window, observers, frames, intervals, listeners, addPane, start, flush};
}

test('native virtual rows retain sole ownership of DOM, scrolling, and width changes', async () => {
  const h = harness(), p = h.addPane({native: true, count: 18});
  const api = h.start(); await h.flush();
  assert.equal(h.observers.intersection.length, 0);
  assert.equal(h.observers.resize.length, 0);
  assert.equal(h.observers.mutation.length, 0);
  const children = [...p.inner.children];
  const result = api.preserve(p.pane, () => { p.thread.scrollTop = 725; return 'unchanged'; });
  api.restore(api.capture(p.pane));
  p.thread.width = 400;
  h.listeners.get('resize')(); await h.flush();
  assert.equal(result, 'unchanged');
  assert.equal(p.thread.scrollTop, 725);
  assert.deepEqual(p.inner.children, children);
  assert.equal(p.inner.querySelectorAll('[data-pinkie-offscreen]').length, 0);
  assert.equal(api.inspect()[0].mountedRows, 18);
});

test('removing a history prefix preserves the visible message and its pixel offset', async () => {
  const h = harness(), p = h.addPane();
  const api = h.start(); await h.flush();
  const before = p.rows[4].getBoundingClientRect().top;
  api.preserve(p.pane, () => { p.rows[0].remove(); p.rows[1].remove(); });
  await h.flush();
  assert.equal(p.thread.scrollTop, 250);
  assert.equal(p.rows[4].getBoundingClientRect().top, before);
});

test('multiple updates before the same paint retain the original reading anchor', async () => {
  const h = harness(), p = h.addPane();
  const api = h.start(); await h.flush();
  const before = p.rows[4].getBoundingClientRect().top;
  api.preserve(p.pane, () => p.rows[0].remove());
  api.preserve(p.pane, () => p.rows[1].remove());
  await h.flush();
  assert.equal(p.thread.scrollTop, 250);
  assert.equal(p.rows[4].getBoundingClientRect().top, before);
});

test('the next visible message anchors when the first visible message is removed', async () => {
  const h = harness(), p = h.addPane();
  const api = h.start(); await h.flush();
  const before = p.rows[5].getBoundingClientRect().top;
  api.preserve(p.pane, () => p.rows[4].remove());
  await h.flush();
  assert.equal(p.rows[5].getBoundingClientRect().top, before);
  assert.equal(p.thread.scrollTop, 350);
});

test('anchor lookup survives Lit replacing a message element with the same ID', async () => {
  const h = harness(), p = h.addPane();
  const api = h.start(); await h.flush();
  const before = p.rows[4].getBoundingClientRect().top;
  const snapshot = api.capture(p.pane);
  const replacement = p.addRow('message-4');
  replacement.remove();
  const index = p.inner.children.indexOf(p.rows[4]);
  p.inner.children[index] = replacement; replacement.parentElement = p.inner; replacement.isConnected = true;
  p.rows[4].parentElement = null;
  p.rows[0].remove();
  api.restore(snapshot); await h.flush();
  assert.equal(replacement.getBoundingClientRect().top, before);
});

test('sidebar width changes invalidate parked heights and keep each pane independent', async () => {
  const h = harness(), left = h.addPane(), right = h.addPane({top: 600});
  const api = h.start(); await h.flush();
  const leftIO = h.observers.intersection.find((io) => io.targets.has(left.rows[0]));
  leftIO.fire([{target: left.rows[0], isIntersecting: false}]);
  assert.equal(left.rows[0].hasAttribute('data-pinkie-offscreen'), true);
  const anchorTop = left.rows[4].getBoundingClientRect().top;
  left.thread.width = 400;
  h.observers.resize.find((ro) => ro.targets.has(left.thread)).fire([]);
  await h.flush();
  assert.equal(left.rows[0].hasAttribute('data-pinkie-offscreen'), false);
  assert.equal(left.rows[4].getBoundingClientRect().top, anchorTop);
  assert.equal(left.thread.scrollTop, 850);
  assert.equal(right.thread.scrollTop, 600);
  assert.equal(api.inspect().length, 2);
});

test('only explicit unlocked follow at the bottom keeps following appended messages', async () => {
  const h = harness(), p = h.addPane({top: 1200});
  const api = h.start(); await h.flush();
  api.preserve(p.pane, () => p.addRow('unfollowed'));
  await h.flush();
  assert.equal(p.thread.scrollTop, 1200);
  p.thread.scrollTop = p.thread.scrollHeight - p.thread.clientHeight;
  p.pane.state.chatUserNearBottom = true; p.pane.state.chatFollowLocked = false;
  api.preserve(p.pane, () => p.addRow('followed'));
  await h.flush();
  assert.equal(p.thread.scrollTop, p.thread.scrollHeight - p.thread.clientHeight);
});

test('new reader input cancels a queued asynchronous anchor restoration', async () => {
  const h = harness(), p = h.addPane();
  const api = h.start(); await h.flush();
  let commit;
  p.pane.updateComplete = new Promise((resolve) => { commit = resolve; });
  api.preserve(p.pane, () => p.rows[0].remove());
  p.thread.dispatch('wheel', {deltaY: -100});
  p.thread.scrollTop = 100; p.thread.dispatch('scroll');
  commit(); await h.flush();
  assert.equal(p.thread.scrollTop, 100);
  assert.equal(p.thread.style.getPropertyValue('overflow-anchor'), '');
});

test('preserve waits for both optional async work and Lit updateComplete', async () => {
  const h = harness(), p = h.addPane();
  const api = h.start(); await h.flush();
  const anchorTop = p.rows[4].getBoundingClientRect().top;
  let finishWork, commit;
  const work = new Promise((resolve) => { finishWork = resolve; });
  p.pane.updateComplete = new Promise((resolve) => { commit = resolve; });
  assert.equal(api.preserve(p.pane, () => work), work);
  p.rows[0].remove(); await h.flush();
  assert.equal(p.thread.scrollTop, 450);
  finishWork(); await h.flush();
  assert.equal(p.thread.scrollTop, 450);
  commit(); await h.flush();
  assert.equal(p.rows[4].getBoundingClientRect().top, anchorTop);
});

test('session changes prevent old snapshots from restoring into the next conversation', async () => {
  const h = harness(), p = h.addPane();
  const api = h.start(); await h.flush();
  api.preserve(p.pane, () => { p.rows[0].remove(); p.pane.state.sessionKey = 'different-session'; });
  await h.flush();
  assert.equal(p.thread.scrollTop, 450);
});

test('same-key resets and controller replacements cannot replay an old reading position', async () => {
  for (const reset of [
    (pane) => { pane.state.currentSessionId = 'new-incarnation'; },
    (pane) => { pane.state = {...pane.state}; },
  ]) {
    const h = harness(), p = h.addPane();
    const api = h.start(); await h.flush();
    api.preserve(p.pane, () => { p.rows[0].remove(); reset(p.pane); });
    await h.flush();
    assert.equal(p.thread.scrollTop, 450);
  }
});

test('removed rows and panes release all observer and snapshot references', async () => {
  const h = harness(), p = h.addPane();
  const api = h.start(); await h.flush();
  const io = h.observers.intersection[0];
  io.fire([{target: p.rows[0], isIntersecting: false}]);
  p.rows[0].remove(); h.observers.mutation[0].fire([]); await h.flush();
  assert.equal(io.targets.has(p.rows[0]), false);
  assert.equal(p.rows[0].hasAttribute('data-pinkie-offscreen'), false);
  assert.equal(api.inspect()[0].observed, 14);
  p.inner.remove(); h.intervals.values().next().value();
  assert.equal(api.inspect().length, 0);
  assert.equal(io.targets.size, 0);
  assert.equal(h.observers.resize[0].targets.size, 0);
  assert.equal(h.observers.mutation[0].targets.size, 0);
});

test('dispose cancels pending work and install can reactivate without duplicate observers', async () => {
  const h = harness(), p = h.addPane();
  const api = h.start(); await h.flush();
  api.preserve(p.pane, () => p.rows[0].remove());
  api.dispose(); await h.flush();
  assert.equal(api.inspect().length, 0);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.frames.size, 0);
  assert.equal(p.thread.scrollTop, 450);
  api.install(); api.install(); await h.flush();
  assert.equal(api.inspect().length, 1);
  assert.equal(h.intervals.size, 1);
  assert.equal(h.observers.intersection.filter((io) => !io.disconnected).length, 1);
});

test('an upward programmatic clamp keeps the native follow state unlocked',async()=>{
 const h=harness(),p=h.addPane({top:1200});p.pane.state.chatUserNearBottom=true;p.pane.state.chatFollowLocked=false;
 h.start();await h.flush();const state=p.pane.state;
 // The native scroll handler used to classify any negative delta as reading.
 state.chatLastScrollTop=1200;state.chatIsProgrammaticScroll=true;
 for(const row of p.rows.slice(0,4))row.remove();p.thread.scrollTop=800;state.chatProgrammaticScrollTarget=p.thread.scrollHeight;
 p.thread.addEventListener('scroll',()=>{const delta=p.thread.scrollTop-state.chatLastScrollTop;state.chatLastScrollTop=p.thread.scrollTop;
  if(state.chatIsProgrammaticScroll&&delta>=0&&p.thread.scrollTop>=state.chatProgrammaticScrollTarget-p.thread.clientHeight)return;
  if(delta<0&&p.thread.scrollHeight-p.thread.scrollTop-p.thread.clientHeight>100)state.chatFollowLocked=true;
 });
 p.thread.dispatch('scroll');assert.equal(state.chatLastScrollTop,800);assert.equal(state.chatFollowLocked,false);assert.equal(state.chatUserNearBottom,true);
 await h.flush();assert.equal(state.chatIsProgrammaticScroll,false);
});

test('viewport restoration publishes the exact native scroll baseline before layout events',async()=>{
 const h=harness(),p=h.addPane({top:450}),api=h.start();await h.flush();
 api.preserve(p.pane,()=>{p.rows[0].remove();});
 p.thread.scrollTop=200;p.thread.dispatch('scroll');assert.equal(p.pane.state.chatLastScrollTop,200);assert.equal(p.pane.state.chatIsProgrammaticScroll,true);
 await h.flush();assert.equal(p.pane.state.chatLastScrollTop,p.thread.scrollTop);
});

test('an explicit send cancels an old reader anchor and follows the next append',async()=>{
 const h=harness(),p=h.addPane({top:450}),api=h.start();await h.flush();
 api.preserve(p.pane,()=>{p.rows[0].remove();});api.follow(p.pane);
 p.pane.state.chatFollowLocked=false;p.pane.state.chatUserNearBottom=true;
 api.preserve(p.pane,()=>p.addRow('new-user',200));await h.flush();
 assert.equal(p.thread.scrollTop,p.thread.scrollHeight-p.thread.clientHeight);
});

test('Lit reusing a row for a different message cannot replace the reading anchor', async () => {
  const h = harness(), p = h.addPane();
  for (let i=0;i<p.rows.length;i++) {
    p.rows[i].id=''; const bubble=h.document.createElement('div');bubble.className='chat-bubble';bubble.id=`msg:assistant:${1000+i}:${i}`;p.rows[i].append(bubble);
  }
  const api=h.start();await h.flush();const before=p.rows[4].getBoundingClientRect().top;
  const snapshot=api.capture(p.pane);
  // Lit keeps the group nodes and patches their content after the leading two
  // messages leave the page. The old node now contains a different message.
  for(let i=0;i<p.rows.length;i++)p.rows[i].querySelector('.chat-bubble').id=`msg:assistant:${1002+i}:${i}`;
  api.restore(snapshot);await h.flush();
  assert.equal(p.rows[2].getBoundingClientRect().top,before);
  assert.equal(p.thread.scrollTop,250);
});

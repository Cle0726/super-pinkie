const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const load = () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-session-cards.js'), 'utf8'), {window});
  return window.PinkieSessionCards;
};
const proposal = {kind: 'proposal', state: 'pending', expiresAt: 2000};
const plain = value => JSON.parse(JSON.stringify(value));

test('offer and initiative cards expose exactly their intended actions', () => {
  const {cardActions} = load();
  assert.deepEqual(plain(cardActions({...proposal, initiation: 'offer'}, 1000)), [['start', '开新会话'], ['here', '就在这里做']]);
  assert.deepEqual(plain(cardActions({...proposal, initiation: 'own_initiative'}, 1000)), [['start', '开始'], ['dismiss', '不用了']]);
});

test('reports, expired cards and previously handled cards offer no action', () => {
  const {cardActions, proposalState} = load();
  assert.equal(proposalState(proposal, 2000), 'expired');
  assert.equal(proposalState({...proposal, state: 'started'}, 2000), 'started');
  for (const card of [proposal, {...proposal, state: 'dismissed'}, {...proposal, state: 'here'}, {kind: 'report'}]) {
    assert.deepEqual(plain(cardActions(card, 2000)), []);
  }
});

test('cards use exact entry anchors and fall back to the nearest dated message', () => {
  const {chooseAnchor} = load();
  const messages = [{ids:['msg:old'],at:1000},{ids:['msg:new'],at:5000}];
  assert.equal(chooseAnchor({anchor:{entryId:'old'},createdAt:4900},messages),0);
  assert.equal(chooseAnchor({createdAt:4900},messages),1);
  assert.equal(chooseAnchor({createdAt:4900},[{ids:[],at:NaN}]),-1);
});

test('fork uses real message identifiers, not generated timestamp placeholders', () => {
  const {forkEntryId} = load();
  const history=[{role:'assistant',id:'ui-id',timestamp:123,__openclaw:{id:'entry-id'}},
    {role:'assistant',timestamp:456,__openclaw:{id:'other-entry'}}];
  assert.equal(forkEntryId('msg:ui-id',history),'entry-id');
  assert.equal(forkEntryId('msg:assistant:456:1',history),'other-entry');
  assert.equal(forkEntryId('msg:assistant:456:0',history),'other-entry');
  assert.equal(forkEntryId('msg:assistant:123:2',history),'');
  assert.equal(forkEntryId('msg:assistant:456:0',[...history,history[1]]),'');
  assert.equal(forkEntryId('msg:a1b2c3',[]),'');
  assert.equal(forkEntryId('stream:live',history),'');
});

test('card alignment follows assistant text while staying inside the composer', () => {
  const {cardMeasure} = load();
  const input = {left: 100, right: 900, width: 800};
  assert.deepEqual(plain(cardMeasure(input, {left: 140, right: 920, width: 780})), {left: 140, width: 760});
  assert.deepEqual(plain(cardMeasure(input, {left: 0, right: 0, width: 0})), {left: 100, width: 800});
  assert.equal(cardMeasure({left: 0, right: 0, width: 0}, null), null);
});

test('pinkie_sessions confirmation cards: confirm / skip while pending, nothing once handled or expired', () => {
  const {cardActions, manageSummary} = load();
  const card = {kind: 'manage', action: 'archive', actionName: '归档', targetTitle: '做网站', state: 'pending', expiresAt: 2000};
  assert.deepEqual(plain(cardActions(card, 1000)), [['run', '确认归档'], ['dismiss', '不用了']]);
  assert.deepEqual(plain(cardActions(card, 2000)), []);
  for (const state of ['done', 'failed', 'dismissed']) assert.deepEqual(plain(cardActions({...card, state}, 1000)), []);
  assert.equal(manageSummary(card), '归档「做网站」');
  assert.equal(manageSummary({...card, action: 'rename', actionName: '改名', title: '新名'}), '改名「做网站」 → 「新名」');
});

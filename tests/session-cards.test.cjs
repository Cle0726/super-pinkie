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

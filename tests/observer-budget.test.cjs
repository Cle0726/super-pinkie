const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('typed chat does not snapshot or clone assistant history for voice',()=>{
  const source=read('ui/injections/laolao-live-voice.js');
  assert.doesNotMatch(source,/cloneNode\(/);
  assert.match(source,/if \(!track && !waitingForVoiceReply\) return;/);
  assert.match(source,/if \(!fromVoice\) return;/);
  assert.match(source,/if \(!waitingForVoiceReply && tracks\.size === 0\) return;/);
});

test('phrase localization scans body only at startup and observes app-local changes',()=>{
  const source=read('ui/injections/laolao-phrases.js');
  assert.equal((source.match(/localizeTree\(document\.body\)/g)||[]).length,1);
  assert.doesNotMatch(source,/fullScanScheduled|scheduleFullScan/);
  assert.doesNotMatch(source,/\.observe\(document\.body,/);
  assert.match(source,/document\.querySelector\("openclaw-app"\)/);
  assert.match(source,/localizeAddedSubtree\(node\)/);
  assert.match(source,/syncBrandTitle\(\)/);
});

test('stream cursor disconnects observers when a streaming bubble finishes or is removed',()=>{
  const source=read('ui/injections/laolao-stream-fx.js');
  assert.match(source,/const bubbleObservers = new Map\(\)/);
  assert.match(source,/observer\?\.disconnect\(\)/);
  assert.match(source,/bubbleObservers\.delete\(bubble\)/);
  assert.match(source,/pendingCursorBubbles\.delete\(bubble\)/);
  assert.match(source,/if \(m\.removedNodes\.length\) needScan = true;/);
  assert.doesNotMatch(source,/wiredBubbles|subtreeObserver/);
});

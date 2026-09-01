const {test} = require('node:test');
const assert = require('node:assert/strict');
const drafts = require('../ui/party/party-drafts.js');
const a = 'a'.repeat(32), b = 'b'.repeat(32);
function storage() {
  const data = new Map();
  return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
}
test('drafts are separate per room and survive a new reader', () => {
  const disk = storage();
  drafts.save(disk,a,{text:'甲的草稿',recipient:'codex',reply:{id:12,sender:'pinkie',body:'引用'}});
  drafts.save(disk,b,{text:'乙的草稿'});
  assert.equal(drafts.read(disk,a).text,'甲的草稿');
  assert.equal(drafts.read(disk,b).text,'乙的草稿');
  assert.equal(drafts.read(disk,a).reply.id,12);
  assert.equal(drafts.read(disk,a).permission,undefined);
});
test('damaged or unavailable storage does not prevent opening chat', () => {
  assert.equal(drafts.read({getItem(){throw Error('private mode');}},a).text,'');
  assert.equal(drafts.read({getItem(){return '{broken';}},a).text,'');
  assert.equal(drafts.read(storage(),'invalid').text,'');
});
test('an older send response cannot erase a newer draft or reply', () => {
  const disk=storage();drafts.save(disk,a,{text:'新的内容',recipient:'codex'});
  assert.equal(drafts.clearIfUnchanged(disk,a,{text:'已发送',recipient:'codex',reply:null}),false);
  assert.equal(drafts.read(disk,a).text,'新的内容');
  drafts.save(disk,a,{text:'已发送',recipient:'codex',reply:{id:4}});
  assert.equal(drafts.clearIfUnchanged(disk,a,{text:'已发送',recipient:'codex',reply:3}),false);
  assert.equal(drafts.clearIfUnchanged(disk,a,{text:'已发送',recipient:'codex',reply:4}),true);
  assert.equal(drafts.read(disk,a).text,'');
});
test('empty draft is cleared while a standalone quoted reply is retained', () => {
  const disk=storage();drafts.save(disk,a,{text:'',reply:{id:9}});
  assert.equal(drafts.read(disk,a).reply.id,9);
  drafts.save(disk,a,{text:''});assert.equal(drafts.read(disk,a).reply,null);
});
test('retry after reload uses same request id until acknowledged', () => {
  const disk=storage(), payload={agent:'codex',text:'检查',permission:'read-only'};
  const first=drafts.requestId(disk,a,payload,()=> 'id-one');
  assert.equal(drafts.requestId(disk,a,payload,()=> 'id-two'),first);
  assert.equal(drafts.requestId(disk,b,payload,()=> 'id-other-room'),'id-other-room');
  drafts.acknowledge(disk,a,'wrong-id');
  assert.equal(drafts.requestId(disk,a,payload,()=> 'id-three'),first);
  drafts.acknowledge(disk,a,first);
  assert.equal(drafts.requestId(disk,a,payload,()=> 'id-new'),'id-new');
});
test('changed prompt or permission gets a new request id', () => {
  const disk=storage();
  drafts.requestId(disk,a,{text:'A',permission:'read-only'},()=> 'read');
  assert.equal(drafts.requestId(disk,a,{text:'A',permission:'workspace-write'},()=> 'write'),'write');
});

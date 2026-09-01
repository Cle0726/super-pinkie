const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const art=require('../ui/party/party-room-art.js');
const rooms=[{id:'a',created:1},{id:'b',created:2},{id:'c',created:3}];
test('first four rooms receive distinct object illustrations, never character portraits',()=>{
  const four=[...rooms,{id:'d',created:4}];
  assert.equal(new Set(four.map(r=>art.forRoom(r,four))).size,4);
  for(const url of art.urls){
    assert.match(url,/^\/room-(invitation|notebook|giftbox|toolbox)\.png$/);
    const asset=path.join(__dirname,'../ui/assets/laolao-party-'+url.slice(1,-4)+'-v1.png');
    assert.ok(fs.statSync(asset).size>10000);
  }
});
test('rename, archive, list order and new rooms keep existing room emblems stable',()=>{
  const altered=[{id:'d',created:4},...rooms.map(r=>({...r,name:'重命名',archived:true})).reverse()];
  for(const room of rooms)assert.equal(art.forRoom(room,rooms),art.forRoom(room,altered));
  assert.deepEqual(rooms.map(r=>r.id),['a','b','c']);
});
test('equal timestamps remain deterministic and empty rooms have an invitation',()=>{
  const equal=rooms.map(r=>({...r,created:1}));
  for(const room of equal)assert.equal(art.forRoom(room,equal),art.forRoom(room,[...equal].reverse()));
  assert.equal(art.forRoom(null,[]),'/room-invitation.png');
});
test('room list keeps emblems; removed header and decorative project card do not return',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../ui/party/party.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../ui/party/index.html'),'utf8');
  assert.match(js,/emblem.src=roomArt.forRoom\(room,state.rooms\)/);
  assert.doesNotMatch(html,/class="chat-header"|id="room-emblem"|id="room-title"|id="room-subtitle"/);
  assert.match(html,/id="find-message"/);assert.match(html,/id="room-settings"/);
  assert.doesNotMatch(html,/princess-card/);
  assert.doesNotMatch(html,/workbench-card|\/workbench.png|给灵感留个座位/);
  assert.doesNotMatch(js,/\/workbench.png/,'unused artwork must not delay opening the party');
  assert.match(html,/id="project-path"/);
  assert.match(html,/id="copy-path"/);
  assert.match(html,/id="show-project"/);
});
test('all six frontend pony names agree with the model identity registry',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../ui/party/party.js'),'utf8');
  const {names}=JSON.parse(fs.readFileSync(path.join(__dirname,'../services/party/identities.json'),'utf8'));
  assert.equal(Object.keys(names).length,6);
  for(const [member,name] of Object.entries(names))assert.ok(js.includes(member+":'"+name+"'"));
  assert.doesNotMatch(js,/随时可以叫我/);
  assert.ok(js.includes("'随时可以叫'+names[agent.id]"));
});

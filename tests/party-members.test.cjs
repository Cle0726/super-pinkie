const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,'../ui/party',n),'utf8');
test('built-in consultation agent is branded CLE Kk without changing its stored id',()=>{
  const js=read('party.js');
  const server=fs.readFileSync(path.join(__dirname,'../services/party/server.py'),'utf8');
  assert.match(js,/openclaw:'CLE Kk'/);
  assert.match(server,/'openclaw': 'CLE Kk'/);
  assert.doesNotMatch(js,/openclaw:'OpenClaw'/);
  assert.match(js,/\['codex','openclaw'\]/);
});
test('member rail defaults collapsed, expands and persists, survives unavailable storage',()=>{
  for(const unavailable of [false,true]){
    const shell={dataset:{}},toggle={attrs:{},setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]}};
    const values=new Map(),storage={getItem(k){if(unavailable)throw Error();return values.get(k)},setItem(k,v){if(unavailable)throw Error();values.set(k,v)}};
    const js=read('party.js');const code=js.slice(js.indexOf('  const memberRailKey='),js.indexOf("  $('copy-path').onclick="));
    const context={document:{querySelector:()=>shell},$:()=>toggle,localStorage:storage};vm.createContext(context);vm.runInContext(code,context);
    assert.equal(shell.dataset.membersCollapsed,'true');assert.equal(toggle.attrs['aria-expanded'],'false');
    toggle.onclick();assert.equal(shell.dataset.membersCollapsed,'false');assert.equal(toggle.attrs['aria-expanded'],'true');
    if(!unavailable)assert.equal(values.get('pinkie.party.members.collapsed.v1'),'false');
    toggle.onclick();assert.equal(shell.dataset.membersCollapsed,'true');assert.equal(toggle.attrs['aria-label'],'展开成员栏');
  }
});
test('collapsed column retains avatars and accessible @ buttons, hides details rather than chat',()=>{
  const css=read('party-art.css'),html=read('index.html'),js=read('party.js');
  assert.match(css,/data-members-collapsed="true"\]\{--members-width:80px\}/);
  assert.match(css,/\.member-info\{display:none\}/);
  assert.match(html,/id="toggle-members"[^>]*aria-controls="members-panel"/);
  assert.doesNotMatch(html,/class="chat-header"/);
  assert.match(js,/at.setAttribute\('aria-label',at.title\)/);
  assert.match(js,/at.disabled=!\(agent.available/);
});

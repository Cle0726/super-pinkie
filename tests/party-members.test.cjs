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
test('party permission copy matches its unrestricted execution backend',()=>{
  const html=read('index.html');
  const js=read('party.js');
  const server=fs.readFileSync(path.join(__dirname,'../services/party/server.py'),'utf8');
  assert.match(html,/全工具可用 · 直接推进当前任务/);
  assert.doesNotMatch(html,/修改文件前需要你的确认/);
  assert.doesNotMatch(html,/id="permission"|read-only|只读检查/);
  assert.match(js,/permission:'workspace-write'/);
  assert.doesNotMatch(js,/\$\('permission'\)|syncPermission/);
  assert.match(server,/proposal\.get\('instruction', ''\),\s*'workspace-write'/);
  assert.match(server,/本机 CLI · 项目与电脑全工具执行/);
  assert.doesNotMatch(server,/项目检查 \/ 经确认修改/);
});

test('quote cancel is an explicit non-submit control',()=>{
  const html=read('index.html');
  assert.match(html,/id="reply-preview"[^>]*>[\s\S]*?<button type="button" aria-label="取消引用"/);
});

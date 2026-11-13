// 输入框下面的「工具箱」、模式专属按钮和首页的空白新会话（11-12 用户反馈）。
// 这几块在 Edge + 假网关里点过、截过图（docs/AUDIT-1112-HANDOFF.md 第 10 节）；这里守住不能被改回去的几条。
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('the tray is registered and only folds controls while its script marked the page',()=>{
  const head=read('ui/injections/laolao-head.fragment.html');
  assert.match(head,/laolao-composer-tray\.css\?v=/);
  assert.match(head,/<script defer src="\/laolao-composer-tray\.js\?v=/);
  const css=read('ui/injections/laolao-composer-tray.css');
  // Every rule that hides an original control is gated on html[data-pinkie-tray="1"].
  for(const rule of css.matchAll(/([^{}]+)\{\s*display:\s*none !important;/g)){
    if(rule[1].includes('#laolao-project-scope'))continue;
    assert.match(rule[1],/html\[data-pinkie-tray="1"\]/,rule[1]);
  }
  // Only controls in their default state fold away; a non-default one stays visible.
  assert.match(css,/\.laolao-research-btn:not\(\.is-on\)/);
  assert.match(css,/\.pinkie-chip--web\[aria-pressed="true"\]/);
  assert.match(css,/\.pinkie-chip--style\[data-style="default"\]/);
  const js=read('ui/injections/laolao-composer-tray.js');
  assert.match(js,/root\.setAttribute\('data-pinkie-tray', '1'\)/);
  // Rows forward the click to the original control instead of re-implementing it.
  assert.match(js,/node\.click\(\)/);
  assert.match(js,/option\.click\(\)/);
});

test('mode-only chips: 工作程度 in project mode, 想法取向 in ideas mode, kept outside the tray',()=>{
  const tools=read('ui/injections/laolao-session-tools.js');
  assert.match(tools,/project: \{\s*field: 'pace'/);
  assert.match(tools,/thinking: \{\s*field: 'lens'/);
  for(const value of ['fast','strict','diverge','converge','critic'])assert.match(tools,new RegExp(`value: '${value}'`));
  assert.match(tools,/controls\.append\(mode\)/);
  // A prefs answer without a field must not flip the web switch the wrong way.
  assert.match(tools,/value = \{\.\.\.value, \.\.\.got, web: got\.web !== false\}/);
  // The unbound-folder label is only noise outside project mode.
  assert.match(read('ui/injections/laolao-sidebar.js'),/label\.dataset\.bound=binding\?'true':'false'/);
  assert.match(read('ui/injections/laolao-composer-tray.css'),/html:not\(\[data-laolao-mode="project"\]\) #laolao-project-scope\[data-bound="false"\]/);
});

test('home binds the composer to a blank new session instead of borrowing the last one',()=>{
  const home=read('ui/injections/laolao-startup-home.js');
  // Prepared quietly and without navigating; the home page decides when to switch.
  assert.match(home,/api\.createSession\(\{quiet: true, stay: true\}\)/);
  // An existing blank session is reused only after its history proves it has no messages.
  assert.match(home,/chat\.history', \{sessionKey: item\.key, limit: 1\}/);
  // Sending from a ready draft neither creates nor navigates again.
  assert.match(home,/if \(useDraft\) \{ \/\*/);
  // The fallback path carries the model and thinking level seen on the home page.
  assert.match(home,/async function carrySettings\(from, to, selected\)/);
  assert.match(home,/patch\.thinkingLevel = row\.thinkingLevel/);
  // The draft is neither a recent item nor a sidebar row before its first message.
  assert.match(home,/item\.key !== draft\?\.key/);
  const list=read('ui/injections/laolao-session-list.js');
  assert.match(list,/s\.key !== homeDraft/);
  const sidebar=read('ui/injections/laolao-sidebar.js');
  assert.match(sidebar,/if\(!options\.stay\)navigateSession\(key\)/);
  assert.match(sidebar,/createSession: \(options = \{\}\) => createProjectSession\(null, \{\.\.\.options, plain: true\}\)/);
});

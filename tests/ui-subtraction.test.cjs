const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('UI subtraction keeps features while compacting sidebar and composer',()=>{
  const css=read('ui/injections/laolao-ui-subtraction.css');
  assert.match(css,/grid-template-columns: 238px minmax\(0, 1fr\)/);
  assert.match(css,/#laolao-session-manager \.sidebar-recent-session/);
  assert.match(css,/\.session-row-trail[\s\S]*display: none/);
  assert.match(css,/\.agent-chat__composer-actions[\s\S]*display: flex/);
  assert.doesNotMatch(css,/display:\s*none[^}]*agent-chat__composer-actions/);
});

test('decorative percentages are hidden but progress implementation remains installed',()=>{
  const css=read('ui/injections/laolao-ui-subtraction.css');
  const progress=read('ui/injections/laolao-progress.js');
  assert.match(css,/\.laolao-splash__percentage/);
  assert.match(css,/\.laolao-mode-transition__percentage/);
  assert.match(progress,/chatShowToolCalls:true/);
});

test('all feature notices share the sidebar toast outlet',()=>{
  const sidebar=read('ui/injections/laolao-sidebar.js');
  const deep=read('ui/injections/laolao-deep-think.js');
  const compact=read('ui/injections/laolao-context-compact.js');
  assert.match(sidebar,/window\.__laolaoToast = toast/);
  assert.match(sidebar,/addEventListener\("laolao:toast"/);
  assert.match(deep,/window\.__laolaoToast/);
  assert.match(compact,/window\.__laolaoToast/);
  assert.doesNotMatch(deep,/getElementById\("laolao-deep-think-toast"\)/);
  assert.doesNotMatch(compact,/getElementById\("laolao-context-compact-toast"\)/);
});

test('session rows keep titles and actions but drop permanent relative timestamps',()=>{
  const managed=read('ui/injections/laolao-session-list.js');
  const sidebar=read('ui/injections/laolao-sidebar.js');
  assert.match(managed,/sidebar-recent-session__name/);
  assert.match(managed,/laolao-row-actions/);
  assert.doesNotMatch(managed,/timeLabel\(/);
  assert.doesNotMatch(sidebar,/function relTime\(/);
});

test('welcome card stylesheet is wired into both installers',()=>{
  const head=read('ui/injections/laolao-head.fragment.html');
  assert.match(head,/laolao-welcome-card\.css\?v=welcome1/);
  assert.match(read('installer/macos/apply-theme.sh'),/laolao-welcome-card\.css/);
  assert.match(read('installer/windows/apply-theme.ps1'),/laolao-welcome-card\.css/);
});

test('installer ships the subtraction stylesheet without replacing the pink theme',()=>{
  const installer=read('installer/macos/apply-theme.sh');
  const head=read('ui/injections/laolao-head.fragment.html');
  assert.match(installer,/laolao-ui-subtraction\.css/);
  assert.match(head,/laolao-theme\.css/);
  assert.match(head,/laolao-ui-subtraction\.css/);
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('memory manager is current-mode scoped and uses themed in-app confirmation',()=>{
  const js=read('ui/injections/laolao-memory.js');
  const css=read('ui/injections/laolao-memory.css');
  for(const method of ['pinkie.memory.list','pinkie.memory.remember','pinkie.memory.forget','pinkie.memory.clear'])assert.match(js,new RegExp(method.replaceAll('.','\\.')));
  for(const mode of ['唠嗑模式','项目模式','想法模式','无限制模式'])assert.match(js,new RegExp(mode));
  assert.match(js,/CLEAR_CURRENT_MEMORY/);
  assert.match(js,/不会影响其他模式/);
  assert.match(js,/物理独立保存，不会串到其他模式/);
  assert.doesNotMatch(js,/\bconfirm\s*\(/);
  assert.doesNotMatch(js,/new MutationObserver/);
  assert.match(css,/backdrop-filter: blur/);
  assert.match(css,/prefers-reduced-motion/);
});

test('memory UI is shipped by both desktop installers',()=>{
  const mac=read('installer/macos/apply-theme.sh');
  const windows=read('installer/windows/apply-theme.ps1');
  const head=read('ui/injections/laolao-head.fragment.html');
  for(const file of ['laolao-memory.css','laolao-memory.js']){
    assert.match(mac,new RegExp(file.replace('.','\\.')));
    assert.match(windows,new RegExp(file.replace('.','\\.')));
    assert.match(head,new RegExp(file.replace('.','\\.')));
  }
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const source=fs.readFileSync(path.join(__dirname,'../app/windows_desktop.py'),'utf8');
const match=/NATIVE_READING_SCRIPT = r"""([\s\S]*?)"""/.exec(source);
assert.ok(match,'the test executes the actual native reading-surface script');

function harness(withBody=true) {
  const attributes=new Map(), writes=[], observers=[], events=new Map();
  const root={hasAttribute:k=>attributes.has(k),getAttribute:k=>attributes.get(k)||null};
  const body={style:{setProperty:(...args)=>writes.push(args)}};
  const document={documentElement:root,body:withBody?body:null,addEventListener:(name,fn)=>events.set(name,fn)};
  class MutationObserver { constructor(fn){this.fn=fn;observers.push(this)} observe(target,options){this.target=target;this.options=options} }
  const window={};
  const run=()=>vm.runInNewContext(match[1],{window,document,MutationObserver});
  return {attributes,writes,observers,events,document,body,window,run};
}

test('accepted light and dark glass adjust only the background paint',()=>{
  const h=harness();h.run();
  assert.deepEqual(h.writes.at(-1),['background-color','rgba(255,250,249,.94)','important']);
  h.attributes.set('data-theme-mode','dark');h.observers[0].fn();
  assert.deepEqual(h.writes.at(-1),['background-color','rgba(20,17,25,.96)','important']);
  h.attributes.delete('data-theme-mode');h.observers[0].fn();
  assert.deepEqual(h.writes.at(-1),['background-color','rgba(255,250,249,.94)','important']);
  assert.ok(h.writes.every(([property])=>property==='background-color'));
  assert.equal(h.window.__pinkieNativeReadingSurface.lightAlpha,.94);
  assert.equal(h.window.__pinkieNativeReadingSurface.darkAlpha,.96);
  h.run();assert.equal(h.observers.length,1,'re-injection must not duplicate observers');
});

test('early injection waits for the body and the host actually installs it',()=>{
  const h=harness(false);h.run();assert.equal(h.writes.length,0);
  h.document.body=h.body;h.events.get('DOMContentLoaded')();
  assert.equal(h.writes.length,1);
  assert.match(source,/window\.evaluate_js\(NATIVE_READING_SCRIPT \+ BRIDGE_SCRIPT\)/);
  assert.doesNotMatch(match[1],/prefers-reduced-motion|animation\s*:\s*none|style\.opacity/);
});

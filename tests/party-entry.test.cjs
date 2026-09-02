const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../ui/injections/laolao-party-entry.js'),'utf8');
function fixture(){
  class Element{
    constructor(tag){this.tag=tag;this.children=[];this.parentElement=null;this.attributes={};}
    append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null;}
    setAttribute(k,v){this.attributes[k]=v;}
  }
  const root=new Element('html'),head=new Element('head'),sidebar=new Element('section');
  let rail=new Element('aside'),observer;
  root.append(head,sidebar,rail);
  const walk=n=>[n,...n.children.flatMap(walk)];
  const old=new Element('a');old.id='pinkie-party-entry';sidebar.append(old);
  const document={head,documentElement:root,currentScript:{src:'http://127.0.0.1:18789/laolao-party-entry.js'},
    querySelector:selector=>selector==='.chat-workspace-rail'?rail:null,
    getElementById:id=>walk(root).find(n=>n.id===id),createElement:tag=>new Element(tag)};
  const native=[];
  vm.runInNewContext(source,{document,location:{href:'http://127.0.0.1:18789/'},URL,
    window:{webkit:{messageHandlers:{laolaoParty:{postMessage:v=>native.push(v)}}}},
    requestAnimationFrame:fn=>fn(),setInterval:fn=>{observer=fn;return 0;},
    MutationObserver:class{constructor(fn){observer=fn;}observe(){}}});
  return{document,sidebar,native,observer,rail:()=>rail,replaceRail(){rail.remove();rail=new Element('aside');root.append(rail);observer();},removeRail(){rail.remove();rail=null;observer();}};
}
test('entry moves from old sidebar to right rail with real princess asset',()=>{
  const f=fixture(),link=f.document.getElementById('pinkie-party-entry');
  assert.equal(link.parentElement,f.rail());assert.equal(f.sidebar.children.length,0);
  assert.equal(link.children[0].src,'http://127.0.0.1:18789/laolao-party-avatar-v1.png');
  assert.equal(link.children[1].textContent,'派对空间');
  let prevented=false;link.onclick({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(f.native[0].action,'open');
});
test('entry survives rail replacement without duplicates or floating on other pages',()=>{
  const f=fixture();f.observer();f.observer();assert.equal(f.rail().children.length,1);
  f.replaceRail();assert.equal(f.rail().children.length,1);
  assert.equal(f.document.getElementById('pinkie-party-entry').parentElement,f.rail());
  f.removeRail();assert.equal(f.document.getElementById('pinkie-party-entry'),undefined);
});

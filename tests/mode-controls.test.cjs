const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../ui/injections/laolao-mode-switcher.js'),'utf8');
const start=source.indexOf('  const renderModeButton =');
const end=source.indexOf('  const openMenu =',start);
class Element{
  constructor(tag){
    this.tag=tag;this.dataset={};this.children=[];this.attributes={};this.renders=0;
    this.className='';this.style={setProperty(){}};this.listeners=[];
    this.classList={
      add:(...names)=>{this.className=[...new Set(`${this.className} ${names.join(' ')}`.trim().split(/\s+/))].filter(Boolean).join(' ');},
      remove:(...names)=>{this.className=this.className.split(/\s+/).filter(name=>name&&!names.includes(name)).join(' ');},
      contains:name=>this.className.split(/\s+/).includes(name),
    };
  }
  setAttribute(key,value){this.attributes[key]=value;if(key==='class')this.className=value;}
  append(...children){this.children.push(...children.filter(Boolean));}
  addEventListener(...args){this.listeners.push(args);}
  remove(){this.removed=true;}
  cloneNode(deep=false){const copy=new Element(this.tag);Object.assign(copy,{dataset:{...this.dataset},attributes:{...this.attributes},className:this.className,src:this.src,alt:this.alt,draggable:this.draggable});if(deep)copy.children=this.children.map(child=>child.cloneNode(true));return copy;}
  querySelector(selector){
    const matches=child=>selector==='img'?child.tag==='img':selector.startsWith('.')?child.classList.contains(selector.slice(1)):child.tag===selector;
    for(const child of this.children){if(matches(child))return child;const found=child.querySelector?.(selector);if(found)return found;}
    return null;
  }
  replaceChildren(...children){this.children=children;this.renders++;}
}
const draw=vm.runInNewContext(source.slice(start,end)+';renderModeButton',{document:{createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)}});
test('five mode buttons use HD portraits and crisp native text, not opaque banner images',()=>{
  for(const [id,label] of [['chat','唠嗑模式'],['project','项目模式'],['thinking','想法模式'],['learning','学习模式'],['unrestricted','无限制模式']]){
    const button=new Element('button');draw(button,{id,label,avatar:`./laolao-mode-${id}-hd.png`});
    const portrait=button.children[0];const avatar=portrait.querySelector('img');
    assert.equal(button.dataset.mode,id);assert.equal(portrait.tag,'span');assert.ok(portrait.classList.contains('laolao-mode-button__portrait'));
    assert.equal(portrait.dataset.mode,id);assert.equal(portrait.attributes['aria-hidden'],'true');assert.match(avatar.src,/-hd\.png$/);
    assert.equal(avatar.alt,'');assert.equal(avatar.draggable,false);
    assert.ok(portrait.querySelector('.laolao-mode-button__halo'));assert.ok(portrait.querySelector('.laolao-mode-button__fx'));assert.ok(portrait.querySelector('.laolao-mode-button__fx-star'));
    const bubbles=portrait.querySelector('.laolao-mode-button__fx-bubbles');
    if(id==='thinking')assert.equal(bubbles.children.length,3);else assert.equal(bubbles,null);
    assert.equal(button.children[1].textContent,label);
    assert.equal(button.children[2].attributes['aria-hidden'],'true');
  }
});
test('mutation observer repaint stays idempotent and changes avatar only on mode changes',()=>{
  const button=new Element('button');const chat={id:'chat',label:'唠嗑模式',avatar:'chat-hd.png'};
  draw(button,chat);draw(button,chat);assert.equal(button.renders,1);
  draw(button,{id:'project',label:'项目模式',avatar:'project-hd.png'});
  assert.equal(button.renders,2);assert.equal(button.children[0].querySelector('img').src,'project-hd.png');
});
test('learning mode has its own session and visual asset keys',()=>{
  assert.match(source,/id: "learning"/);
  assert.match(source,/agent:learning:main/);
  assert.match(source,/laolao-mode-learning-hd\.png/);
  assert.match(source,/laolao-mode-transition-learning\.png/);
});

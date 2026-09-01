const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../ui/injections/laolao-mode-switcher.js'),'utf8');
const start=source.indexOf('  const renderModeButton =');
const end=source.indexOf('  const openMenu =',start);
class Element{
  constructor(tag){this.tag=tag;this.dataset={};this.children=[];this.attributes={};this.renders=0;}
  setAttribute(key,value){this.attributes[key]=value;}
  querySelector(selector){return this.children.find(child=>'.'+child.className===selector);}
  replaceChildren(...children){this.children=children;this.renders++;}
}
const draw=vm.runInNewContext(source.slice(start,end)+';renderModeButton',{document:{createElement:tag=>new Element(tag)}});
test('four mode buttons use HD portraits and crisp native text, not opaque banner images',()=>{
  for(const [id,label] of [['chat','唠嗑模式'],['project','项目模式'],['thinking','想法模式'],['unrestricted','无限制模式']]){
    const button=new Element('button');draw(button,{id,label,avatar:`./laolao-mode-${id}-hd.png`});
    assert.equal(button.dataset.mode,id);assert.match(button.children[0].src,/-hd\.png$/);
    assert.equal(button.children[0].alt,'');assert.equal(button.children[0].draggable,false);
    assert.equal(button.children[1].textContent,label);
    assert.equal(button.children[2].attributes['aria-hidden'],'true');
  }
});
test('mutation observer repaint stays idempotent and changes avatar only on mode changes',()=>{
  const button=new Element('button');const chat={id:'chat',label:'唠嗑模式',avatar:'chat-hd.png'};
  draw(button,chat);draw(button,chat);assert.equal(button.renders,1);
  draw(button,{id:'project',label:'项目模式',avatar:'project-hd.png'});
  assert.equal(button.renders,2);assert.equal(button.children[0].src,'project-hd.png');
});

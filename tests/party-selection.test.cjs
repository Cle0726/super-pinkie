const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'../ui/party/',name),'utf8');
const css=read('party.css').replace(/\/\*[\s\S]*?\*\//g,''),art=read('party-art.css'),js=read('party.js');
function selection(selector){
  let value,prefixed;
  for(const [,selectors,body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
    if(!selectors.trim().split(',').includes(selector))continue;
    const normal=body.match(/(?:^|;)user-select:([^;}]*)/);
    const webkit=body.match(/(?:^|;)-webkit-user-select:([^;}]*)/);
    if(normal)value=normal[1];if(webkit)prefixed=webkit[1];
  }
  assert.equal(prefixed,value,selector+' must support macOS WebKit');
  return value;
}
test('names, avatar frames, timestamps and UI notices are not selectable on WebKit',()=>{
  for(const selector of ['body','.avatar','.avatar *','.message-meta','.message-meta *','button','summary','.notice','.quoted-author','img'])assert.equal(selection(selector),'none',selector);
});
test('message content, diagnostic details, file paths and editable controls remain selectable',()=>{
  for(const selector of ['input','textarea','[contenteditable="true"]','.bubble','.quoted-body','.tool pre','.notice.error pre','.project-path','#approval-prompt','#approval-desc'])assert.equal(selection(selector),'text',selector);
  assert.doesNotMatch(js,/addEventListener\(['"](?:copy|paste|selectstart)['"]/);
  assert.match(js,/navigator.clipboard.writeText\(text\)/);
});
test('quoted author is separate chrome while quoted content and copy action preserve message text',()=>{
  function element(tag,cls='',text=''){return {tag,cls,text,children:[],dataset:{},append(...items){this.children.push(...items);}};}
  const copied=[];
  const context={element,updateLiveNode:()=>{},avatar:()=>element('div','avatar'),names:{pinkie:'碧琪',user:'铲屎官'},engines:{pinkie:'主持'},state:{messages:new Map([[1,{sender:'user',body:'原始引用正文'}]]),room:{}},document:{createTextNode:text=>element('#text','',text)},copy:text=>copied.push(text)};
  vm.createContext(context);
  vm.runInContext(js.slice(js.indexOf('  function messageNode('),js.indexOf('  function renderMessages(')),context);
  const row=context.messageNode({id:2,sender:'pinkie',body:'回复正文',reply:1,created:0});
  const body=row.children[1],bubble=body.children[1],quote=bubble.children[0];
  assert.deepEqual(quote.children.map(x=>[x.cls,x.text]),[['quoted-author','铲屎官：'],['quoted-body','原始引用正文']]);
  assert.equal(bubble.children[1].text,'回复正文');
  body.children.find(x=>x.cls==='message-actions').children[1].onclick();
  assert.deepEqual(copied,['回复正文']);
});
test('brand blends at full opacity without a card background or frame',()=>{
  const brand=art.match(/\.brand\{([^}]*)\}/)[1];
  assert.match(brand,/background:transparent/);assert.match(brand,/border:0/);assert.match(brand,/box-shadow:none/);
  const img=art.match(/\.brand>img\{([^}]*)\}/)[1];
  assert.match(img,/mix-blend-mode:normal/);assert.doesNotMatch(img,/opacity:/);
  const png=fs.readFileSync(path.join(__dirname,'../ui/assets/laolao-party-brand-v1.png'));
  assert.equal(png.toString('ascii',12,16),'IHDR');
  assert.equal(png.readUInt32BE(16),2172);assert.equal(png.readUInt32BE(20),724);
  assert.equal(png[25],6,'brand must be RGBA, not an opaque RGB image or a fake checkerboard');
});
test('brand pixel data has transparent perimeter and ensemble gaps, preserving eyes',()=>{
  const png=fs.readFileSync(path.join(__dirname,'../ui/assets/laolao-party-brand-v1.png'));
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20),parts=[];
  assert.equal(png[24],8);assert.equal(png[28],0,'fixture expects non-interlaced RGBA');
  for(let i=8;i<png.length;){const size=png.readUInt32BE(i);if(png.toString('ascii',i+4,i+8)==='IDAT')parts.push(png.subarray(i+8,i+8+size));i+=size+12;}
  const raw=require('node:zlib').inflateSync(Buffer.concat(parts)),stride=width*4;
  let previous=Buffer.alloc(stride),offset=0,transparent=0,opaqueWhite=0;
  // Inspected negative spaces: between ponies, between mane strands, ribbon
  // loop and calligraphic counter. Eye samples must not be globally keyed out.
  const gaps=new Set(['843,293','515,206','236,509','1849,497']);
  const eyes=new Set(['415,317','645,321','935,356']);
  function paeth(a,b,c){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
  for(let y=0;y<height;y++){
    const filter=raw[offset++],row=Buffer.alloc(stride);assert.ok(filter<=4);
    for(let x=0;x<stride;x++){const a=x>=4?row[x-4]:0,b=previous[x],c=x>=4?previous[x-4]:0;row[x]=(raw[offset++]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}
    for(let x=0;x<width;x++){
      const i=x*4,alpha=row[i+3];
      if(!alpha)transparent++;
      if(alpha===255&&row[i]>245&&row[i+1]>245&&row[i+2]>245)opaqueWhite++;
      if(x===0||x===width-1||y===0||y===height-1)assert.equal(alpha,0,'no rectangular matte may remain');
      const sample=x+','+y;
      if(gaps.has(sample))assert.equal(alpha,0,'checkerboard must also be removed from interior gaps');
      if(eyes.has(sample))assert.equal(alpha,255,'all three ponies retain opaque eye details');
    }
    previous=row;
  }
  assert.ok(transparent>1000000,'background must actually be transparent');assert.ok(opaqueWhite>100,'eye whites and crown highlights must remain');
});

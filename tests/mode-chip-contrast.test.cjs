const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

// B11·thinking 外壳表：输入框下面「想法取向」默认态继承 .pinkie-chip 的 color-mix(currentColor 68%)，日间只有 3.55。
const lin=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;};
const lum=([r,g,b])=>0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
const hex=s=>[1,3,5].map(i=>parseInt(s.slice(i,i+2),16));
const mix=(a,b,p)=>a.map((v,i)=>v*p+b[i]*(1-p));

function modeVars(){
  const css=read('ui/injections/laolao-theme.css');
  const out={};
  for(const [, sel, body] of css.matchAll(/^(html\[data-theme\]|html\[data-laolao-mode="[a-z]+"\]) \{([^}]*)\}/gm)){
    const v={};
    for(const [, k, c] of body.matchAll(/--(muted-strong|text|accent):\s*(#[0-9a-f]{6})/gi)) v[k]=c;
    out[sel]=v;
  }
  return out;
}

function chipRule(){
  const css=read('ui/injections/laolao-session-tools.css');
  return [...css.matchAll(/(?:^|\})\s*([^{}\n]*\.pinkie-chip--mode\[data-value="default"\][^{}\n]*)\{([^}]*)\}/gm)]
    .find(([, sel, body])=>/color:/.test(body)&&/:not\(\[data-pinkie-night\]\)/.test(sel));
}

test('default mode chip has its own day colour instead of the inherited currentColor 68%',()=>{
  const rule=chipRule();
  assert.ok(rule,'laolao-session-tools.css 应给日间默认态 .pinkie-chip--mode 单独上色');
  const [, sel, body]=rule;
  assert.match(sel,/:not\(\[data-laolao-mode="metre"\]\)/,'Metre 的 Baton 开关有自己的配色，不要盖');
  assert.match(sel,/:not\(\.pinkie-baton\)/);
  assert.match(sel,/:not\(:hover\)/,'悬停时仍跟随 .pinkie-chip:hover 的 --pt-text');
  assert.match(body,/color:var\(--pt-quiet\)/);
  assert.doesNotMatch(body,/!important/);
  assert.match(read('ui/injections/laolao-session-tools.css'),/--pt-quiet:var\(--muted-strong,/);
});

test('mode chip text reaches 4.5:1 on white and on each mode fog tint; the old recipe did not',()=>{
  const vars=modeVars();
  const base=vars['html[data-theme]'];
  assert.ok(base&&base['muted-strong']&&base.text);
  const white=[255,255,255];
  for(const mode of ['chat','project','thinking','learning','unrestricted']){
    const v={...base,...vars[`html[data-laolao-mode="${mode}"]`]};
    assert.ok(v['muted-strong']&&v.text&&v.accent,`${mode} 变量缺失`);
    const tint=mix(hex(v.accent),white,0.09);
    for(const [name,bg] of [['white',white],['fog-tint',tint]]){
      const r=ratio(hex(v['muted-strong']),bg);
      assert.ok(r>=4.5,`${mode} ${name} 对比度 ${r.toFixed(2)} < 4.5`);
    }
  }
  const t={...base,...vars['html[data-laolao-mode="thinking"]']};
  const old=ratio(mix(hex(t.text),white,0.68),white);
  assert.ok(old<4.5,`thinking 旧色 ${old.toFixed(2)} 本来就够，测试失去意义`);
});

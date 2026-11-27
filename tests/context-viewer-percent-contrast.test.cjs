const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

// B11·chat S2：输入区右下「13%」被 laolao-theme.css 共用输入区规则的 var(--fog-muted)（--muted 88% 透明）盖成 3.6 左右。
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
    for(const [, k, c] of body.matchAll(/--(muted|text-strong|accent):\s*(#[0-9a-f]{6})/gi)) v[k]=c;
    out[sel]=v;
  }
  return out;
}

function percentRule(){
  const source=read('ui/injections/laolao-context-compact.js');
  const rules=[...source.matchAll(/([^{}]*\.laolao-context-viewer__percent)\{([^}]*)\}/g)];
  return rules.find(([, sel, body])=>/color:/.test(body)&&/:not\(\[data-pinkie-night\]\)/.test(sel));
}

test('context percent has its own day colour instead of the composer fog-muted',()=>{
  const rule=percentRule();
  assert.ok(rule,'laolao-context-compact.js 应给日间 .laolao-context-viewer__percent 单独上色');
  const [, sel, body]=rule;
  assert.match(sel,/:not\(\[data-laolao-mode="metre"\]\)/,'metre 有自己的 --metre-muted，不要盖');
  assert.match(sel,/:not\(\[open\]\)/);
  assert.match(sel,/:not\(:hover\)/,'悬停 / 展开时仍跟随 summary 的 --fog-ink');
  assert.doesNotMatch(body,/!important/);
  assert.doesNotMatch(body,/fog-muted/);
});

test('context percent reaches 4.5:1 on white and on each mode fog tint',()=>{
  const [, , body]=percentRule();
  const m=body.match(/color:color-mix\(in srgb,var\(--muted\) (\d+)%,var\(--text-strong\)\)/);
  assert.ok(m,`颜色应为 --muted 与 --text-strong 的混色，实际：${body}`);
  const p=Number(m[1])/100;
  const vars=modeVars();
  const base=vars['html[data-theme]'];
  const modes=['chat','project','thinking','learning','unrestricted'];
  assert.ok(base&&base.muted&&base['text-strong']);
  for(const mode of modes){
    const v={...base,...vars[`html[data-laolao-mode="${mode}"]`]};
    assert.ok(v.muted&&v['text-strong']&&v.accent,`${mode} 变量缺失`);
    const fg=mix(hex(v.muted),hex(v['text-strong']),p);
    const white=[255,255,255];
    const tint=mix(hex(v.accent),white,0.09);
    // composer-grey：pr-shots 实拍最暗底色（sidebar-collapsed 820 project），mix60 在这上面只有 3.5。
    for(const [name,bg] of [['white',white],['fog-tint',tint],['composer-grey',[200,203,206]]]){
      const r=ratio(fg,bg);
      assert.ok(r>=4.5,`${mode} ${name} 对比度 ${r.toFixed(2)} < 4.5`);
    }
    const old=mix(hex(v.muted),tint,0.88);
    assert.ok(ratio(old,tint)<4.5,`${mode} 旧色本来就够，测试失去意义`);
  }
});

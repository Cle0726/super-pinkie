// 离线出图：node render-backdrop.cjs out.png dark|light home|chat scale [lamps,comma] [cols] [bandRows]
//   CROP=x,y,w,h 只出一块（格坐标）；RIPPLE="x,y,age[;x,y,age…]" 在那一刻点过（格坐标、点击后的毫秒）；
//   FRAMES=60,200,400 和 RIPPLE 一起用：每个时刻出一张（文件名后缀 -t60 …）；KEEP=行 对话页输入框上沿
const fs=require('fs'),zlib=require('zlib'),path=require('path');
require(path.resolve(__dirname, '../../../ui/injections/laolao-metre-backdrop.js'));
const S=globalThis.__pinkieMetreScene;
for (const [k,sp] of Object.entries(S.SPRITES)) { const w=new Set(sp.map(r=>r.length)); if (w.size!==1) console.log('WIDTH MISMATCH',k,sp.map(r=>r.length).join(',')); }
const [out,theme='dark',page='home',scale='2',lampsArg='',colsArg='580',bandArg='']=process.argv.slice(2);
const dark=theme==='dark',home=page==='home',cols=+colsArg,band=+bandArg||(home?126:72),rows=+(process.env.ROWS||0)||band+Math.round(band*(home?0.9:0.6));
const lamps=lampsArg?lampsArg.split(','):[];
const quiet=home?null:[Math.round(cols/2-196),Math.round(cols/2+196)];
const keepTop=process.env.KEEP?+process.env.KEEP:null;
const clicks=process.env.RIPPLE?process.env.RIPPLE.split(';').map(p=>p.split(',').map(Number)):[];
// 和运行时一样：最后一次点击附近的谱台灯亮着（NOFLASH=1 关掉）
let sc=S.buildScene({cols,rows,band,dark,home,lamps,quiet,keepTop,dim:home?0:0.5});
if (clicks.length && !process.env.NOFLASH) { const [fx,fy]=clicks[clicks.length-1], flash=S.nearestSlot(sc,fx,fy); if (flash>=0) sc=S.buildScene({cols,rows,band,dark,home,lamps,quiet,keepTop,dim:home?0:0.5,flash}); }
const bg=sc.C.bg;
const frames=process.env.FRAMES?process.env.FRAMES.split(',').map(Number):[null];
const [cx,cy,cw,ch]=(process.env.CROP||`0,0,${cols},${rows}`).split(',').map(Number);
const crc=(b)=>{let c,t=crc.t||(crc.t=Array.from({length:256},(_,n)=>{c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0}));c=~0;for(const x of b)c=t[(c^x)&255]^(c>>>8);return(~c)>>>0};
const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])};
for (const extra of frames) {
  const buf=new Uint32Array(cols*rows);
  // 每个点击 [x,y,age]：age = 点击后多少毫秒；FRAMES 给了就整体再往后推 extra 毫秒
  const rs=[]; for (const [x,y,age] of clicks) rs.push(...S.makeRipples(sc,x,y,-(extra==null?age:age+extra)));
  const top=S.compose(sc,0,false,rs,0,buf);
  const k=+scale,W=cw*k,H=ch*k,raw=Buffer.alloc((W*4+1)*H);
  for(let y=0;y<H;y++){raw[y*(W*4+1)]=0;for(let x=0;x<W;x++){const v=buf[(cy+Math.floor(y/k))*cols+cx+Math.floor(x/k)];const c=v?[v&255,(v>>8)&255,(v>>16)&255]:bg;const o=y*(W*4+1)+1+x*4;raw[o]=c[0];raw[o+1]=c[1];raw[o+2]=c[2];raw[o+3]=255;}}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=6;
  const file=extra==null?out:out.replace(/\.png$/,`-t${extra}.png`);
  fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
  console.log(file,W+'x'+H,'slots',sc.anchors.slots.length,'top',top,'floorY',sc.anchors.floorY,'rows',rows);
}

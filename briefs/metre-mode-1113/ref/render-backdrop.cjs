// 离线出图：node render.cjs out.png dark|light home|chat scale [lamps,comma] [cols] [bandRows]
const fs=require('fs'),zlib=require('zlib'),path=require('path');
require(path.resolve(__dirname, '../../../ui/injections/laolao-metre-backdrop.js'));
const S=globalThis.__pinkieMetreScene;
for (const [k,sp] of Object.entries(S.SPRITES)) { const w=new Set(sp.map(r=>r.length)); if (w.size!==1) console.log('WIDTH MISMATCH',k,sp.map(r=>r.length).join(',')); }
const [out,theme='dark',page='home',scale='2',lampsArg='',colsArg='580',bandArg='']=process.argv.slice(2);
const dark=theme==='dark',home=page==='home',cols=+colsArg,band=+bandArg||(home?126:72),rows=band+Math.round(band*(home?0.9:0.6));
const lamps=lampsArg?lampsArg.split(','):[];
const quiet=home?null:[Math.round(cols/2-196),Math.round(cols/2+196)];
const sc=S.buildScene({cols,rows,band,dark,home,lamps,quiet,dim:home?0:0.5}); sc.dark=dark;
const buf=new Uint32Array(sc.buf); const bg=sc.C.bg;
const mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const pk=(c)=>((255<<24)|(Math.round(c[2])<<16)|(Math.round(c[1])<<8)|Math.round(c[0]))>>>0;
const put=(x,y,c)=>{if(x>=0&&y>=0&&x<cols&&y<rows)buf[y*cols+x]=pk(sc.dim?mix(c,bg,sc.dim):c)};
const under=(x,y)=>{const v=x>=0&&y>=0&&x<cols&&y<rows?sc.buf[y*cols+x]:0;return v?[v&255,(v>>8)&255,(v>>16)&255]:bg};
S.paintMoving(sc,0,false,put,under);
const [cx,cy,cw,ch]=(process.env.CROP||`0,0,${cols},${rows}`).split(',').map(Number);
const k=+scale,W=cw*k,H=ch*k,raw=Buffer.alloc((W*4+1)*H);
for(let y=0;y<H;y++){raw[y*(W*4+1)]=0;for(let x=0;x<W;x++){const v=buf[(cy+Math.floor(y/k))*cols+cx+Math.floor(x/k)];const c=v?[v&255,(v>>8)&255,(v>>16)&255]:bg;const o=y*(W*4+1)+1+x*4;raw[o]=c[0];raw[o+1]=c[1];raw[o+2]=c[2];raw[o+3]=255;}}
const crc=(b)=>{let c,t=crc.t||(crc.t=Array.from({length:256},(_,n)=>{c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0}));c=~0;for(const x of b)c=t[(c^x)&255]^(c>>>8);return(~c)>>>0};
const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])};
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=6;
fs.writeFileSync(out,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
console.log(out,W+'x'+H,'slots',sc.anchors.slots.length);

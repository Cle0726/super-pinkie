// Native-only probe: does hover reach the page in this host right now?
import fs from 'node:fs';
import {requestAppBrowser} from '../../../services/mode-architecture/app-browser.mjs';
const base=process.env.PINKIE_BROWSER_QA_BASE,environment={...process.env},log=[];
const call=async(a,p={})=>{const t=Date.now();const r=await requestAppBrowser(a,p,{environment,timeoutMs:15000});log.push({a,p,ok:r.ok,ms:Date.now()-t,reason:r.reason});return r;};
await call('open',{url:base+'/lab.html'});
for(let i=0;i<3;i++){await call('hover',{name:'高级实验'});await new Promise(r=>setTimeout(r,400));}
await call('hover',{name:'高级实验',input:'native'});
const q=await requestAppBrowser('qa-oracle',{},{environment,timeoutMs:15000});
const pageState=await call('snapshot',{compact:true});
fs.writeFileSync(new URL('probe.json',import.meta.url),JSON.stringify({log,qa:q.result,menuVisible:JSON.stringify(pageState.result?.elements||[]).includes('打开画布')},null,1));

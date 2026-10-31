// Native-only probe: hover/drag with the host window active vs. in the background.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {requestAppBrowser} from '../../../services/mode-architecture/app-browser.mjs';
const base=process.env.PINKIE_BROWSER_QA_BASE,environment={...process.env},out={};
const call=(a,p={})=>requestAppBrowser(a,p,{environment,timeoutMs:15000});
const oracle=async()=>(await call('qa-oracle')).result;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function trial(label){
 await call('open',{url:base+'/lab.html'});await sleep(300);
 const hover=await call('hover',{name:'高级实验',observe:false});
 const click=await call('click',{name:'打开画布',observe:false});
 const drag=await call('drag',{selector:'#board',toSelector:'#target',observe:false});
 out[label]={frontmost:execFileSync('osascript',['-e','tell application "System Events" to get name of first application process whose frontmost is true']).toString().trim(),hover:hover.ok||hover.reason,click:click.ok||click.reason,drag:drag.ok||drag.reason,qa:await oracle()};
}
await trial('active');
execFileSync('osascript',['-e','tell application "Finder" to activate']);await sleep(800);
await trial('background');
fs.writeFileSync(new URL('probe.json',import.meta.url),JSON.stringify(out,null,1));

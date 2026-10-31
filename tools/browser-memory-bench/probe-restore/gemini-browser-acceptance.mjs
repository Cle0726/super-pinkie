// Does the forced-active state end after the gesture, and never steal focus?
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {requestAppBrowser} from '../../../services/mode-architecture/app-browser.mjs';
const base=process.env.PINKIE_BROWSER_QA_BASE,environment={...process.env};
const call=(a,p={})=>requestAppBrowser(a,p,{environment,timeoutMs:15000});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const front=()=>execFileSync('osascript',['-e','tell application "System Events" to get name of first application process whose frontmost is true']).toString().trim();
const focus=async()=>(await call('eval',{js:'document.hasFocus()'})).result;
await call('open',{url:base+'/lab.html'});
execFileSync('osascript',['-e','tell application "Finder" to activate']);await sleep(800);
const out={before:{front:front(),hasFocus:await focus()}};
const hover=await call('hover',{name:'高级实验',observe:false});
out.during={hover:hover.ok||hover.reason,front:front(),hasFocus:await focus()};
await sleep(2200);
out.after={front:front(),hasFocus:await focus()};
fs.writeFileSync(new URL('probe.json',import.meta.url),JSON.stringify(out,null,1));

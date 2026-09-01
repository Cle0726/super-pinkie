// Opt-in tap for this dedicated, tool-restricted CLI process only.
// The named OpenClaw event export is discovered, never a private global patched.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function publicEvent(event) {
  const d=event.data||{};
  if(event.stream==='assistant')return {stream:'assistant',data:{text:d.text,delta:d.delta}};
  if(event.stream==='tool')return {stream:'tool',data:{name:d.name,toolCallId:d.toolCallId,phase:d.phase,args:d.args,result:d.result,partialResult:d.partialResult,isError:d.isError}};
  return null;
}

if(process.env.PINKIE_LIVE_ENTRY) {
  try {
    const dist=path.join(path.dirname(fs.realpathSync(process.env.PINKIE_LIVE_ENTRY)),'dist');
    const files=fs.readdirSync(dist).filter(n=>/^agent-events-.*\.js$/.test(n));
    let subscribe;
    for(const name of files){
      const file=path.join(dist,name);
      if(!/export\s*\{[^}]*\bonAgentEvent\s*[,}]/s.test(fs.readFileSync(file,'utf8')))continue;
      const mod=await import(pathToFileURL(file));
      if(typeof mod.onAgentEvent==='function'){subscribe=mod.onAgentEvent;break;}
    }
    if(!subscribe)throw new Error('no public event export');
    subscribe(event=>{
      const safe=publicEvent(event);
      if(safe)process.stdout.write('\n'+JSON.stringify({pinkieLive:safe})+'\n');
    });
  } catch {
    // Preserve compatibility: final CLI JSON still works on older versions.
    process.stdout.write('\n'+JSON.stringify({pinkieLive:{stream:'capability',data:{streaming:false}}})+'\n');
  }
}

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TailscaleFunnel,normalizeTailscaleHostname,readTailscaleIdentity} from '../services/chatgpt-collab/runtime/dist/tunnel/tailscale-funnel.js';

const runningStatus=JSON.stringify({
  BackendState:'Running',
  Self:{DNSName:'pinkie-demo.tail1234.ts.net.'},
});

function fakeRun(calls){
  return (binary,args)=>{
    calls.push({binary,args});
    if(args[0]==='status')return {status:0,stdout:runningStatus,stderr:''};
    return {status:0,stdout:'',stderr:''};
  };
}

test('Tailscale Funnel uses a stable device hostname and reconfigures only its local proxy',async()=>{
  const calls=[];
  const funnel=new TailscaleFunnel({
    hostname:'pinkie-demo.tail1234.ts.net',
    binaryOverride:'tailscale',
    runImpl:fakeRun(calls),
    fetchImpl:async()=>({ok:true,json:async()=>({status:'ok'})}),
    healthWaitMs:20,
  });
  const url=await funnel.start(18789);
  assert.equal(url,'https://pinkie-demo.tail1234.ts.net');
  assert.equal(funnel.status().provider,'tailscale-funnel');
  assert.equal(funnel.status().running,true);
  assert.deepEqual(calls.at(-1).args,['funnel','--bg','--https=443','http://127.0.0.1:18789']);
  await funnel.stop();
  assert.deepEqual(calls.at(-1).args,['funnel','--https=443','off']);
});

test('Tailscale adapter refuses a logged-out or changed device instead of silently publishing another host',async()=>{
  assert.equal(normalizeTailscaleHostname('pinkie.tail123.ts.net.'),'pinkie.tail123.ts.net');
  assert.throws(()=>normalizeTailscaleHostname('example.com'),/\.ts\.net/);
  assert.throws(()=>readTailscaleIdentity({binaryOverride:'tailscale',runImpl:()=>({status:0,stdout:JSON.stringify({BackendState:'NeedsLogin',Self:{}})})}),/尚未登录/);
  const calls=[];
  const funnel=new TailscaleFunnel({hostname:'old.tail1234.ts.net',binaryOverride:'tailscale',runImpl:fakeRun(calls)});
  await assert.rejects(()=>funnel.start(18789),/设备地址已变/);
});

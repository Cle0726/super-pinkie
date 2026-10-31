import {test} from 'node:test';import assert from 'node:assert/strict';
import {transformWithStatus} from '../patch/apply-steer-identity.mjs';
test('steer id patch is idempotent and fails closed on unfamiliar bundles',()=>{
 const head='async function Hh(e,t,n){if(!e.client||!e.connected)return null;let r=t.trim(),i=n&&n.length>0;if(!r&&!i)return null;Oh(e,null);let a=v();';
 const src=head+' async function Wh(e,t,n){return Hh(e,t,n)} let s=await Wh(e,i,o?a:void 0);';
 const r=transformWithStatus(src);assert.equal(r.changed,true);assert.match(r.text,/requestedRunId/);assert.match(r.text,/r\.sendRunId/);
 assert.equal(transformWithStatus(r.text).reason,'already-patched');assert.deepEqual(transformWithStatus('unknown'),{changed:false,reason:'unsupported-ui',text:'unknown'});
});

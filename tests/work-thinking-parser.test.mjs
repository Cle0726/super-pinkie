import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apply, isUpstreamFixed, transform} from '../patch/apply-work-thinking.mjs';
const input='if (choiceDelta.tool_calls) { seal(); }';
test('empty or null tool metadata leaves thinking open; real tools still seal it',()=>{
 const output=transform(input);
 const run=new Function('choiceDelta','seal',output);
 for(const tool_calls of [undefined,null,[]]){let sealed=0;run({tool_calls},()=>sealed++);assert.equal(sealed,0);}
 let sealed=0;run({tool_calls:[{index:0}]},()=>sealed++);assert.equal(sealed,1);
 assert.equal(transform(output),output);
});
test('unexpected native parser structure fails without overwriting it',()=>{
 assert.throws(()=>transform('if (other) {}'));
 assert.throws(()=>transform(input+input));
});

// OpenClaw 2026.10 already ignores empty tool metadata in its stream reader.
const current = 'if (delta.tool_calls && delta.tool_calls.length > 0) { seal(); }';

test('2026.10 stream reader is recognised as already fixed and left untouched',()=>{
 assert.equal(isUpstreamFixed(current), true);
 assert.equal(transform(current), current);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-work-thinking-'));
 try{
  const dir=path.join(root,'node_modules/@openclaw/ai/dist');
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'openai-completions-transport-test.mjs'),current);
  assert.deepEqual(apply(root),{file:path.join(dir,'openai-completions-transport-test.mjs'),changed:false,upstream:true});
  assert.equal(fs.readFileSync(path.join(dir,'openai-completions-transport-test.mjs'),'utf8'),current);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('legacy bundles are still patched through apply()',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-work-thinking-legacy-'));
 try{
  const dir=path.join(root,'node_modules/@openclaw/ai/dist');
  fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'openai-completions-legacy.mjs');
  fs.writeFileSync(file,input);
  assert.equal(apply(root,{backupRoot:path.join(root,'backup')}).changed,true);
  assert.match(fs.readFileSync(file,'utf8'),/choiceDelta\.tool_calls\.length > 0/);
  assert.equal(apply(root,{backupRoot:path.join(root,'backup')}).changed,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transform} from '../patch/apply-work-thinking.mjs';
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

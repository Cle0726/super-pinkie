import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LearningInteractionStore, LEARNING_NOTEBOOK_SESSION as ALL} from '../services/mode-architecture/learning.mjs';
import {LearningRecall, validateRecallCards, recallHash, splitRecallSource} from '../services/mode-architecture/learning-recall.mjs';
const KEY = 'agent:learning:recall-qa';
function fixture(t, requestModel) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-recall-')); t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const store = new LearningInteractionStore({root,workspace:path.join(root,'workspace')});
  const organizer = {status:()=>({available:true,model:'qa/model',modelName:'QA'}),requestModel};
  const schedule = (card,rating,now)=>({lastReviewedAt:now,nextReviewAt:now+(rating==='forgot'?1:3)*86400000,reviewCount:(card.reviewCount||0)+1,reviewLevel:rating==='remembered'?1:0});
  const recall = new LearningRecall(store,{organizer,schedule});
  return {store,recall};
}
const model = async (_m,_r,input) => ({notes:input.map(n=>({id:n.id,cards:[{question:'“避免犯错”用英语怎么说？',answer:'avoid making mistakes',quote:'avoid making mistakes（避免犯错）'}]}))});
test('bulk-pasted answer text becomes a separate grounded question, source bytes stay unchanged',async t=>{
 const {store,recall}=fixture(t,model); const saved=store.saveNote(KEY,{content:'avoid making mistakes（避免犯错）'}).note;
 const before=fs.readFileSync(store.notesFile); recall.enqueue(ALL); await recall.running;
 const q=await recall.queue(ALL,{generate:false}); assert.equal(q.notes.length,1);
 assert.equal(q.notes[0].cue,'“避免犯错”用英语怎么说？'); assert.doesNotMatch(q.notes[0].cue,/avoid making mistakes/);
 assert.equal(q.notes[0].recallAnswer,'avoid making mistakes'); assert.deepEqual(fs.readFileSync(store.notesFile),before);
 assert.equal(q.notes[0].id,saved.id);
});
test('one copied passage yields independent recall cards with independent schedules and a daily cap',async t=>{
 const {store,recall}=fixture(t,async(_m,_r,input)=>({notes:input.map(n=>({id:n.id,cards:[
  {question:'avoid 后面应接哪种动词形式？',answer:'动名词 -ing',quote:'avoid 后接动名词 -ing'},
  {question:'C 语言中指针变量保存什么？',answer:'另一个变量的地址',quote:'指针变量保存另一个变量的地址'}]}))}));
 store.saveNote(KEY,{content:'avoid 后接动名词 -ing。指针变量保存另一个变量的地址。'});
 let q=await recall.queue(ALL,{wait:true});assert.equal(q.notes.length,2);assert.notEqual(q.notes[0].recallId,q.notes[1].recallId);
 const original=fs.readFileSync(store.notesFile);const first=q.notes[0];recall.review(ALL,{id:first.id,recallId:first.recallId,rating:'remembered'});
 q=await recall.queue(ALL,{generate:false,dailyLimit:1});assert.equal(q.completedToday,1);assert.equal(q.notes.length,0);assert.equal(q.backlog,1);
 assert.deepEqual(fs.readFileSync(store.notesFile),original);
});
test('answer-in-question, duplicated source front and invented quote are rejected',()=>{
 const note={id:'n',content:'avoid making mistakes（避免犯错）'};
 const result={notes:[{id:'n',cards:[
  {question:'avoid making mistakes（避免犯错）是什么意思？',answer:'avoid making mistakes',quote:note.content},
  {question:note.content,answer:note.content,quote:note.content},
  {question:'“避免犯错”用英语怎么说？',answer:'avoid making mistakes',quote:'原文根本没有的依据'}]}]};
 assert.equal(validateRecallCards(result,[note]).size,0);
});
test('concurrent requests share one model job and failures do not silently retry or reveal originals',async t=>{
 let calls=0;const {store,recall}=fixture(t,async()=>{calls++;await new Promise(r=>setTimeout(r,15));throw Error('offline');});
 store.saveNote(KEY,{content:'ANSWER_SENTINEL'});await Promise.all([recall.queue(ALL),recall.queue(ALL),recall.queue(ALL)]);await recall.running;
 const q=await recall.queue(ALL);assert.equal(calls,1);assert.equal(q.notes.length,0);assert.equal(q.problems.length,1);
 assert.doesNotMatch(JSON.stringify(q),/ANSWER_SENTINEL/);assert.equal(store.notesForSession(ALL)[0].content,'ANSWER_SENTINEL');
});
test('an edit or deletion while the model is running cannot apply stale questions',async t=>{
 let resolve;const {store,recall}=fixture(t,()=>new Promise(r=>resolve=r));const n=store.saveNote(KEY,{content:'avoid making mistakes（避免犯错）'}).note;
 recall.enqueue(ALL);await new Promise(r=>setTimeout(r,0));store.updateNote(KEY,n.id,{content:'新的一段原文'});
 resolve(await model(null,null,[n]));await recall.running;
 assert.equal((await recall.queue(ALL,{generate:false})).notes.length,0);assert.notEqual(recall.read().records[n.id].hash,recallHash(store.notesForSession(ALL)[0]));
});
test('moved and merged notes stay out of generated cards and grading',async t=>{
 const {store,recall}=fixture(t,model);const n=store.saveNote(KEY,{content:'avoid making mistakes（避免犯错）'}).note;await recall.queue(ALL,{wait:true});
 const card=recall.snapshot(ALL).notes[0];store.writeNotes([{...n,status:'moved'}]);assert.equal(recall.snapshot(ALL).notes.length,0);
 assert.throws(()=>recall.review(ALL,{id:n.id,recallId:card.recallId,rating:'remembered'}),/没有找到/);
});
test('a long complete paste is stored intact and every source character reaches the chunked model',async t=>{
 const seen=[];const {store,recall}=fixture(t,async(_m,_r,input)=>{seen.push(...input.map(n=>n.text));return{notes:input.map((n,i)=>({id:n.id,cards:[{question:'这段资料要求回忆哪一个知识点？',answer:'本段依据：'+n.text.slice(0,40),quote:n.text.slice(0,80)}]}))};});
 const content=('这是一段完整知识说明，必须全部保留。\n').repeat(2500)+'FINAL_SOURCE_SENTINEL';
 const saved=store.saveNote(KEY,{content}).note;assert.equal(saved.content,content);assert.equal(saved.original,content);
 assert.equal(splitRecallSource(content).join(''),content);
 await recall.queue(ALL,{wait:true});assert.equal(seen.join(''),content);assert.ok(seen.length>2);
 assert.equal(store.findOwnedNote(ALL,saved.id).content,content);
});

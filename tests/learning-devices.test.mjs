import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DEVICES, normalizeDevice, zenerResult, deviceResult, createDeviceState, saveDeviceState} from '../services/mode-architecture/learning-devices.mjs';
import {LearningInteractionStore, createLearningActivityTool, learningPrompt} from '../services/mode-architecture/learning.mjs';
import {runLearningCompute} from '../services/mode-architecture/learning-compute.mjs';
import {pinkieLearningInlineReferences, transformLearningInlineKinds} from '../patch/apply-chat-timeline.mjs';
import vm from 'node:vm';

const key = 'agent:learning:device-tests';
const fixture = t => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-device-')); t.after(() => fs.rmSync(root, {recursive: true, force: true})); return new LearningInteractionStore({root, workspace: path.join(root, 'workspace')}); };
const record = (device, visual = {}) => { const n = normalizeDevice({kind: 'device_lab', visual: {device, ...visual}}); return {...n, state: createDeviceState(n)}; };
const apply = (r, patch) => ({...r, state: saveDeviceState(r, patch)});
let seq = 0;
const event = (r, type, values) => apply(r, {events: [{id: 'event-' + ++seq, type, ...(values ? {values} : {})}]});

test('browser and server use exactly the same teaching engine', () => {
  assert.equal(fs.readFileSync(new URL('../ui/injections/laolao-learning-devices-engine.js', import.meta.url), 'utf8'), fs.readFileSync(new URL('../services/mode-architecture/learning-devices.mjs', import.meta.url), 'utf8'));
});
test('native timeline accepts all new component references and upgrades only its whitelist', () => {
  const helper=pinkieLearningInlineReferences.toString(),legacy=helper.replace("'memory_lab', 'device_lab', 'illustrated_guide', ",'');
  const prefix='/* untouched streaming */\n',suffix='\n/* untouched history and composer */';
  const updated=transformLearningInlineKinds(prefix+legacy+suffix);
  assert.ok(updated.startsWith(prefix)&&updated.endsWith(suffix));assert.equal(transformLearningInlineKinds(updated),updated);
  const run=vm.runInNewContext(updated+'\npinkieLearningInlineReferences');
  for(const kind of ['device_lab','memory_lab','illustrated_guide']){
    const result=run([{messages:[{message:{}}]}],()=>[{name:'learning_activity',outputText:JSON.stringify({inline:{v:1,kind,id:'test',sessionKey:key}})}]);
    assert.equal(result[0].kind,kind);
  }
});
test('zener model conserves current and distinguishes dropout, knee and over-power', () => {
  const p = {Vin: 12, R: 330, RL: 1000, Vz: 5.1}, r = zenerResult(p);
  assert.equal(r.Vo, 5.1); assert.ok(Math.abs(r.Iz - .01580909090909) < 1e-12); assert.equal(r.regulated, true);
  const off = zenerResult({...p, Vin: 3}); assert.equal(off.region, '未击穿'); assert.ok(Math.abs(off.Vo - 3000 / 1330) < 1e-12); assert.ok(off.Iz < 1e-15);
  assert.equal(zenerResult({...p, Izmin: 20}).region, '临界区');
  assert.equal(zenerResult({...p, Vin: 30, R: 100}).region, '功率超限');
  assert.equal(zenerResult({...p, RL: 50}).region, '未击穿');
  for (const Vin of [0, 5.1, 12, 30]) for (const R of [10, 330, 10000]) for (const RL of [50, 1000, 100000]) {
    const out = zenerResult({...p, Vin, R, RL}); assert.ok(out.Vo >= 0 && out.Vo <= Vin); assert.ok(out.Iz >= 0); assert.ok(Math.abs(out.IR - out.IL - out.Iz) < 1e-12);
  }
});
test('74LS138 exhausts every input and enable combination with active-low outputs', () => {
  for (let input = 0; input < 8; input++) for (let enable = 0; enable < 8; enable++) {
    const r = deviceResult('decoder138', {A: input & 1, B: input >> 1 & 1, C: input >> 2, G1: enable & 1, G2A: enable >> 1 & 1, G2B: enable >> 2}, 0, [1, 5]);
    const on = enable === 1; assert.equal(r.enabled, on); assert.equal(r.outputs.filter(v => v === 0).length, on ? 1 : 0);
    if (on) assert.equal(r.outputs[input], 0); assert.equal(r.F, +(on && [1, 5].includes(input)));
  }
});
test('74LS151 checks all 256 data words, 8 selectors and both strobe levels', () => {
  for (let bits = 0; bits < 256; bits++) for (let selected = 0; selected < 8; selected++) for (const G of [0, 1]) {
    const values = {A: selected & 1, B: selected >> 1 & 1, C: selected >> 2, G, ...Object.fromEntries(Array.from({length: 8}, (_, i) => ['D' + i, bits >> i & 1]))};
    const r = deviceResult('mux151', values); assert.equal(r.Y, G ? 0 : bits >> selected & 1); assert.equal(r.W, 1 - r.Y);
  }
});
test('74LS161 clear is asynchronous, load synchronous and has priority over enables', () => {
  let r = record('counter161', {initial: 15});
  r = event(r, 'inputs', {ENP: 0, LOAD_n: 0, DATA: 6}); assert.equal(r.state.q, 15);
  r = event(r, 'tick'); assert.equal(r.state.q, 6);
  r = event(r, 'inputs', {CLR_n: 0}); assert.equal(r.state.q, 0);
  r = event(r, 'tick'); assert.equal(r.state.q, 0);
  r = event(r, 'inputs', {CLR_n: 1, LOAD_n: 1, ENP: 0}); r = event(r, 'tick'); assert.equal(r.state.q, 0);
  r = event(r, 'inputs', {ENP: 1}); r = event(r, 'tick'); assert.equal(r.state.q, 1);
});
test('74LS161 counts only rising edges, wraps, and RCO does not depend on ENP', () => {
  let r = record('counter161', {initial: 15});
  assert.equal(deviceResult('counter161', {...r.state.values, ENP: 0}, 15).RCO, 1);
  assert.equal(deviceResult('counter161', {...r.state.values, ENT: 0}, 15).RCO, 0);
  r = event(r, 'inputs', {CLK: 1}); assert.equal(r.state.q, 0);
  r = event(r, 'inputs', {CLK: 1}); assert.equal(r.state.q, 0);
  r = event(r, 'inputs', {CLK: 0}); assert.equal(r.state.q, 0);
  r = event(r, 'tick'); assert.equal(r.state.q, 1);
});
test('all 74LS161 control combinations and starting counts follow the priority table', () => {
  for (let q = 0; q < 16; q++) for (let mask = 0; mask < 16; mask++) {
    let r = record('counter161', {initial: q});
    const values = {CLR_n: mask & 1, LOAD_n: mask >> 1 & 1, ENP: mask >> 2 & 1, ENT: mask >> 3 & 1, DATA: 10};
    r = event(r, 'inputs', values); r = event(r, 'tick');
    assert.equal(r.state.q, !values.CLR_n ? 0 : !values.LOAD_n ? 10 : values.ENP && values.ENT ? (q + 1) % 16 : q);
  }
});
test('500 pulses stay bounded, duplicate events never count twice, history is observation only', () => {
  let r = record('counter161');
  for (let i = 0; i < 500; i++) r = event(r, 'tick');
  assert.equal(r.state.q, 500 % 16); assert.equal(r.state.history.length, 64); assert.equal(r.state.seen.length, 256);
  const id = 'unique-pulse'; r = apply(r, {events: [{id, type: 'tick'}]}); const before = structuredClone(r.state); r = apply(r, {events: [{id, type: 'tick'}]}); assert.deepEqual(r.state, before);
  r = apply(r, {cursor: 0}); assert.equal(r.state.q, before.q);
  assert.throws(() => apply(r, {q: 9}), /未知字段/); assert.throws(() => apply(r, {values: {CLK: 1}}), /事件顺序/);
});
test('definitions, guide media, sizes, state and session boundaries reject invalid data', t => {
  for (const device of Object.keys(DEVICES)) assert.ok(record(device).definition);
  assert.throws(() => record('__proto__'), /支持/); assert.throws(() => record('zener', {values: {R: 0}}), /范围/);
  assert.throws(() => record('decoder138', {values: {A: .5}}), /整数/); assert.throws(() => record('decoder138', {minterms: [8]}), /最小项/);
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', '//example.com/a', 'https://name:secret@example.com/a']) assert.throws(() => normalizeDevice({kind: 'illustrated_guide', visual: {cards: [{title: 'x', image: {url}}]}}), /图片/);
  const guide = normalizeDevice({kind: 'illustrated_guide', visual: {cards: [{title: '电路', diagram: 'zener'}], sizes: [{label: '横版', width: 1920, height: 1130}], table: {columns: ['器件', '功能'], rows: [['161', '计数']]}}}); assert.equal(guide.definition.sizes[0].width, 1920);
  const store = fixture(t), a = store.visuals.present(key, {kind: 'device_lab', visual: {device: 'zener'}});
  assert.throws(() => store.visuals.get('agent:learning:other', a.id), /不存在/);
  assert.throws(() => store.visuals.save(key, {id: a.id, revision: 99, state: {values: {Vin: 9}}}), /已更新/);
});
test('visual teaching stays automatic when quizzes are paused and does not award mastery', async t => {
  const store = fixture(t); store.setEnabled(key, false);
  const tool = createLearningActivityTool(store, {sessionKey: key}), result = await tool.execute('device-present', {action: 'present', kind: 'device_lab', visual: {device: 'counter161'}});
  assert.equal(result.isError, false); assert.equal(result.details.inline.kind, 'device_lab');
  const prompt = learningPrompt(store, key); assert.match(prompt, /不用等先生点按钮/); assert.match(prompt, /暂停的是主动出题/); assert.match(prompt, /memory_lab/); assert.doesNotMatch(prompt, /点输入框下方/);
  assert.equal(store.listAttempts(key).total, 0); assert.equal(store.status(key).enabled, false);
  const resumed = await tool.execute('resume-quiz', {action:'present', resume:true, kind:'single_choice', question:'练习', options:['甲','乙'], correct_answer:'1'});
  assert.equal(resumed.isError, false); assert.equal(store.status(key).enabled, true);
});
test('real C pointer run exposes memory cells and pointer targets, never fake addresses', async () => {
  const code = '#include <stdio.h>\nint main(void){int a[3]={10,20,30}; int *p=a; int **pp=&p; p++; **pp=42; printf("%d\\n",a[1]); return 0;}';
  const result = await runLearningCompute('memory_lab', {code, stdin: ''}); assert.equal(result.stdout, '42\n'); assert.equal(result.trace.verifiedOutput, true, result.trace.message);
  const last = result.trace.frames.at(-1).memory, a = last.find(c => c.name === 'a'), p = last.find(c => c.name === 'p'), pp = last.find(c => c.name === 'pp');
  assert.equal(a.values[1], 42); assert.equal(p.pointer.target, a.id); assert.equal(p.pointer.index, 1); assert.equal(pp.pointer.target, p.id);
  const end = await runLearningCompute('memory_lab', {code: '#include <stdio.h>\nint main(void){int a[2]={1,2};int *p=a+2;printf("%d\\n",1);return 0;}', stdin: ''}); assert.equal(end.trace.frames.at(-1).memory.find(c => c.name === 'p').pointer.onePast, true);
});
test('memory lab auto-runs a real program on present; unsupported traces stay explicit', async t => {
  const store = fixture(t), tool = createLearningActivityTool(store, {sessionKey: key});
  const r = await tool.execute('memory-present', {action: 'present', kind: 'memory_lab', visual: {code: '#include <stdio.h>\nint main(void){int x=7;int *p=&x;*p=9;printf("%d\\n",x);return 0;}'}});
  assert.equal(r.isError, false); assert.equal(r.details.visual.state.result.stdout, '9\n'); assert.equal(r.details.visual.state.result.trace.verifiedOutput, true);
  const id = r.details.visual.id; const saved = store.visuals.save(key, {id, revision: r.details.visual.revision, state: {traceStep: 1}}); assert.equal(saved.state.traceStep, 1); assert.ok(saved.state.result);
  assert.throws(() => store.visuals.save(key, {id, revision: saved.revision, state: {result: {stdout: 'fake'}}}), /未知字段/);
  const unsupported=await runLearningCompute('memory_lab',{code:'#include <stdio.h>\nint helper(void){return 1;}int main(void){printf("%d\\n",helper());return 0;}',stdin:''});
  assert.equal(unsupported.stdout,'1\n');assert.equal(unsupported.trace.verifiedOutput,false);assert.deepEqual(unsupported.trace.frames,[]);assert.ok(unsupported.trace.message);
  const dangling=await runLearningCompute('memory_lab',{code:'#include <stdio.h>\nint main(void){int *p;{int x=1;p=&x;}printf("%d\\n",1);return 0;}',stdin:''});
  assert.equal(dangling.trace.verifiedOutput,true);assert.equal(dangling.trace.frames.at(-1).memory.find(c=>c.name==='p').pointer.dangling,true);
});

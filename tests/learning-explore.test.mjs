import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {LearningInteractionStore, createLearningActivityTool, learningPrompt} from '../services/mode-architecture/learning.mjs';
import {CONCEPTS, SEQUENCES, normalizeExplore, parseLogic, minimizeSop, timingWave, createExploreState} from '../services/mode-architecture/learning-explore.mjs';

const key = 'agent:learning:explore';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-explore-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return new LearningInteractionStore({root: path.join(root, 'state'), workspace: path.join(root, 'workspace')});
}
const sop = expression => { const d = normalizeExplore({kind: 'logic_lab', visual: {expression}}).definition; return d.sop.map(term => term.map(({v, neg}) => v + (neg ? "'" : '')).join('')).sort().join(' + '); };

test('every concept normalizes with its defaults and rejects out-of-range or unknown values', () => {
  for (const [name, concept] of Object.entries(CONCEPTS)) {
    const d = normalizeExplore({kind: 'concept_lab', visual: {concept: name}}).definition;
    assert.equal(d.vars.length, concept.vars.length, name);
  }
  assert.equal(normalizeExplore({kind: 'concept_lab', visual: {concept: 'series_divider', values: {R1: 2000, R2: 3000, U: 10}}}).definition.vars.find(v => v.key === 'R2').value, 3000);
  assert.throws(() => normalizeExplore({kind: 'concept_lab', visual: {concept: 'ohm', values: {U: 99}}}), /0–36 V 之间；可以直接写带单位/);
  const value = (concept, values, key) => normalizeExplore({kind: 'concept_lab', visual: {concept, values}}).definition.vars.find(v => v.key === key).value;
  assert.equal(value('series_divider', {R1: '2kΩ'}, 'R1'), 2000);
  assert.equal(value('series_divider', {R1: '2.2 k'}, 'R1'), 2200);
  assert.equal(value('rc_transient', {R: '4.7kΩ'}, 'R'), 4.7);
  assert.equal(value('rc_transient', {C: '220μF'}, 'C'), 220);
  assert.equal(value('rc_transient', {C: '0.47mF'}, 'C'), 470);
  assert.equal(value('rl_transient', {L: '0.2H'}, 'L'), 200);
  assert.equal(value('ohm', {U: '12V'}, 'U'), 12);
  assert.throws(() => value('ohm', {U: 'twelve'}, 'U'), /带单位/);
  assert.throws(() => normalizeExplore({kind: 'concept_lab', visual: {concept: 'ohm', values: {X: 1}}}), /变量名称/);
  assert.throws(() => normalizeExplore({kind: 'concept_lab', visual: {concept: 'nope'}}), /concept_lab 的 concept 支持/);
  assert.throws(() => normalizeExplore({kind: 'concept_lab', visual: {concept: 'subnet', values: {ip: '300.1.1.1'}}}), /IPv4/);
  assert.throws(() => normalizeExplore({kind: 'concept_lab', visual: {concept: 'rc_transient', values: {mode: 'boil'}}}), /选项/);
});

test('logic functions parse textbook notation and simplify to the minimal sum of products', () => {
  assert.equal(sop("AB + A'C + BC"), "A'C + AB");
  assert.equal(sop('A⊕B'), "A'B + AB'");
  assert.equal(sop("A'B'C'D' + A'B'CD' + AB'C'D' + AB'CD' + BD"), "B'D' + BD");
  assert.equal(sop('A·(B+C)'), 'AB + AC');
  assert.equal(sop('!(A*B)'), "A' + B'");
  assert.equal(sop("A + A'"), '');
  assert.deepEqual(normalizeExplore({kind: 'logic_lab', visual: {expression: "A + A'"}}).definition.sop, [[]]);
  assert.deepEqual(parseLogic('AB+C').variables, ['A', 'B', 'C']);
  assert.throws(() => parseLogic('A+B+C+D+E'), /1–4 个变量/);
  assert.throws(() => parseLogic('A+(B'), /括号/);
  assert.throws(() => parseLogic('A $ B'), /无法识别/);
  assert.deepEqual(minimizeSop(['A'], [0, 0]), []);
});

test('flip-flops update only on clock edges and counters wrap at their modulus', () => {
  const run = visual => { const n = normalizeExplore({kind: 'timing_lab', visual}); return timingWave(n.definition, createExploreState(n)); };
  assert.deepEqual(run({device: 'd', clocks: 4, inputs: {D: [1, 0, 0, 1]}}), [0, 1, 0, 0, 1]);
  assert.deepEqual(run({device: 't', clocks: 4, inputs: {T: [1, 1, 0, 1]}}), [0, 1, 0, 0, 1]);
  assert.deepEqual(run({device: 'jk', clocks: 4, inputs: {J: [1, 0, 1, 0], K: [0, 0, 1, 1]}}), [0, 1, 1, 0, 0]);
  assert.deepEqual(run({device: 'rs', clocks: 4, inputs: {S: [1, 0, 0, 1], R: [0, 0, 1, 1]}}), [0, 1, 1, 0, 0]);
  assert.deepEqual(run({device: 'counter', bits: 2, clocks: 5}), [0, 1, 2, 3, 0, 1]);
  assert.deepEqual(run({device: 'counter', bits: 2, clocks: 4, direction: 'down'}), [0, 3, 2, 1, 0]);
  assert.throws(() => run({device: 'd', clocks: 4, inputs: {D: [1, 0]}}), /4 个 0\/1/);
  assert.throws(() => run({device: 'counter', bits: 5}), /2–4/);
});

test('sequence diagrams come from fixed templates or validated custom actors', () => {
  for (const name of Object.keys(SEQUENCES)) assert.ok(normalizeExplore({kind: 'sequence_lab', visual: {template: name}}).definition.messages.length >= 3);
  const custom = normalizeExplore({kind: 'sequence_lab', visual: {actors: ['主机A', '交换机', '主机B'], messages: [{from: '主机A', to: '交换机', label: 'ARP 请求（广播）'}, {from: '主机B', to: '主机A', label: 'ARP 响应（单播）'}]}});
  assert.deepEqual(custom.definition.messages.map(m => [m.from, m.to]), [[0, 1], [2, 0]]);
  assert.throws(() => normalizeExplore({kind: 'sequence_lab', visual: {actors: ['A', 'B'], messages: [{from: 'A', to: 'C', label: 'x'}]}}), /参与方/);
  assert.throws(() => normalizeExplore({kind: 'sequence_lab', visual: {template: 'smtp'}}), /模板/);
});

test('explore labs persist validated state, show while quiz cards are closed, and never count as mastery', async t => {
  const store = fixture(t);
  store.setEnabled(key, false);
  const tool = createLearningActivityTool(store, {sessionKey: key});
  const shown = await tool.execute('call-1', {action: 'present', kind: 'concept_lab', topic: '串联分压', visual: {concept: 'series_divider', values: {R2: 3000}}});
  assert.equal(shown.isError, false, shown.details.error);
  assert.equal(shown.details.inline.kind, 'concept_lab');
  const id = shown.details.visual.id;
  let record = store.visuals.save(key, {id, revision: shown.details.visual.revision, state: {values: {R1: 1234.5678}}});
  assert.equal(record.state.values.R1, 1235);
  assert.throws(() => store.visuals.save(key, {id, revision: record.revision, state: {values: {R1: 5}}}), /100–10000/);
  assert.throws(() => store.visuals.save(key, {id, revision: record.revision, state: {other: 1}}), /未知字段/);
  const logic = (await tool.execute('call-2', {action: 'present', kind: 'logic_lab', visual: {expression: 'A+B'}})).details.visual;
  record = store.visuals.save(key, {id: logic.id, revision: logic.revision, state: {inputs: {A: 1}, view: 'kmap'}});
  assert.deepEqual(record.state, {inputs: {A: 1, B: 0}, view: 'kmap'});
  assert.throws(() => store.visuals.save(key, {id: logic.id, revision: record.revision, state: {inputs: {C: 1}}}), /已有变量/);
  const seq = (await tool.execute('call-3', {action: 'present', kind: 'sequence_lab', visual: {template: 'tcp_handshake'}})).details.visual;
  record = store.visuals.save(key, {id: seq.id, revision: seq.revision, state: {step: 2, seeds: {x: 5000}}});
  assert.deepEqual(record.state, {step: 2, seeds: {x: 5000, y: 300}});
  const prompt = learningPrompt(store, key);
  assert.match(prompt, /"concept":"series_divider"/);
  assert.match(prompt, /"template":"tcp_handshake","step":2/);
  assert.equal(store.status(key).enabled, false);
  assert.equal(store.listAttempts(key).total, 0);
});

test('the browser renderer computes textbook values', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(new URL('../ui/injections/laolao-learning-explore.js', import.meta.url), 'utf8'), {window, document: {}, Math, Number, String, Object, Array, JSON, Infinity, isNaN});
  const {fmt, CONCEPTS: C, wave} = window.__pinkieLearningExplore;
  assert.equal(fmt(.004, 'A'), '4 mA');
  assert.equal(fmt(37.67e-6, 'A'), '37.7 μA');
  assert.equal(fmt(2000, 'Ω'), '2 kΩ');
  assert.equal(fmt(-12, 'V'), '−12 V');
  const series = C.series_divider.compute({U: 12, R1: 1000, R2: 2000});
  assert.equal(series.U2, 8);
  const rc = C.rc_transient.compute({mode: 'charge', U: 10, R: 1e4, C: 1e-4, k: 1});
  assert.equal(rc.tau, 1); assert.equal(Number(rc.uc.toFixed(3)), 6.321);
  const bjt = C.bjt_bias.compute({Vcc: 12, Rb: 300e3, Rc: 3e3, beta: 50});
  assert.equal(bjt.region, '放大区'); assert.equal(Number(bjt.UCE.toFixed(2)), 6.35);
  assert.equal(C.bjt_bias.compute({Vcc: 12, Rb: 20e3, Rc: 3e3, beta: 50}).region, '饱和区');
  const rlc = C.rlc_series.compute({U: 10, R: 100, L: .1, C: 1e-5, f: 159.15});
  assert.ok(Math.abs(rlc.XL - rlc.XC) < 1); assert.ok(Math.abs(rlc.f0 - 159.15) < .1);
  const subnet = C.subnet.compute({ip: '192.168.10.34', prefix: 27});
  assert.match(subnet.readouts.map(r => r[1]).join(' '), /255\.255\.255\.224 192\.168\.10\.32 192\.168\.10\.63/);
  assert.equal(C.opamp.compute({mode: 'inverting', R1: 1e4, Rf: 1e5, ui: .5, Vsat: 12}).uo, -5);
  assert.equal(C.opamp.compute({mode: 'noninverting', R1: 1e4, Rf: 1e5, ui: 2, Vsat: 12}).uo, 12);
  assert.deepEqual(Array.from(wave({device: 'jk', clocks: 2}, {q0: 0, inputs: {J: [1, 1], K: [0, 1]}})), [0, 1, 0]);
});

test('the prompt routes 专升本 topics to the live labs', t => {
  const prompt = learningPrompt(fixture(t), key);
  for (const pattern of [/ee4 RC\/RL 暂态/, /bjt_bias/, /logic_lab/, /timing_lab/, /sequence_lab tcp_handshake/, /concept_lab subnet/, /values 设成这些/]) assert.match(prompt, pattern);
});

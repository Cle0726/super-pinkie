import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {LAB_KINDS, normalizeLab, createLabState, saveLabState, publicLab, labContext} from './learning-labs.mjs';
import {PRACTICE_KINDS, normalizePractice, createPracticeState, savePracticeState, publicPractice, finishExam, applyPracticeFeedback} from './learning-practice.mjs';
import {runLearningCompute} from './learning-compute.mjs';
import {EXPLORE_KINDS, normalizeExplore, createExploreState, saveExploreState, exploreContext} from './learning-explore.mjs';
import {DEVICE_KINDS, normalizeDevice, createDeviceState, saveDeviceState, deviceContext} from './learning-devices.mjs';

const hash = value => createHash('sha256').update(String(value)).digest('hex');
const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const families = {linear: ['a', 'b'], quadratic: ['a', 'b', 'c'], sine: ['a', 'b', 'c']};
export const VISUAL_KINDS = new Set(['function_plot', 'process_flow', ...LAB_KINDS, ...PRACTICE_KINDS, ...EXPLORE_KINDS, ...DEVICE_KINDS]);

function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error('交互记录暂时无法读取，请稍后重试'); }
}
function write(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const temp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(value), {mode: 0o600}); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function number(value, fallback, min = -1000, max = 1000) {
  const result = value == null ? fallback : value;
  if (typeof result !== 'number' || !Number.isFinite(result) || result < min || result > max) throw new Error('图表参数需要在有效范围内');
  return result;
}
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function pickPracticeContext(record) {
  const {kind,state}=record;
  if(kind==='c_program'||kind==='memory_lab')return {code:state.code.slice(0,2200),prediction:state.prediction,result:state.result?{stdout:state.result.stdout?.slice(0,1500),stderr:state.result.stderr?.slice(0,500),exitCode:state.result.exitCode}:null};
  if(kind==='english_writing')return {draft:state.draft.slice(0,2500),feedbackRequested:state.feedbackRequested};
  if(kind==='mock_exam')return {phase:state.phase,answered:Object.keys(state.answers).length,deadline:state.deadline};
  if(kind==='math_check')return {...state,result:state.result||null};
  return {parameters:state.parameters,checked:state.checked,prediction:state.prediction,answer:state.answer,evidence:state.evidence};
}

export function normalizeVisual(payload = {}) {
  const kind = String(payload.kind || '');
  if (!VISUAL_KINDS.has(kind)) throw new Error('不支持这种交互内容');
  if (PRACTICE_KINDS.has(kind)) return normalizePractice(payload);
  const spec = payload.visual;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('请提供 visual 交互定义');
  if (LAB_KINDS.has(kind)) return normalizeLab(payload);
  if (EXPLORE_KINDS.has(kind)) return normalizeExplore(payload);
  if (DEVICE_KINDS.has(kind)) return normalizeDevice(payload);
  if (kind === 'function_plot') {
    const family = String(spec.family || 'quadratic');
    const keys = families[family];
    if (!keys) throw new Error('函数图支持 linear、quadratic 或 sine');
    const domain = spec.domain ?? [-5, 5];
    if (!Array.isArray(domain) || domain.length !== 2) throw new Error('请给出两个横坐标范围端点');
    const bounds = domain.map(value => number(value, 0));
    if (bounds[0] >= bounds[1] || bounds[1] - bounds[0] < .1) throw new Error('横坐标范围需要从小到大');
    const supplied = spec.parameters ?? [];
    if (!Array.isArray(supplied) || supplied.length > 3 || supplied.some(p => !keys.includes(p?.key))
      || new Set(supplied.map(p => p.key)).size !== supplied.length) throw new Error('函数参数名称或数量不正确');
    const parameters = keys.map((key, index) => {
      const raw = supplied.find(p => p.key === key) || {};
      const min = number(raw.min, -3), max = number(raw.max, 3);
      if (min >= max) throw new Error('参数最大值需要大于最小值');
      const step = number(raw.step, .1, .001, max - min);
      const value = number(raw.value, index === 0 ? 1 : 0);
      if (value < min || value > max) throw new Error('参数初始值需要位于范围内');
      return {key, label: text(raw.label || key, 40), min, max, step, value};
    });
    return {kind, title: text(payload.topic || payload.question || '函数实验', 160), definition: {family, domain: bounds, parameters}};
  }
  if (!Array.isArray(spec.steps) || spec.steps.length < 2 || spec.steps.length > 12) throw new Error('流程演示需要 2–12 个步骤');
  const steps = spec.steps.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || !text(raw.label, 100)) throw new Error('每个步骤都需要名称');
    return {id: text(raw.id || `step-${index + 1}`, 100), label: text(raw.label, 100),
      description: text(raw.description, 2400), input: text(raw.input, 1200), output: text(raw.output, 1200)};
  });
  if (new Set(steps.map(step => step.id)).size !== steps.length) throw new Error('步骤编号不能重复');
  return {kind, title: text(payload.topic || payload.question || '流程演示', 160), definition: {steps}};
}

/** Durable, session-scoped visual state. These records contain no executable
 * HTML or model-generated JavaScript and never count as mastery evidence. */
export class LearningVisualStore {
  constructor(learning) { this.learning = learning; this.root = path.join(learning.root, 'inline'); }
  directory(sessionKey) { return path.join(this.root, hash(this.learning.assertLearningSession(sessionKey))); }
  file(sessionKey, id, type = 'visual') {
    if (!text(id, 160) || String(id).length > 160) throw new Error('缺少交互内容编号');
    return path.join(this.directory(sessionKey), `${type}-${hash(id)}.json`);
  }
  remember(record) {
    const file = path.join(this.directory(record.sessionKey), 'recent.json');
    const index = read(file, []);
    const rows = Array.isArray(index) ? index : [];
    write(file, [record.id, ...rows.filter(id => id !== record.id)].slice(0, 16));
  }
  present(sessionKey, payload) {
    this.learning.assertLearningSession(sessionKey);
    const normalized = {...normalizeVisual(payload), sources: Array.isArray(payload.sources) ? payload.sources : []};
    const id = text(payload.activity_id || (payload.__toolCallId ? `visual-${hash(sessionKey + '\0' + payload.__toolCallId).slice(0, 32)}` : randomUUID()), 160);
    const file = this.file(sessionKey, id);
    const previous = read(file, null);
    if (previous && (previous.sessionKey !== sessionKey || previous.kind !== normalized.kind)) throw new Error('交互内容编号已被使用');
    if(previous&&(PRACTICE_KINDS.has(previous.kind)||DEVICE_KINDS.has(previous.kind))&&previous.interactedAt
      && JSON.stringify(previous.definition)!==JSON.stringify(normalized.definition))
      throw Error('这张练习已经操作过，请新建一张；原草稿保持原样');
    if (previous && JSON.stringify({kind: previous.kind, title: previous.title, definition: previous.definition, sources: previous.sources || []}) === JSON.stringify(normalized)) return previous;
    const values = Object.fromEntries((normalized.definition.parameters || []).map(p => [p.key,
      clamp(previous?.state?.values?.[p.key] ?? p.value, p.min, p.max)]));
    const selectedStep = normalized.definition.steps?.some(p => p.id === previous?.state?.selectedStep)
      ? previous.state.selectedStep : normalized.definition.steps?.[0]?.id;
    const record = {v: 1, id, sessionKey, ...normalized, revision: (previous?.revision || 0) + 1,
      createdAt: previous?.createdAt || Date.now(), updatedAt: Date.now(),
      interactedAt: previous?.interactedAt || 0, state: PRACTICE_KINDS.has(normalized.kind) ? createPracticeState(normalized, previous)
        : LAB_KINDS.has(normalized.kind) ? createLabState(normalized, previous)
        : EXPLORE_KINDS.has(normalized.kind) ? createExploreState(normalized, previous)
        : DEVICE_KINDS.has(normalized.kind) ? createDeviceState(normalized, previous)
        : normalized.kind === 'function_plot' ? {values} : {selectedStep}};
    write(file, record); this.remember(record); return record;
  }
  get(sessionKey, id) {
    const record = read(this.file(sessionKey, id), null);
    if (!record || record.id !== id || record.sessionKey !== sessionKey) throw new Error('这条交互内容不存在');
    if(record.kind==='mock_exam'&&record.state.phase==='running'&&Date.now()>=record.state.deadline)
      return this.commit(record,finishExam(record,Date.now(),'timeout'));
    return record;
  }
  public(record) { return PRACTICE_KINDS.has(record.kind) ? publicPractice(record,this.learning) : LAB_KINDS.has(record.kind) ? publicLab(record) : record; }
  commit(record,state) {
    const updated={...record,state,revision:record.revision+1,updatedAt:Date.now(),interactedAt:Date.now()};
    write(this.file(record.sessionKey,record.id),updated);this.remember(updated);return updated;
  }
  async run(sessionKey,params) {
    const record=this.get(sessionKey,params.id);
    if(params.revision!==record.revision)throw Error('交互内容已更新，请重新读取后运行');
    const result=await runLearningCompute(record.kind,record.state);
    if(this.get(sessionKey,record.id).revision!==record.revision)throw Error('运行期间输入已更新，请重新运行');
    return this.commit(record,{...record.state,result,...(record.kind==='memory_lab'?{traceStep:0}:{})});
  }
  feedback(sessionKey,id,payload) {
    const record=this.get(sessionKey,id);
    const callId=text(payload.__toolCallId,160);
    if(callId && record.feedbackCallIds?.includes(callId))return record;
    const state=applyPracticeFeedback(record,payload);
    return this.commit({...record,...(callId?{feedbackCallIds:[...(record.feedbackCallIds||[]),callId].slice(-20)}:{})},state);
  }
  recent(sessionKey) {
    const ids=read(path.join(this.directory(sessionKey),'recent.json'),[]);
    return (Array.isArray(ids)?ids:[]).flatMap(id=>{try{const r=this.get(sessionKey,id);return [{v:1,id:r.id,sessionKey,kind:r.kind,title:r.title,revision:r.revision}];}catch{return [];}});
  }
  save(sessionKey, params) {
    const record = this.get(sessionKey, params.id);
    if (params.revision !== record.revision) throw new Error('交互内容已更新，请重新读取后保存');
    let next;
    if (PRACTICE_KINDS.has(record.kind)) next = savePracticeState(record,params.state);
    else if (LAB_KINDS.has(record.kind)) next = saveLabState(record, params.state);
    else if (EXPLORE_KINDS.has(record.kind)) next = saveExploreState(record, params.state);
    else if (DEVICE_KINDS.has(record.kind)) next = saveDeviceState(record, params.state);
    else if (record.kind === 'function_plot') {
      const supplied = params.state?.values;
      if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)
        || Object.keys(supplied).some(key => !record.definition.parameters.some(p => p.key === key))) throw new Error('函数参数不正确');
      next = {values: {...record.state.values}};
      for (const [key, value] of Object.entries(supplied)) {
        const p = record.definition.parameters.find(p => p.key === key);
        const finite = number(value, p.value, p.min, p.max);
        const snapped = p.min + Math.round((finite - p.min) / p.step) * p.step;
        next.values[key] = Number(clamp(snapped, p.min, p.max).toPrecision(12));
      }
    } else {
      const id = params.state?.selectedStep;
      if (!record.definition.steps.some(step => step.id === id)) throw new Error('流程步骤不存在');
      next = {selectedStep: id};
    }
    if (JSON.stringify(next) === JSON.stringify(record.state)) return record;
    const updated = {...record, state: next, revision: record.revision + 1, updatedAt: Date.now(), interactedAt: Date.now()};
    write(this.file(sessionKey, record.id), updated); this.remember(updated); return updated;
  }
  context(sessionKey) {
    const ids = read(path.join(this.directory(sessionKey), 'recent.json'), []);
    const records = (Array.isArray(ids) ? ids : []).slice(0, 16).map(id => this.get(sessionKey, id)).filter(record => record.interactedAt).slice(0, 3);
    if (!records.length) return '';
    const rows = [];
    for (const record of records) {
      const step = record.definition.steps?.find(step => step.id === record.state.selectedStep);
      const row = {id: record.id, kind: record.kind, title: record.title,
        ...(PRACTICE_KINDS.has(record.kind) ? {state:pickPracticeContext(record)} : LAB_KINDS.has(record.kind) ? labContext(record) : EXPLORE_KINDS.has(record.kind) ? {state: exploreContext(record)} : DEVICE_KINDS.has(record.kind) ? {state: deviceContext(record)} : {state: record.state,
          family: record.definition.family, domain: record.definition.domain,
          ...(step ? {step: {label: step.label, description: step.description.slice(0, 500), input: step.input.slice(0, 200), output: step.output.slice(0, 200)}} : {})})};
      if (JSON.stringify([...rows, row]).length <= 6000) rows.push(row);
    }
    return '\n【当前消息内交互状态，只说明操作，不代表已掌握】\n' + JSON.stringify(rows);
  }
  archiveActivity(sessionKey, activity) {
    if (!activity?.id) return;
    write(this.file(sessionKey, activity.id, 'quiz'), {sessionKey, activity});
  }
  activity(sessionKey, id, currentState) {
    const stored = read(this.file(sessionKey, id, 'quiz'), null);
    const activity = currentState.current?.id === id ? currentState.current
      : stored?.sessionKey === sessionKey && stored.activity?.id === id ? stored.activity
        : currentState.history.find(item => item.id === id);
    if (!activity) throw new Error('这条练习记录不存在');
    return activity;
  }
  draft(sessionKey, id) {
    const value = read(this.file(sessionKey, id, 'draft'), {revision: 0, items: {}});
    return value.sessionKey && value.sessionKey !== sessionKey ? {revision: 0, items: {}} : value;
  }
  saveDraft(sessionKey, id, params, item) {
    const current = this.draft(sessionKey, id);
    if (params.revision !== current.revision) throw new Error('作答草稿已更新，请重新读取后保存');
    const answer = Array.isArray(params.answer) ? params.answer.map(value => text(value, 160)).slice(0, 8) : text(params.answer, 8000);
    const confidence = params.confidence == null ? null : number(params.confidence, null, 0, 100);
    const draft = {answer, confidence, hintUsed: Boolean(params.hintUsed)};
    if (JSON.stringify(current.items[item.id]) === JSON.stringify(draft)) return current;
    const updated = {sessionKey, revision: current.revision + 1, items: {...current.items, [item.id]: draft}};
    write(this.file(sessionKey, id, 'draft'), updated); return updated;
  }
}

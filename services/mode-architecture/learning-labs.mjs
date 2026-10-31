// Data-only learning labs. No model-authored code runs in the renderer.
export const LAB_KINDS = new Set(['sentence_parse', 'mapreduce_lab']);
export const SENTENCE_ROLES = ['subject', 'predicate', 'object', 'complement', 'clause', 'modifier', 'linker'];
const text = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const clone = value => structuredClone(value);
export function mapReduceData(input, workers = 2) {
  if (!Number.isInteger(workers) || workers < 1 || workers > 4) throw new Error('Reduce桶数量需要是1–4之间的整数');
  const words = String(input).toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
  if (!words.length || words.length > 80) throw new Error('词频实验需要1–80个词，请缩短输入');
  const partition = key => {
    let hash = 0; for (let i = 0; i < key.length; i++) hash = (Math.imul(31, hash) + key.charCodeAt(i)) | 0;
    return (hash & 0x7fffffff) % workers;
  };
  const pairs = words.map((key, index) => ({id: `pair-${index}`, key, value: 1, bucket: partition(key)}));
  const counts = new Map(); for (const {key} of pairs) counts.set(key, (counts.get(key) || 0) + 1);
  return {pairs, output: [...counts].map(([key, count]) => ({key, count})).sort((a, b) => a.key.localeCompare(b.key))};
}
export function normalizeLab(payload) {
  const spec = payload.visual;
  if (payload.kind === 'sentence_parse') {
    if (!Array.isArray(spec.segments) || spec.segments.length < 2 || spec.segments.length > 60) throw new Error('拆句需要2–60个片段');
    const segments = spec.segments.map((raw, index) => {
      if (!raw || typeof raw !== 'object') throw new Error('拆句片段格式不正确');
      const value = String(raw?.text ?? '').slice(0, 500);
      if (!value.trim() || !SENTENCE_ROLES.includes(raw.role)) throw new Error('每个拆句片段需要原文和有效的语法角色');
      const acceptedRoles = [...new Set([raw.role, ...(Array.isArray(raw.accepted_roles) ? raw.accepted_roles : [])])];
      if (acceptedRoles.some(role => !SENTENCE_ROLES.includes(role))) throw new Error('不支持这种语法角色');
      return {id: text(raw.id || `segment-${index + 1}`, 100), text: value, role: raw.role, acceptedRoles,
        explanation: text(raw.explanation, 1800), referent: text(raw.referent, 1000)};
    });
    if (new Set(segments.map(s => s.id)).size !== segments.length) throw new Error('拆句片段编号不能重复');
    if (segments.some(segment => ['__proto__', 'constructor', 'prototype'].includes(segment.id))) throw new Error('拆句片段编号不正确');
    const sentence = text(spec.sentence || segments.map(s => s.text).join(''), 4000);
    if (sentence.replace(/\s/g, '') !== segments.map(s => s.text).join('').trim().replace(/\s/g, '')) throw new Error('片段必须完整对应原句，不能漏词或改写');
    return {kind: payload.kind, title: text(payload.topic || '长难句拆解', 160), definition: {sentence, segments}};
  }
  if (String(spec.input || payload.question || '').length > 2000) throw new Error('输入最多2000字');
  const input = text(spec.input || payload.question, 2000);
  const workers = spec.workers ?? 2;
  if (!Number.isInteger(workers) || workers < 1 || workers > 4) throw new Error('Reduce桶数量需要是1–4之间的整数');
  mapReduceData(input, workers);
  return {kind: 'mapreduce_lab', title: text(payload.topic || 'MapReduce 词频实验', 160), definition: {input, workers}};
}
export function createLabState(normalized, previous) {
  if (normalized.kind === 'sentence_parse') return {labels: {}, checked: false};
  const old = previous?.definition;
  return old?.input === normalized.definition.input && old?.workers === normalized.definition.workers
    ? clone(previous.state) : {input: normalized.definition.input, phase: 'input', assignments: {}, usedDemo: false};
}
export function sentenceResult(record) {
  const entries = record.definition.segments.map(segment => ({id: segment.id, selected: record.state.labels[segment.id] || '',
    correct: segment.acceptedRoles.includes(record.state.labels[segment.id])}));
  return {correct: entries.filter(entry => entry.correct).length, total: entries.length, entries};
}
export function saveLabState(record, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('交互状态格式不正确');
  const next = clone(record.state);
  if (record.kind === 'sentence_parse') {
    if (Object.keys(patch).some(key => !['labels', 'check', 'reset'].includes(key))) throw new Error('拆句状态包含未知字段');
    if (patch.reset === true) return {labels: {}, checked: false};
    if (patch.labels !== undefined) {
      if (next.checked) throw new Error('已核对的标注不能改写，请先重新练习');
      if (!patch.labels || typeof patch.labels !== 'object' || Array.isArray(patch.labels)) throw new Error('拆句标注格式不正确');
      for (const [id, role] of Object.entries(patch.labels)) {
        if (!record.definition.segments.some(segment => segment.id === id) || (role !== '' && !SENTENCE_ROLES.includes(role))) throw new Error('拆句标注包含无效片段或角色');
        if (role) next.labels[id] = role; else delete next.labels[id];
      }
    }
    if (patch.check === true) {
      if (!Object.keys(next.labels).length) throw new Error('先标注至少一处，再核对');
      next.checked = true;
    }
    return next;
  }
  if (Object.keys(patch).some(key => !['input', 'phase', 'assignments', 'demonstrate'].includes(key))) throw new Error('词频实验状态包含未知字段');
  if (patch.input !== undefined) {
    if (typeof patch.input !== 'string' || patch.input.length > 2000) throw new Error('输入最多2000字');
    const input = patch.input.trim(); mapReduceData(input, record.definition.workers);
    if (input !== next.input) Object.assign(next, {input, phase: 'input', assignments: {}, usedDemo: false});
  }
  const {pairs} = mapReduceData(next.input, record.definition.workers);
  if (patch.assignments !== undefined) {
    if (!patch.assignments || typeof patch.assignments !== 'object' || Array.isArray(patch.assignments)) throw new Error('分桶状态格式不正确');
    for (const [id, bucket] of Object.entries(patch.assignments)) {
      if (!pairs.some(pair => pair.id === id) || (bucket !== null && (!Number.isInteger(bucket) || bucket < 0 || bucket >= record.definition.workers))) throw new Error('分桶数据不正确');
      if (bucket === null) delete next.assignments[id]; else next.assignments[id] = bucket;
    }
  }
  if (patch.demonstrate === true) {
    next.assignments = Object.fromEntries(pairs.map(pair => [pair.id, pair.bucket])); next.usedDemo = true; next.phase = 'shuffle';
  }
  if (patch.phase !== undefined) {
    if (!['input', 'map', 'shuffle', 'reduce'].includes(patch.phase)) throw new Error('不存在这个实验阶段');
    next.phase = patch.phase;
  }
  if (next.phase === 'reduce' && pairs.some(pair => next.assignments[pair.id] !== pair.bucket)) throw new Error('先按key完成分桶并核对，再运行Reduce');
  return next;
}
export function publicLab(record) {
  const value = clone(record);
  if (value.kind === 'sentence_parse') {
    if (!value.state.checked) value.definition.segments = value.definition.segments.map(({id, text}) => ({id, text}));
    else value.analysis = sentenceResult(record);
  }
  return value;
}
export function labContext(record) {
  if (record.kind === 'sentence_parse') return {sentence: record.definition.sentence.slice(0, 700), labels: record.state.labels,
    checked: record.state.checked, ...(record.state.checked ? {comparison: sentenceResult(record)} : {})};
  const {pairs, output} = mapReduceData(record.state.input, record.definition.workers);
  return {input: record.state.input.slice(0, 700), phase: record.state.phase, workers: record.definition.workers,
    assigned: Object.keys(record.state.assignments).length, total: pairs.length, usedDemo: record.state.usedDemo,
    ...(record.state.phase === 'reduce' ? {output: output.slice(0, 20)} : {})};
}

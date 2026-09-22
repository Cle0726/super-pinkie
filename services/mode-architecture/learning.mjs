import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

const MAX_TEXT = 12_000;
const MAX_OPTIONS = 8;
const MAX_HISTORY = 24;
const MAX_NOTES = 500;

function stateRoot() {
  if (process.env.PINKIE_STATE_ROOT) return path.resolve(process.env.PINKIE_STATE_ROOT);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'SuperPinkie');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), 'SuperPinkie');
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'super-pinkie');
}

function workspaceRoot() {
  return process.env.PINKIE_LEARNING_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace-learning');
}

function cleanText(value, limit = MAX_TEXT) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, limit);
}

function cleanId(value) {
  return cleanText(value, 180).replace(/[^a-zA-Z0-9_.:-]/g, '-');
}

function sessionHash(sessionKey) {
  return createHash('sha256').update(String(sessionKey || '')).digest('hex');
}

function isLearningSession(sessionKey) {
  return String(sessionKey || '').startsWith('agent:learning:');
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
}

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  ensureDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  fs.renameSync(temporary, file);
  try { fs.chmodSync(file, 0o600); } catch {}
}

function normalizedKind(value) {
  const kind = cleanText(value, 32).toLowerCase();
  if (['single_choice', 'multiple_choice', 'fill_blank', 'short_answer'].includes(kind)) return kind;
  return 'single_choice';
}

function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.slice(0, MAX_OPTIONS).map((raw, index) => {
    if (typeof raw === 'string') return {id: String(index + 1), label: cleanText(raw, 1000)};
    return {
      id: cleanId(raw?.id || raw?.value || String(index + 1)) || String(index + 1),
      label: cleanText(raw?.label || raw?.text || raw?.value, 1000),
    };
  }).filter(option => option.label);
}

function normalizeAnswer(value) {
  if (Array.isArray(value)) return value.map(item => cleanText(item, 200)).filter(Boolean).sort();
  return cleanText(value, 4000);
}

function normalizeChoiceAnswer(value, options, multiple) {
  const values = (Array.isArray(value) ? value : [value]).map(item => cleanText(item, 200)).filter(Boolean);
  const mapped = values.map(item => {
    const match = options.find(option => comparable(option.id) === comparable(item) || comparable(option.label) === comparable(item));
    return match?.id || item;
  });
  return multiple ? mapped.sort() : (mapped[0] || '');
}

function comparable(value) {
  return cleanText(value, 4000).normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function sameAnswer(expected, actual, kind) {
  if (expected === undefined || expected === null || expected === '') return null;
  if (kind === 'multiple_choice') {
    const left = (Array.isArray(expected) ? expected : [expected]).map(comparable).filter(Boolean).sort();
    const right = (Array.isArray(actual) ? actual : [actual]).map(comparable).filter(Boolean).sort();
    return left.length === right.length && left.every((item, index) => item === right[index]);
  }
  if (kind === 'short_answer') return null;
  return comparable(expected) === comparable(actual);
}

function publicActivity(activity) {
  if (!activity) return null;
  const {correctAnswer: _correctAnswer, rubric: _rubric, ...safe} = activity;
  return safe;
}

function markdownEscape(text) {
  return cleanText(text).replace(/\\/g, '\\\\').replace(/\r?\n/g, '  \n');
}

function sessionFromContext(context = {}) {
  return String(context.sessionKey || context.hookContext?.sessionKey || context.context?.sessionKey || '');
}

export class LearningInteractionStore {
  constructor({root = path.join(stateRoot(), 'learning'), workspace = workspaceRoot()} = {}) {
    this.root = path.resolve(root);
    this.workspace = path.resolve(workspace);
    this.activityRoot = path.join(this.root, 'sessions');
    this.notesFile = path.join(this.root, 'notes.json');
    this.notesMarkdown = path.join(this.workspace, 'notes', '学习笔记.md');
  }

  assertLearningSession(sessionKey) {
    const key = String(sessionKey || '');
    if (!isLearningSession(key)) throw new Error('互动学习只在学习模式会话中可用');
    return key;
  }

  activityFile(sessionKey) {
    return path.join(this.activityRoot, `${sessionHash(sessionKey)}.json`);
  }

  read(sessionKey) {
    const key = this.assertLearningSession(sessionKey);
    const initial = {v: 1, sessionKey: key, enabled: false, revision: 0, current: null, history: [], updatedAt: 0};
    const state = readJson(this.activityFile(key), initial);
    if (state.sessionKey && state.sessionKey !== key) return initial;
    return {...initial, ...state, sessionKey: key, history: Array.isArray(state.history) ? state.history.slice(-MAX_HISTORY) : []};
  }

  write(sessionKey, state) {
    const key = this.assertLearningSession(sessionKey);
    const next = {
      ...state,
      v: 1,
      sessionKey: key,
      revision: Math.max(0, Number(state.revision) || 0) + 1,
      updatedAt: Date.now(),
      history: Array.isArray(state.history) ? state.history.slice(-MAX_HISTORY) : [],
    };
    writeJsonAtomic(this.activityFile(key), next);
    return next;
  }

  status(sessionKey) {
    const state = this.read(sessionKey);
    return {v: 1, sessionKey: state.sessionKey, enabled: Boolean(state.enabled), revision: state.revision, current: publicActivity(state.current), updatedAt: state.updatedAt};
  }

  setEnabled(sessionKey, enabled) {
    const state = this.read(sessionKey);
    state.enabled = Boolean(enabled);
    return this.publicState(this.write(sessionKey, state));
  }

  publicState(state) {
    return {v: 1, sessionKey: state.sessionKey, enabled: Boolean(state.enabled), revision: state.revision, current: publicActivity(state.current), updatedAt: state.updatedAt};
  }

  present(sessionKey, payload = {}) {
    const state = this.read(sessionKey);
    const kind = normalizedKind(payload.kind);
    const question = cleanText(payload.question, 8000);
    const options = normalizeOptions(payload.options);
    if (!question) throw new Error('question 不能为空');
    if ((kind === 'single_choice' || kind === 'multiple_choice') && options.length < 2) throw new Error('选择题至少需要两个选项');
    if (state.current) state.history.push({...state.current, archivedAt: Date.now()});
    state.enabled = true;
    state.current = {
      id: cleanId(payload.activity_id) || randomUUID(),
      kind,
      phase: 'asking',
      question,
      options,
      hint: cleanText(payload.hint, 3000),
      topic: cleanText(payload.topic, 500),
      correctAnswer: (kind === 'single_choice' || kind === 'multiple_choice')
        ? normalizeChoiceAnswer(payload.correct_answer, options, kind === 'multiple_choice')
        : normalizeAnswer(payload.correct_answer),
      rubric: cleanText(payload.rubric, 5000),
      createdAt: Date.now(),
      submission: null,
      result: null,
    };
    return this.publicState(this.write(sessionKey, state));
  }

  submit(sessionKey, payload = {}) {
    const state = this.read(sessionKey);
    const current = state.current;
    if (!state.enabled || !current) throw new Error('当前没有可作答的互动题');
    if (cleanId(payload.activityId || payload.activity_id) !== current.id) throw new Error('题卡已经更新，请按当前题卡作答');
    const submissionId = cleanId(payload.submissionId || payload.submission_id) || randomUUID();
    if (current.submission?.id === submissionId) return this.publicState(state);
    const answer = normalizeAnswer(payload.answer);
    if ((Array.isArray(answer) && answer.length === 0) || (!Array.isArray(answer) && !answer)) throw new Error('请先填写答案');
    const correctness = sameAnswer(current.correctAnswer, answer, current.kind);
    current.submission = {
      id: submissionId,
      answer,
      confidence: Math.max(0, Math.min(100, Number(payload.confidence) || 0)),
      correctness,
      submittedAt: Date.now(),
    };
    current.phase = 'evaluating';
    state.current = current;
    return this.publicState(this.write(sessionKey, state));
  }

  resolve(sessionKey, payload = {}) {
    const state = this.read(sessionKey);
    const current = state.current;
    if (!current) throw new Error('当前没有互动题');
    const requested = cleanId(payload.activity_id || payload.activityId);
    if (requested && requested !== current.id) throw new Error('不能结算已经过期的题卡');
    const deterministic = current.submission?.correctness;
    const correct = typeof payload.correct === 'boolean' ? payload.correct : deterministic;
    current.phase = 'explained';
    current.result = {
      correct: typeof correct === 'boolean' ? correct : null,
      feedback: cleanText(payload.feedback, 5000),
      explanation: cleanText(payload.explanation, 8000),
      keyPoint: cleanText(payload.key_point || payload.keyPoint, 5000),
      resolvedAt: Date.now(),
    };
    state.current = current;
    return this.publicState(this.write(sessionKey, state));
  }

  complete(sessionKey, payload = {}) {
    const state = this.read(sessionKey);
    if (state.current) {
      state.current = {...state.current, phase: 'complete', completedAt: Date.now(), summary: cleanText(payload.summary, 3000)};
    }
    if (payload.disable === true) state.enabled = false;
    return this.publicState(this.write(sessionKey, state));
  }

  readNotes() {
    const raw = readJson(this.notesFile, {v: 1, notes: []});
    return {v: 1, notes: Array.isArray(raw.notes) ? raw.notes.slice(0, MAX_NOTES) : []};
  }

  writeNotes(notes) {
    const state = {v: 1, updatedAt: Date.now(), notes: notes.slice(0, MAX_NOTES)};
    writeJsonAtomic(this.notesFile, state);
    this.writeNotesMarkdown(state.notes);
    return state;
  }

  writeNotesMarkdown(notes) {
    ensureDirectory(path.dirname(this.notesMarkdown));
    const body = ['# 学习笔记', '', '> 由学习模式自动保存；可以直接编辑或复制。', ''];
    for (const note of notes) {
      body.push(`## ${markdownEscape(note.title || '知识点')}`, '');
      body.push(markdownEscape(note.content), '');
      const meta = [note.tags?.length ? `标签：${note.tags.join('、')}` : '', note.sourceLabel ? `来源：${note.sourceLabel}` : '', note.createdAt ? `时间：${new Date(note.createdAt).toISOString()}` : ''].filter(Boolean);
      if (meta.length) body.push(`_${markdownEscape(meta.join(' · '))}_`, '');
    }
    const temporary = `${this.notesMarkdown}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${body.join('\n').trim()}\n`, {encoding: 'utf8', mode: 0o600});
    fs.renameSync(temporary, this.notesMarkdown);
  }

  listNotes({query = '', limit = 200} = {}) {
    const needle = comparable(query);
    const notes = this.readNotes().notes.filter(note => !needle || comparable(`${note.title} ${note.content} ${(note.tags || []).join(' ')}`).includes(needle));
    return {v: 1, notes: notes.slice(0, Math.max(1, Math.min(500, Number(limit) || 200))), markdownPath: this.notesMarkdown};
  }

  saveNote(sessionKey, payload = {}) {
    this.assertLearningSession(sessionKey);
    const content = cleanText(payload.content, 20_000);
    if (!content) throw new Error('笔记内容不能为空');
    const current = this.readNotes().notes;
    const requestedId = cleanId(payload.id);
    const existing = requestedId ? current.find(note => note.id === requestedId) : null;
    const note = {
      id: existing?.id || randomUUID(),
      title: cleanText(payload.title, 500) || cleanText(content.split(/\r?\n/)[0], 80) || '知识点',
      content,
      tags: Array.isArray(payload.tags) ? payload.tags.slice(0, 12).map(tag => cleanText(tag, 80)).filter(Boolean) : [],
      sourceSessionKey: String(sessionKey),
      sourceLabel: cleanText(payload.sourceLabel || payload.source_label, 500),
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    const next = [note, ...current.filter(item => item.id !== note.id)];
    this.writeNotes(next);
    return {ok: true, note, markdownPath: this.notesMarkdown};
  }

  deleteNote(sessionKey, id) {
    this.assertLearningSession(sessionKey);
    const noteId = cleanId(id);
    const current = this.readNotes().notes;
    const next = current.filter(note => note.id !== noteId);
    if (next.length === current.length) throw new Error('没有找到这条笔记');
    this.writeNotes(next);
    return {ok: true, id: noteId};
  }
}

function toolResponse(value, isError = false) {
  return {content: [{type: 'text', text: JSON.stringify(value)}], details: value, isError};
}

export function createLearningActivityTool(store, initialContext = {}) {
  let activeSessionKey = sessionFromContext(initialContext);
  return {
    name: 'learning_activity',
    label: '互动学习',
    description: '在学习模式中展示、结算或结束一张原生互动题卡。不要用 Markdown/HTML 模拟题卡。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {type: 'string', enum: ['present', 'resolve', 'complete']},
        activity_id: {type: 'string'},
        kind: {type: 'string', enum: ['single_choice', 'multiple_choice', 'fill_blank', 'short_answer']},
        topic: {type: 'string'},
        question: {type: 'string'},
        options: {type: 'array', items: {oneOf: [{type: 'string'}, {type: 'object', properties: {id: {type: 'string'}, label: {type: 'string'}}, required: ['label']}] }},
        correct_answer: {oneOf: [{type: 'string'}, {type: 'array', items: {type: 'string'}}]},
        rubric: {type: 'string'},
        hint: {type: 'string'},
        correct: {type: 'boolean'},
        feedback: {type: 'string'},
        explanation: {type: 'string'},
        key_point: {type: 'string'},
        summary: {type: 'string'},
        disable: {type: 'boolean'},
      },
      required: ['action'],
    },
    prepareBeforeToolCallParams(params, meta = {}) {
      activeSessionKey = sessionFromContext(meta.hookContext || meta) || activeSessionKey;
      return params;
    },
    async execute(_toolCallId, params = {}) {
      try {
        if (!activeSessionKey) throw new Error('缺少当前学习会话');
        const action = cleanText(params.action, 32);
        if (action === 'present') return toolResponse(store.present(activeSessionKey, params));
        if (action === 'resolve') return toolResponse(store.resolve(activeSessionKey, params));
        if (action === 'complete') return toolResponse(store.complete(activeSessionKey, params));
        throw new Error('不支持的互动学习动作');
      } catch (error) {
        return toolResponse({ok: false, error: error instanceof Error ? error.message : String(error)}, true);
      }
    },
  };
}

function register(api, name, handler) {
  api.registerGatewayMethod(name, async ({params, respond}) => {
    try {
      respond(true, await handler(params || {}));
    } catch (error) {
      respond(false, undefined, {code: 'INVALID_REQUEST', message: error instanceof Error ? error.message : String(error)});
    }
  }, {scope: 'operator.admin'});
}

export function registerLearningGateway(api, store) {
  register(api, 'pinkie.learning.status', params => store.status(String(params.sessionKey || '')));
  register(api, 'pinkie.learning.set', params => store.setEnabled(String(params.sessionKey || ''), Boolean(params.enabled)));
  register(api, 'pinkie.learning.current', params => store.status(String(params.sessionKey || '')));
  register(api, 'pinkie.learning.submit', params => store.submit(String(params.sessionKey || ''), params));
  register(api, 'pinkie.learning.notes.list', params => {
    store.assertLearningSession(String(params.sessionKey || ''));
    return store.listNotes(params);
  });
  register(api, 'pinkie.learning.notes.save', params => store.saveNote(String(params.sessionKey || ''), params));
  register(api, 'pinkie.learning.notes.delete', params => store.deleteNote(String(params.sessionKey || ''), params.id));
}

export function learningPrompt(store, sessionKey) {
  if (!isLearningSession(sessionKey)) return '';
  let state;
  try { state = store.status(sessionKey); } catch { return ''; }
  if (!state.enabled) return '';
  return `
【原生互动学习已开启】
- 普通学习聊天仍照常回答；不要为了互动而打断先生当前问题。
- 当适合练习、先生请求出题，或收到 [[CLEKK_LEARNING_START_V1]] / [[CLEKK_LEARNING_NEXT_V1]] 时，调用 learning_activity 的 present 展示一张题卡。不要用 Markdown、HTML 或 JSON 假装题卡。
- 每次只保留一张当前题。present 必须给出明确题干；选择题给 2~8 个选项；correct_answer 只进入本机私有状态，不会显示在前端。
- 收到 [[CLEKK_LEARNING_ANSWER_V1]] 时，根据答案与上下文调用 learning_activity resolve，给出简短口语化 feedback、explanation 和可独立保存的 key_point；不能只在聊天里点评而不结算题卡。
- short_answer 需要你判断正误；其他题型服务端可能已做确定性校验，但你仍要解释关键原因。
- 结算后可依据表现正常聊天，或在先生明确点“下一题”后再 present 新题；不要自动连发多题。
`.trim();
}

// Ported for the C.le. native host.
/* laolao-workbench-code:v1 —— 工作台的「写代码」能力
 *  · 语言服务器客户端：Python(Pyright) / Go(gopls) / Rust(rust-analyzer) / C·C++(clangd) / Swift(SourceKit) / Shell
 *    补全、悬停文档、参数提示、跳到定义、查找引用、重命名、格式化、大纲、实时报错
 *    （JS/TS/JSON/CSS/HTML 用 Monaco 自带的语言服务）
 *  · AI 行内补全（灰色提示，Tab 接受）和 ⌘I 行内修改，用小帮手的快速模型，不占主对话
 *  · ▶ 运行当前文件（F5）：按语言选解释器 / 编译器，在终端里跑；package.json 的脚本可以直接选
 * 由 laolao-workbench.js 在 Monaco 加载后注入。 */
(() => {
  'use strict';
  if (window.__pinkieWorkbenchCode) return;
  const wb = window.__pinkieWorkbench;
  const monaco = window.monaco;
  if (!wb || !monaco) return;
  window.__pinkieWorkbenchCode = true;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const icon = name => { const i = el('i', 'codicon codicon-' + name); i.setAttribute('aria-hidden', 'true'); return i; };
  const store = {get(k, d) { try { const v = localStorage.getItem('pinkie.wb.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('pinkie.wb.' + k, JSON.stringify(v)); } catch {} }};

  /* ═════════════ 语言服务器客户端 ═════════════ */
  const LSP_LANGS = {python: 'python', shell: 'shellscript', go: 'go', rust: 'rust', c: 'c', cpp: 'cpp', 'objective-c': 'objective-c', swift: 'swift',
    yaml: 'yaml', dockerfile: 'dockerfile', php: 'php', lua: 'lua', java: 'java', kotlin: 'kotlin', markdown: 'markdown', sql: 'sql'};
  // 状态栏点「未安装」时，跳到扩展市场里对应的那一项
  const EXT_FOR_LANG = {python: 'Pyright', shell: 'Bash Language Server', go: 'gopls', rust: 'rust-analyzer', yaml: 'YAML', dockerfile: 'Dockerfile', php: 'Intelephense', lua: 'Lua Language Server', java: 'JDT', kotlin: 'Kotlin Language Server', markdown: 'Marksman', sql: 'sqls'};
  const clients = new Map();          // key: root + language → client
  const byId = new Map();             // server id → client
  const docs = new Map();             // monaco model uri → {client, version, uri(file://), timer}
  const K = monaco.languages.CompletionItemKind;
  const LSP_KIND = [null, K.Text, K.Method, K.Function, K.Constructor, K.Field, K.Variable, K.Class, K.Interface, K.Module, K.Property, K.Unit, K.Value, K.Enum, K.Keyword, K.Snippet, K.Color, K.File, K.Reference, K.Folder, K.EnumMember, K.Constant, K.Struct, K.Event, K.Operator, K.TypeParameter];
  const SEVERITY = [null, monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Warning, monaco.MarkerSeverity.Info, monaco.MarkerSeverity.Hint];
  const toRange = r => new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1);
  const toPos = p => ({line: p.lineNumber - 1, character: p.column - 1});
  const fileUri = abs => monaco.Uri.file(abs).toString();
  const markdown = value => {
    if (!value) return undefined;
    if (typeof value === 'string') return {value};
    if (Array.isArray(value)) return {value: value.map(v => typeof v === 'string' ? v : '```' + (v.language || '') + '\n' + v.value + '\n```').join('\n\n')};
    if (value.kind) return {value: value.kind === 'markdown' ? value.value : value.value.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&')};
    if (value.language) return {value: '```' + value.language + '\n' + value.value + '\n```'};
    return {value: String(value.value || '')};
  };
  // 服务器返回的 file:// 地址 → 工作台里的模型地址（项目内用相对路径，项目外用绝对路径）
  function workbenchPath(uri) {
    const abs = monaco.Uri.parse(uri).fsPath;
    const root = wb.state.root.replace(/\/$/, '');
    return abs.startsWith(root + '/') ? abs.slice(root.length + 1) : abs;
  }
  const modelUri = uri => monaco.Uri.from({scheme: 'pinkie', path: '/' + workbenchPath(uri).replace(/^\/+/, '')});

  class Client {
    constructor(language, root) {
      this.language = language; this.root = root; this.seq = 0; this.pending = new Map(); this.ready = null; this.caps = {}; this.state = 'starting'; this.label = '';
    }
    async start() {
      const result = await wb.rpc('pinkie.lsp.start', {language: this.language}, 20000);
      if (!result.available) { this.state = 'missing'; this.reason = result.reason; this.label = result.label || ''; return false; }
      this.id = result.id; this.label = result.label; byId.set(this.id, this);
      const rootUri = fileUri(this.root);
      const init = await this.request('initialize', {
        processId: null, clientInfo: {name: 'Li An 工作台', version: '1'}, locale: 'zh-cn', rootUri, rootPath: this.root,
        workspaceFolders: [{uri: rootUri, name: this.root.split('/').pop()}],
        capabilities: {
          workspace: {configuration: true, workspaceFolders: true, applyEdit: true, workspaceEdit: {documentChanges: true}, didChangeConfiguration: {dynamicRegistration: true}},
          textDocument: {
            synchronization: {didSave: true, dynamicRegistration: false},
            completion: {completionItem: {snippetSupport: true, documentationFormat: ['markdown', 'plaintext'], insertReplaceSupport: true, labelDetailsSupport: true, resolveSupport: {properties: ['documentation', 'detail']}}, contextSupport: true},
            hover: {contentFormat: ['markdown', 'plaintext']},
            signatureHelp: {signatureInformation: {documentationFormat: ['markdown', 'plaintext'], parameterInformation: {labelOffsetSupport: true}, activeParameterSupport: true}},
            definition: {linkSupport: true}, typeDefinition: {linkSupport: true}, implementation: {linkSupport: true}, references: {}, documentHighlight: {},
            documentSymbol: {hierarchicalDocumentSymbolSupport: true}, formatting: {}, rangeFormatting: {}, rename: {prepareSupport: false},
            publishDiagnostics: {relatedInformation: true, tagSupport: {valueSet: [1, 2]}}, codeAction: {codeActionLiteralSupport: {codeActionKind: {valueSet: ['quickfix', 'refactor', 'source']}}},
          },
          window: {workDoneProgress: true, showMessage: {}},
          general: {positionEncodings: ['utf-16']},
        },
        initializationOptions: {},
      }, 60000);
      this.caps = init?.capabilities || {};
      this.notify('initialized', {});
      this.state = 'ready';
      return true;
    }
    request(method, params, timeout = 15000) {
      const id = ++this.seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' 超时')); }, timeout);
        this.pending.set(id, {resolve, reject, timer});
        wb.rpc('pinkie.lsp.send', {id: this.id, message: {jsonrpc: '2.0', id, method, params}}).catch(error => { clearTimeout(timer); this.pending.delete(id); reject(error); });
      });
    }
    notify(method, params) { return wb.rpc('pinkie.lsp.send', {id: this.id, message: {jsonrpc: '2.0', method, params}}).catch(() => {}); }
    reply(id, result) { return wb.rpc('pinkie.lsp.send', {id: this.id, message: {jsonrpc: '2.0', id, result}}).catch(() => {}); }
    receive(message) {
      if (message.id != null && !message.method) {
        const p = this.pending.get(message.id);
        if (!p) return;
        this.pending.delete(message.id); clearTimeout(p.timer);
        message.error ? p.reject(new Error(message.error.message || 'LSP 错误')) : p.resolve(message.result);
        return;
      }
      const {method, params} = message;
      if (message.id != null) {          // 服务器发来的请求
        if (method === 'workspace/configuration') return this.reply(message.id, (params?.items || []).map(() => null));
        if (method === 'workspace/workspaceFolders') return this.reply(message.id, [{uri: fileUri(this.root), name: this.root.split('/').pop()}]);
        if (method === 'workspace/applyEdit') { applyWorkspaceEdit(params.edit); return this.reply(message.id, {applied: true}); }
        return this.reply(message.id, null);
      }
      if (method === 'textDocument/publishDiagnostics') return publish(params);
      if (method === '$/progress') { const v = params?.value; if (v?.kind === 'begin') this.progress = v.title || '分析中'; if (v?.kind === 'end') this.progress = ''; wb.renderStatus(); return; }
      if (method === 'window/showMessage' && params?.type === 1) wb.toast(this.label + '：' + params.message);
    }
  }
  window.addEventListener('pinkie:gateway-event', event => {
    const d = event.detail;
    if (d?.event !== 'plugin.pinkie.lsp.message') return;
    const client = byId.get(d.payload?.id);
    if (!client) return;
    if (d.payload.exited) {
      client.state = 'stopped'; byId.delete(client.id); clients.delete(client.root + '\0' + client.language);
      for (const [uri, doc] of docs) if (doc.client === client) docs.delete(uri);
      wb.renderStatus();
      return;
    }
    if (d.payload.message) client.receive(d.payload.message);
  });

  async function clientFor(language) {
    const lsp = LSP_LANGS[language];
    if (!lsp || !wb.state.root) return null;
    const key = wb.state.root + '\0' + lsp;
    let client = clients.get(key);
    if (!client) {
      client = new Client(lsp, wb.state.root);
      clients.set(key, client);
      client.ready = client.start().catch(error => { client.state = 'error'; client.reason = error.message; return false; }).finally(() => wb.renderStatus());
      wb.renderStatus();
    }
    return (await client.ready) ? client : null;
  }
  function publish(params) {
    const path = workbenchPath(params.uri);
    const model = monaco.editor.getModel(monaco.Uri.from({scheme: 'pinkie', path: '/' + path.replace(/^\/+/, '')}));
    if (!model) return;
    monaco.editor.setModelMarkers(model, 'lsp', (params.diagnostics || []).map(d => ({
      severity: SEVERITY[d.severity || 1] || monaco.MarkerSeverity.Error, message: d.message, source: d.source,
      code: typeof d.code === 'object' ? String(d.code?.value ?? '') : d.code != null ? String(d.code) : undefined,
      startLineNumber: d.range.start.line + 1, startColumn: d.range.start.character + 1, endLineNumber: d.range.end.line + 1, endColumn: d.range.end.character + 1,
      tags: (d.tags || []).map(t => t === 1 ? monaco.MarkerTag.Unnecessary : monaco.MarkerTag.Deprecated),
    })));
  }
  function applyWorkspaceEdit(edit) {
    const groups = new Map();
    const push = (uri, edits) => { const m = monaco.editor.getModel(modelUri(uri)); if (!m) return false; groups.set(m, [...(groups.get(m) || []), ...edits]); return true; };
    let skipped = 0;
    for (const [uri, edits] of Object.entries(edit?.changes || {})) if (!push(uri, edits)) skipped++;
    for (const change of edit?.documentChanges || []) if (change.textDocument && !push(change.textDocument.uri, change.edits)) skipped++;
    for (const [model, edits] of groups) model.pushEditOperations([], edits.map(e => ({range: toRange(e.range), text: e.newText})), () => null);
    if (skipped) wb.toast('还有 ' + skipped + ' 个没打开的文件需要同样修改，打开后再执行一次即可。');
  }

  // 打开 / 修改 / 保存 / 关闭 → 同步给语言服务器
  window.addEventListener('pinkie:wb-model', async event => {
    const {type, model, absolute} = event.detail;
    if (!model || model.isDisposed?.() && type !== 'close') return;
    const key = model.uri.toString();
    if (type === 'close') { const doc = docs.get(key); if (doc) { docs.delete(key); doc.client.notify('textDocument/didClose', {textDocument: {uri: doc.uri}}); } return; }
    if (type === 'save') { const doc = docs.get(key); if (doc) doc.client.notify('textDocument/didSave', {textDocument: {uri: doc.uri}, text: model.getValue()}); return; }
    const client = await clientFor(model.getLanguageId());
    if (!client || model.isDisposed()) return;
    const doc = {client, version: 1, uri: fileUri(absolute)};
    docs.set(key, doc);
    client.notify('textDocument/didOpen', {textDocument: {uri: doc.uri, languageId: client.language, version: 1, text: model.getValue()}});
    model.onDidChangeContent(() => {
      clearTimeout(doc.timer);
      doc.timer = setTimeout(() => { if (docs.get(key) !== doc || model.isDisposed()) return; doc.version++; client.notify('textDocument/didChange', {textDocument: {uri: doc.uri, version: doc.version}, contentChanges: [{text: model.getValue()}]}); }, 160);
    });
    model.onWillDispose?.(() => monaco.editor.setModelMarkers(model, 'lsp', []));
  });
  // 请求前把还没发出的修改先同步过去
  function flush(model) {
    const doc = docs.get(model.uri.toString());
    if (!doc) return null;
    if (doc.timer) { clearTimeout(doc.timer); doc.timer = 0; doc.version++; doc.client.notify('textDocument/didChange', {textDocument: {uri: doc.uri, version: doc.version}, contentChanges: [{text: model.getValue()}]}); }
    return doc;
  }

  const registered = new Set();
  function registerProviders(language) {
    if (registered.has(language) || !LSP_LANGS[language]) return;
    registered.add(language);
    const docFor = model => flush(model);
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['.', ':', '>', '"', "'", '/', '@', '<', '(', ',', ' ', '$', '-', '#'],
      async provideCompletionItems(model, position, context) {
        const doc = docFor(model); if (!doc) return {suggestions: []};
        const trig = doc.client.caps.completionProvider?.triggerCharacters || [];
        if (context.triggerKind === 1 && context.triggerCharacter && !trig.includes(context.triggerCharacter)) return {suggestions: []};
        let result;
        try { result = await doc.client.request('textDocument/completion', {textDocument: {uri: doc.uri}, position: toPos(position), context: {triggerKind: context.triggerKind === 1 ? 2 : context.triggerKind === 2 ? 3 : 1, triggerCharacter: context.triggerCharacter}}); } catch { return {suggestions: []}; }
        const items = Array.isArray(result) ? result : result?.items || [];
        const word = model.getWordUntilPosition(position);
        const fallback = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        return {
          incomplete: !!result?.isIncomplete,
          suggestions: items.slice(0, 400).map(item => {
            const edit = item.textEdit;
            const range = edit ? (edit.range ? toRange(edit.range) : {insert: toRange(edit.insert), replace: toRange(edit.replace)}) : fallback;
            return {
              label: item.labelDetails ? {label: item.label, detail: item.labelDetails.detail, description: item.labelDetails.description} : item.label,
              kind: LSP_KIND[item.kind] ?? K.Text, detail: item.detail, documentation: markdown(item.documentation),
              insertText: edit?.newText ?? item.insertText ?? item.label,
              insertTextRules: (item.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : 0),
              range, sortText: item.sortText, filterText: item.filterText, preselect: item.preselect,
              additionalTextEdits: (item.additionalTextEdits || []).map(e => ({range: toRange(e.range), text: e.newText})),
              commitCharacters: item.commitCharacters, tags: item.deprecated || item.tags?.includes(1) ? [1] : undefined,
              _lsp: item, _client: doc.client,
            };
          }),
        };
      },
      async resolveCompletionItem(item) {
        if (!item._client?.caps.completionProvider?.resolveProvider || item.documentation) return item;
        try { const r = await item._client.request('completionItem/resolve', item._lsp, 4000); item.documentation = markdown(r.documentation); item.detail = r.detail || item.detail; } catch {}
        return item;
      },
    });
    monaco.languages.registerHoverProvider(language, {
      async provideHover(model, position) {
        const doc = docFor(model); if (!doc) return null;
        try {
          const r = await doc.client.request('textDocument/hover', {textDocument: {uri: doc.uri}, position: toPos(position)});
          if (!r?.contents) return null;
          const m = markdown(r.contents);
          return m?.value ? {contents: [m], range: r.range ? toRange(r.range) : undefined} : null;
        } catch { return null; }
      },
    });
    monaco.languages.registerSignatureHelpProvider(language, {
      signatureHelpTriggerCharacters: ['(', ','], signatureHelpRetriggerCharacters: [')'],
      async provideSignatureHelp(model, position) {
        const doc = docFor(model); if (!doc) return null;
        try {
          const r = await doc.client.request('textDocument/signatureHelp', {textDocument: {uri: doc.uri}, position: toPos(position)});
          if (!r?.signatures?.length) return null;
          return {value: {activeSignature: r.activeSignature || 0, activeParameter: r.activeParameter || 0, signatures: r.signatures.map(s => ({label: s.label, documentation: markdown(s.documentation), parameters: (s.parameters || []).map(p => ({label: p.label, documentation: markdown(p.documentation)})), activeParameter: s.activeParameter}))}, dispose() {}};
        } catch { return null; }
      },
    });
    const locations = r => (Array.isArray(r) ? r : r ? [r] : []).map(l => l.targetUri ? {uri: modelUri(l.targetUri), range: toRange(l.targetSelectionRange || l.targetRange), _file: l.targetUri} : {uri: modelUri(l.uri), range: toRange(l.range), _file: l.uri});
    const nav = method => async (model, position) => {
      const doc = docFor(model); if (!doc) return null;
      try { return locations(await doc.client.request(method, {textDocument: {uri: doc.uri}, position: toPos(position)})); } catch { return null; }
    };
    monaco.languages.registerDefinitionProvider(language, {provideDefinition: nav('textDocument/definition')});
    monaco.languages.registerTypeDefinitionProvider(language, {provideTypeDefinition: nav('textDocument/typeDefinition')});
    monaco.languages.registerImplementationProvider(language, {provideImplementation: nav('textDocument/implementation')});
    monaco.languages.registerReferenceProvider(language, {
      async provideReferences(model, position, context) {
        const doc = docFor(model); if (!doc) return null;
        try { return locations(await doc.client.request('textDocument/references', {textDocument: {uri: doc.uri}, position: toPos(position), context: {includeDeclaration: context.includeDeclaration}})); } catch { return null; }
      },
    });
    monaco.languages.registerDocumentHighlightProvider(language, {
      async provideDocumentHighlights(model, position) {
        const doc = docFor(model); if (!doc || !doc.client.caps.documentHighlightProvider) return null;
        try { return (await doc.client.request('textDocument/documentHighlight', {textDocument: {uri: doc.uri}, position: toPos(position)}) || []).map(h => ({range: toRange(h.range), kind: (h.kind || 1) - 1})); } catch { return null; }
      },
    });
    monaco.languages.registerDocumentSymbolProvider(language, {
      async provideDocumentSymbols(model) {
        const doc = docFor(model); if (!doc) return [];
        try {
          const r = await doc.client.request('textDocument/documentSymbol', {textDocument: {uri: doc.uri}});
          const conv = s => s.location
            ? {name: s.name, detail: s.containerName || '', kind: (s.kind || 1) - 1, tags: [], range: toRange(s.location.range), selectionRange: toRange(s.location.range), children: []}
            : {name: s.name, detail: s.detail || '', kind: (s.kind || 1) - 1, tags: [], range: toRange(s.range), selectionRange: toRange(s.selectionRange || s.range), children: (s.children || []).map(conv)};
          return (r || []).map(conv);
        } catch { return []; }
      },
    });
    monaco.languages.registerDocumentFormattingEditProvider(language, {
      async provideDocumentFormattingEdits(model, options) {
        const doc = docFor(model); if (!doc || !doc.client.caps.documentFormattingProvider) return [];
        try { return (await doc.client.request('textDocument/formatting', {textDocument: {uri: doc.uri}, options: {tabSize: options.tabSize, insertSpaces: options.insertSpaces}}, 20000) || []).map(e => ({range: toRange(e.range), text: e.newText})); } catch (error) { wb.toast('格式化失败：' + error.message); return []; }
      },
    });
    monaco.languages.registerRenameProvider(language, {
      async provideRenameEdits(model, position, newName) {
        const doc = docFor(model); if (!doc) return null;
        const r = await doc.client.request('textDocument/rename', {textDocument: {uri: doc.uri}, position: toPos(position), newName}, 20000);
        const edits = [];
        for (const [uri, list] of Object.entries(r?.changes || {})) for (const e of list) edits.push({resource: modelUri(uri), textEdit: {range: toRange(e.range), text: e.newText}, versionId: undefined});
        for (const c of r?.documentChanges || []) if (c.textDocument) for (const e of c.edits) edits.push({resource: modelUri(c.textDocument.uri), textEdit: {range: toRange(e.range), text: e.newText}, versionId: undefined});
        const missing = new Set(edits.filter(e => !monaco.editor.getModel(e.resource)).map(e => e.resource.path));
        if (missing.size) wb.toast('重命名还涉及 ' + missing.size + ' 个没打开的文件：' + [...missing].slice(0, 3).map(p => p.split('/').pop()).join('、') + '，打开后再重命名一次。');
        return {edits: edits.filter(e => monaco.editor.getModel(e.resource))};
      },
    });
    monaco.languages.registerCodeActionProvider(language, {
      async provideCodeActions(model, range, context) {
        const doc = docFor(model); if (!doc || !doc.client.caps.codeActionProvider) return {actions: [], dispose() {}};
        try {
          const diagnostics = context.markers.filter(m => m.owner === 'lsp').map(m => ({range: {start: {line: m.startLineNumber - 1, character: m.startColumn - 1}, end: {line: m.endLineNumber - 1, character: m.endColumn - 1}}, message: m.message, severity: m.severity === 8 ? 1 : m.severity === 4 ? 2 : 3, source: m.source, code: m.code}));
          const r = await doc.client.request('textDocument/codeAction', {textDocument: {uri: doc.uri}, range: {start: toPos({lineNumber: range.startLineNumber, column: range.startColumn}), end: toPos({lineNumber: range.endLineNumber, column: range.endColumn})}, context: {diagnostics}});
          const actions = (r || []).filter(a => a.edit).map(a => ({title: a.title, kind: a.kind, isPreferred: a.isPreferred, edit: {edits: [
            ...Object.entries(a.edit.changes || {}).flatMap(([uri, list]) => list.map(e => ({resource: modelUri(uri), textEdit: {range: toRange(e.range), text: e.newText}, versionId: undefined}))),
            ...(a.edit.documentChanges || []).filter(c => c.textDocument).flatMap(c => c.edits.map(e => ({resource: modelUri(c.textDocument.uri), textEdit: {range: toRange(e.range), text: e.newText}, versionId: undefined}))),
          ]}}));
          return {actions, dispose() {}};
        } catch { return {actions: [], dispose() {}}; }
      },
    });
  }
  Object.keys(LSP_LANGS).forEach(registerProviders);
  // 跳到定义落在别的文件时，用工作台打开
  monaco.editor.registerEditorOpener?.({
    openCodeEditor(source, resource, selectionOrPosition) {
      if (resource.scheme !== 'pinkie') return false;
      const path = decodeURIComponent(resource.path.replace(/^\//, ''));
      const sel = selectionOrPosition;
      const line = sel ? (sel.startLineNumber || sel.lineNumber) : undefined;
      const column = sel ? (sel.startColumn || sel.column) : undefined;
      void wb.openFile(path, {pinned: true, line, column});
      return true;
    },
  });

  // 状态栏：当前文件的语言服务状态，点击重启
  wb.extraStatus.set('lsp', tab => {
    const lang = tab?.model?.getLanguageId?.();
    const lsp = LSP_LANGS[lang];
    if (!lsp) return null;
    const client = clients.get(wb.state.root + '\0' + lsp);
    const b = el('button', 'pk-wb-status__item'); b.type = 'button';
    const busy = !client || client.state === 'starting' || client.progress;
    b.append(icon(client?.state === 'ready' ? (client.progress ? 'sync' : 'check-all') : client?.state === 'missing' || client?.state === 'error' ? 'warning' : 'sync'));
    if (busy) b.firstChild.classList.add('codicon-modifier-spin');
    b.append(el('span', '', (client?.label || lsp) + (client?.progress ? ' · ' + client.progress : client?.state === 'missing' ? ' 未安装' : client?.state === 'error' ? ' 启动失败' : client?.state === 'stopped' ? ' 已停止' : '')));
    b.title = client?.state === 'missing' ? (client.reason || '') + ' 点击去扩展市场安装' : client?.reason || '语言服务：补全、跳转、报错。点击重启';
    b.addEventListener('click', async () => {
      if (client?.state === 'missing') { wb.showExtension(EXT_FOR_LANG[lang] || lang); return; }
      if (client?.id) await wb.rpc('pinkie.lsp.stop', {id: client.id}).catch(() => {});
      clients.delete(wb.state.root + '\0' + lsp);
      for (const [uri, doc] of docs) if (doc.client === client) docs.delete(uri);
      for (const t of wb.state.tabs) if (t.model && LSP_LANGS[t.model.getLanguageId()] === lsp) window.dispatchEvent(new CustomEvent('pinkie:wb-model', {detail: {type: 'open', path: t.path, model: t.model, absolute: wb.absolute(t.path)}}));
    });
    return b;
  });
  // 已经打开的文件（代码模块加载前打开的）补发一次
  for (const t of wb.state.tabs) if (t.model) window.dispatchEvent(new CustomEvent('pinkie:wb-model', {detail: {type: 'open', path: t.path, model: t.model, absolute: wb.absolute(t.path)}}));

  // 扩展市场装好 / 卸载后：之前「未安装」的语言服务重新连，格式化器重新登记
  function reconnect(onlyMissing) {
    for (const [key, client] of [...clients]) {
      if (onlyMissing && !['missing', 'error', 'stopped'].includes(client.state)) continue;
      if (client.id) wb.rpc('pinkie.lsp.stop', {id: client.id}).catch(() => {});
      clients.delete(key);
      for (const [uri, doc] of docs) if (doc.client === client) docs.delete(uri);
    }
    for (const t of wb.state.tabs) if (t.model && LSP_LANGS[t.model.getLanguageId()] && !docs.has(t.model.uri.toString())) window.dispatchEvent(new CustomEvent('pinkie:wb-model', {detail: {type: 'open', path: t.path, model: t.model, absolute: wb.absolute(t.path)}}));
    wb.renderStatus();
  }
  window.addEventListener('pinkie:wb-ext-changed', () => { reconnect(true); void refreshFormatters(); });

  /* ═════════════ 格式化（扩展市场装的格式化器：Prettier / Ruff / gofmt / rustfmt / clang-format / swift-format / shfmt / StyLua / Taplo） ═════════════ */
  const formatProviders = new Map();
  let formatOnSave = store.get('formatOnSave', false);
  async function formatModel(model) {
    const r = await wb.rpc('pinkie.fs.format', {path: decodeURIComponent(model.uri.path.slice(1)), language: model.getLanguageId(), content: model.getValue()}, 25000);
    return r.unavailable ? null : r;
  }
  async function refreshFormatters() {
    let map = {};
    try { map = (await wb.rpc('pinkie.ext.formatters', {}, 10000)).formatters || {}; } catch { return; }
    for (const [lang, disposable] of formatProviders) if (!map[lang]) { disposable.dispose(); formatProviders.delete(lang); }
    for (const [lang, name] of Object.entries(map)) {
      if (formatProviders.has(lang)) continue;
      formatProviders.set(lang, monaco.languages.registerDocumentFormattingEditProvider(lang, {
        displayName: name,
        async provideDocumentFormattingEdits(model) {
          try {
            const r = await formatModel(model);
            if (!r || r.text === model.getValue()) return [];
            return [{range: model.getFullModelRange(), text: r.text}];
          } catch (error) { wb.toast(error.message); return []; }
        },
      }));
    }
    wb.formatters = map;
  }
  void refreshFormatters();
  wb.beforeSave = async tab => {
    if (!formatOnSave || !tab.model || !wb.formatters?.[tab.model.getLanguageId()]) return;
    try {
      const r = await formatModel(tab.model);
      if (r && r.text !== tab.model.getValue()) {
        const editor = wb.editor;
        const view = editor?.getModel() === tab.model ? editor.saveViewState() : null;
        tab.model.pushEditOperations([], [{range: tab.model.getFullModelRange(), text: r.text}], () => null);
        if (view) editor.restoreViewState(view);
      }
    } catch (error) { wb.toast(error.message); }
  };
  wb.toggleFormatOnSave = () => { formatOnSave = !formatOnSave; store.set('formatOnSave', formatOnSave); wb.toast(formatOnSave ? '保存时自动格式化：开' : '保存时自动格式化：关'); };

  /* ═════════════ AI 行内补全 ═════════════ */
  let aiOn = store.get('aiComplete', true);
  let aiSeq = 0, aiBusy = 0, lastAi = '';
  monaco.languages.registerInlineCompletionsProvider('*', {
    async provideInlineCompletions(model, position, context, token) {
      if (!aiOn || model.uri.scheme !== 'pinkie') return {items: []};
      const seq = ++aiSeq;
      // 自动触发时等一下：连续打字不发请求
      if (context.triggerKind === 0) { await new Promise(r => setTimeout(r, 700)); if (token.isCancellationRequested || seq !== aiSeq) return {items: []}; }
      const line = model.getLineContent(position.lineNumber);
      const after = line.slice(position.column - 1);
      if (after.trim() && !/^[)\]}'"`;,\s]*$/.test(after)) return {items: []};
      const full = model.getFullModelRange();
      const prefix = model.getValueInRange({startLineNumber: Math.max(1, position.lineNumber - 120), startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column});
      const suffix = model.getValueInRange({startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: Math.min(full.endLineNumber, position.lineNumber + 40), endColumn: 10000});
      aiBusy++; wb.renderStatus();
      try {
        const r = await wb.rpc('pinkie.ai.complete', {path: decodeURIComponent(model.uri.path.slice(1)), language: model.getLanguageId(), prefix, suffix}, 12000);
        lastAi = (r.model || '').split('/').pop() + (r.fallback ? '（前面的模型没回应，已自动换）' : '');
        if (token.isCancellationRequested || !r?.text?.trim()) return {items: []};
        return {items: [{insertText: r.text, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column)}]};
      } catch { return {items: []}; }
      finally { aiBusy--; wb.renderStatus(); }
    },
    freeInlineCompletions() {}, disposeInlineCompletions() {},
  });
  wb.extraStatus.set('ai', () => {
    const b = el('button', 'pk-wb-status__item' + (aiOn ? ' is-on' : '')); b.type = 'button';
    b.append(icon(aiOn ? (aiBusy ? 'loading' : 'sparkle') : 'circle-slash'), el('span', '', aiOn ? (aiBusy ? 'AI 正在想…' : 'AI 补全') : 'AI 补全已关'));
    if (aiBusy) b.firstChild.classList.add('codicon-modifier-spin');
    b.title = (aiOn ? 'AI 行内补全已开（Tab 接受，Esc 忽略）' : 'AI 行内补全已关') + (lastAi ? '\n上一次：' + lastAi : '') + '\n点击：开关 / 模型路由';
    b.addEventListener('click', e => {
      const r = b.getBoundingClientRect();
      wb.showMenu([
        {label: aiOn ? '关闭 AI 行内补全' : '打开 AI 行内补全', icon: aiOn ? 'circle-slash' : 'sparkle', run: () => { aiOn = !aiOn; store.set('aiComplete', aiOn); wb.renderStatus(); }},
        {label: 'AI 模型路由…', icon: 'type-hierarchy', run: openRoutePage},
        {label: '让 AI 补全这里', icon: 'lightbulb-sparkle', key: '⌥\\', run: () => wb.editor?.trigger('pinkie', 'editor.action.inlineSuggest.trigger', {})},
      ], r.left, r.top - 110);
      e.stopPropagation();
    });
    return b;
  });

  /* ═════════════ AI 模型路由页 ═════════════ */
  // 补全 / 报错提示是本机语言服务做的，不靠模型；这一页只管 AI 行内补全和 ⌘I 行内修改用哪些模型、按什么顺序兜底
  let routeData = null, routeBusy = '';
  async function openRoutePage() {
    await wb.openPage('ai-route', 'AI 模型路由', 'type-hierarchy', renderRoute);
    try { routeData = await wb.rpc('pinkie.ai.route.get', {}, 20000); } catch (error) { routeData = {error: error.message}; }
    wb.refreshPage('ai-route');
  }
  async function routeCall(method, params, busy) {
    routeBusy = busy || ''; wb.refreshPage('ai-route');
    try { routeData = await wb.rpc(method, params, method.endsWith('test') ? 90000 : 20000); }
    catch (error) { wb.toast(error.message); }
    routeBusy = ''; wb.refreshPage('ai-route');
  }
  const secs = ms => ms ? (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' 秒' : '—';
  function renderRoute(box) {
    const page = el('div', 'pk-wb-page');
    page.append(el('h1', 'pk-wb-page__title', 'AI 模型路由'));
    page.append(el('p', 'pk-wb-page__lead', '补全、跳转和报错提示由本机的语言服务完成，不依赖任何模型，模型都挂了也照常工作。这里只管 AI 行内补全（灰色提示）和 ⌘I 行内修改：按顺序试，失败或超时自动换下一个，失败的模型先冷却 5 分钟，连续失败冷却更久。'));
    if (!routeData) { page.append(el('div', 'pk-wb-progress')); box.append(page); return; }
    if (routeData.error) { page.append(el('p', 'pk-wb-msg pk-wb-msg--error', routeData.error)); box.append(page); return; }
    const testMap = new Map((routeData.test || []).map(t => [t.model, t]));
    for (const [task, info] of Object.entries(routeData.tasks)) {
      const card = el('section', 'pk-wb-route');
      const head = el('header', 'pk-wb-route__head');
      head.append(el('h2', '', info.label), el('span', 'pk-wb-route__tag', info.custom ? '自定义' : '默认'));
      const acts = el('div', 'pk-wb-route__acts');
      const test = el('button', 'pk-wb-btn', routeBusy === 'test:' + task ? '测速中…' : '全部测速'); test.type = 'button'; test.disabled = !!routeBusy;
      test.addEventListener('click', () => routeCall('pinkie.ai.route.test', {task}, 'test:' + task));
      acts.append(test);
      const auto = el('button', 'pk-wb-btn', '按测速自动排序'); auto.type = 'button'; auto.disabled = !!routeBusy;
      auto.title = task === 'edit' ? '先看能力档次（强模型优先），再看速度' : '越快越靠前';
      auto.addEventListener('click', () => routeCall('pinkie.ai.route.auto', {task}));
      acts.append(auto);
      if (info.custom) { const reset = el('button', 'pk-wb-btn', '恢复默认'); reset.type = 'button'; reset.addEventListener('click', () => routeCall('pinkie.ai.route.set', {task, models: null})); acts.append(reset); }
      head.append(acts);
      card.append(head);
      const list = el('ol', 'pk-wb-route__list');
      const models = info.models;
      const save = next => routeCall('pinkie.ai.route.set', {task, models: next});
      models.forEach((model, i) => {
        const st = routeData.stats[model] || {};
        const t = testMap.get(model);
        const li = el('li', 'pk-wb-route__row' + (st.cooling ? ' is-cooling' : ''));
        li.append(el('span', 'pk-wb-route__n', String(i + 1)));
        const main = el('div', 'pk-wb-route__main');
        const name = el('div', 'pk-wb-route__name', model.split('/').pop());
        if (model === routeData.companion) name.append(el('span', 'pk-wb-route__chip', '小帮手模型'));
        if (i === 0) name.append(el('span', 'pk-wb-route__chip is-first', '首选'));
        main.append(name);
        const facts = [];
        if (t) facts.push(t.ok ? '测速 ' + secs(t.ms) : '测速失败：' + t.error);
        if (st.ok || st.fail) facts.push('平均 ' + secs(st.avgMs) + ' · 成功 ' + st.ok + ' · 失败 ' + st.fail);
        if (st.cooling) facts.push('冷却中，' + Math.ceil(st.cooling / 60) + ' 分钟后再试');
        else if (st.lastError) facts.push('上次失败：' + st.lastError.slice(0, 40));
        main.append(el('div', 'pk-wb-route__facts', facts.join('　') || model));
        const health = el('span', 'pk-wb-route__dot ' + (st.cooling ? 'is-bad' : t ? (t.ok ? 'is-good' : 'is-bad') : st.ok ? 'is-good' : st.fail ? 'is-warn' : ''));
        const ctl = el('div', 'pk-wb-route__ctl');
        const mk = (ic, title, fn, disabled) => { const b = el('button', 'pk-wb-icon'); b.type = 'button'; b.title = title; b.append(icon(ic)); b.disabled = disabled; b.addEventListener('click', fn); return b; };
        ctl.append(mk('arrow-up', '提前', () => { const n = [...models]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; save(n); }, i === 0),
          mk('arrow-down', '靠后', () => { const n = [...models]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; save(n); }, i === models.length - 1),
          mk('close', '从路由里移除', () => save(models.filter(m => m !== model)), models.length <= 1));
        li.append(health, main, ctl);
        list.append(li);
      });
      card.append(list);
      const add = el('div', 'pk-wb-route__add');
      const select = el('select', 'pk-wb-input');
      select.append(Object.assign(el('option', '', '添加模型…'), {value: ''}));
      for (const m of routeData.catalog.filter(m => !models.includes(m.id))) select.append(Object.assign(el('option', '', m.name && m.name !== m.id ? m.name + '（' + m.id + '）' : m.id), {value: m.id}));
      select.addEventListener('change', () => { if (select.value) save([...models, select.value]); });
      add.append(icon('add'), select);
      card.append(add);
      page.append(card);
    }
    page.append(renderAllModels());
    page.append(el('p', 'pk-wb-page__foot', '设置保存在 ~/Library/Application Support/SuperPinkie/workbench-ai-route.json。模型列表来自网关的模型配置；加新模型后在这里就能选。'));
    box.append(page);
  }
  wb.openRoutePage = openRoutePage;
  // 全部上游模型：扫描测速、看成绩、一键加入路由。路由里的模型都失败时，也会从这里健康的模型里自动补位
  let modelFilter = '', scanLive = null;
  const TIER = ['轻量', '标准', '较强', '最强'];
  function renderAllModels() {
    const card = el('section', 'pk-wb-route pk-wb-route--all');
    const head = el('header', 'pk-wb-route__head');
    const text = routeData.catalog.filter(m => m.text);
    const tested = text.filter(m => routeData.stats[m.id]);
    head.append(el('h2', '', '全部上游模型'), el('span', 'pk-wb-route__tag', text.length + ' 个文字模型 · 已测 ' + tested.length));
    const acts = el('div', 'pk-wb-route__acts');
    const scan = routeData.scan?.running || scanLive?.running;
    const btn = el('button', 'pk-wb-btn pk-wb-btn--accent', scan ? '扫描中…' : '扫描全部模型'); btn.type = 'button'; btn.disabled = !!scan;
    btn.title = '每个模型问一句最短的代码补全，记录耗时和能不能用（6 个并发，大约一两分钟）';
    btn.addEventListener('click', async () => { try { scanLive = {running: true, done: 0, total: text.length, ok: 0}; wb.refreshPage('ai-route'); await wb.rpc('pinkie.ai.route.scan', {}, 20000); } catch (error) { scanLive = null; wb.toast(error.message); wb.refreshPage('ai-route'); } });
    acts.append(btn);
    head.append(acts);
    card.append(head);
    const live = scanLive || routeData.scan;
    if (live?.running) {
      const bar = el('div', 'pk-wb-scanbar'); const fill = el('i'); fill.style.width = Math.round(100 * (live.done || 0) / Math.max(1, live.total || 1)) + '%'; bar.append(fill);
      card.append(bar, el('p', 'pk-wb-msg', '已测 ' + (live.done || 0) + ' / ' + (live.total || 0) + '，可用 ' + (live.ok || 0)));
    }
    card.append(el('p', 'pk-wb-msg', '路由里的模型全都失败时，会从下面「可用」的模型里自动挑最多 3 个补位（补全挑最快的，行内修改挑最强的）。'));
    const filter = el('div', 'pk-wb-field pk-wb-route__filter');
    const q = el('input'); q.placeholder = '筛选模型（名字里的字）'; q.value = modelFilter; q.spellcheck = false;
    q.addEventListener('input', () => { modelFilter = q.value; const list = card.querySelector('.pk-wb-models'); list.replaceWith(modelTable(text)); });
    filter.append(icon('filter'), q);
    card.append(filter, modelTable(text));
    return card;
  }
  function modelTable(text) {
    const list = el('div', 'pk-wb-models');
    const f = modelFilter.trim().toLowerCase();
    const rows = text.filter(m => !f || (m.id + ' ' + m.name).toLowerCase().includes(f)).map(m => ({m, st: routeData.stats[m.id]}))
      .sort((a, b) => (b.st?.ok > 0 && !b.st?.cooling ? 1 : 0) - (a.st?.ok > 0 && !a.st?.cooling ? 1 : 0) || (a.st?.avgMs || 9e9) - (b.st?.avgMs || 9e9) || a.m.id.localeCompare(b.m.id));
    for (const {m, st} of rows) {
      const row = el('div', 'pk-wb-model');
      const good = st && st.ok > 0 && !st.cooling && !(st.streak > 0);
      row.append(el('span', 'pk-wb-route__dot ' + (!st ? '' : good ? 'is-good' : st.cooling || st.streak ? 'is-bad' : 'is-warn')));
      const main = el('div', 'pk-wb-route__main');
      const name = el('div', 'pk-wb-route__name', m.id.split('/').pop());
      name.append(el('span', 'pk-wb-route__chip', TIER[m.tier] || '标准'));
      main.append(name, el('div', 'pk-wb-route__facts', !st ? '还没测过 · ' + m.id : (good ? '可用 · ' : st.cooling ? '冷却中 · ' : '不可用 · ') + '平均 ' + secs(st.avgMs) + ' · 成功 ' + st.ok + ' · 失败 ' + st.fail + (st.lastError && !good ? ' · ' + st.lastError.slice(0, 30) : '')));
      const ctl = el('div', 'pk-wb-model__ctl');
      for (const [task, label] of [['complete', '补全'], ['edit', '修改']]) {
        const inRoute = routeData.tasks[task].models.includes(m.id);
        const b = el('button', 'pk-wb-chipbtn' + (inRoute ? ' is-in' : ''), inRoute ? '✓ ' + label : '+ ' + label); b.type = 'button';
        b.title = inRoute ? '已在「' + routeData.tasks[task].label + '」路由里，点击移除' : '加入「' + routeData.tasks[task].label + '」路由末尾';
        b.addEventListener('click', () => { const cur = routeData.tasks[task].models; routeCall('pinkie.ai.route.set', {task, models: inRoute ? cur.filter(x => x !== m.id) : [...cur, m.id]}); });
        ctl.append(b);
      }
      row.append(main, ctl);
      list.append(row);
    }
    if (!rows.length) list.append(el('p', 'pk-wb-msg', '没有匹配的模型。'));
    return list;
  }
  let scanRefresh = 0;
  window.addEventListener('pinkie:gateway-event', event => {
    const d = event.detail;
    if (d?.event !== 'plugin.pinkie.ai.scan') return;
    const p = d.payload || {};
    scanLive = {running: !p.finished, done: p.done, total: p.total, ok: p.ok};
    if (p.model && routeData?.stats && p.result) {
      const st = routeData.stats[p.model] ||= {ok: 0, fail: 0, avgMs: 0};
      if (p.result.ok) { st.ok++; st.avgMs = st.avgMs ? Math.round(st.avgMs * 0.7 + p.result.ms * 0.3) : p.result.ms; st.cooling = 0; st.streak = 0; } else { st.fail++; st.lastError = p.result.error; st.streak = (st.streak || 0) + 1; }
    }
    if (p.finished) { scanLive = null; void wb.rpc('pinkie.ai.route.get', {}, 20000).then(r => { routeData = r; wb.refreshPage('ai-route'); }); wb.toast('扫描完了：' + (p.ok || 0) + ' / ' + (p.total || 0) + ' 个模型可用。可以点「按测速自动排序」'); return; }
    // 进度刷新节流，免得输入框跟着重绘
    if (!scanRefresh) scanRefresh = setTimeout(() => { scanRefresh = 0; if (!document.activeElement?.closest?.('.pk-wb-route__filter')) wb.refreshPage('ai-route'); }, 700);
  });

  /* ═════════════ ⌘I 行内修改 ═════════════ */
  let editWidget = null;
  function inlineEdit() {
    const editor = wb.editor;
    const model = editor?.getModel();
    if (!model) return;
    editWidget?.dispose();
    let sel = editor.getSelection();
    if (sel.isEmpty()) sel = new monaco.Selection(sel.startLineNumber, 1, sel.startLineNumber, model.getLineMaxColumn(sel.startLineNumber));
    const node = el('div', 'pk-wb-iedit');
    const input = el('input', 'pk-wb-iedit__input'); input.placeholder = '告诉 Li An 要怎么改选中的代码…（Enter 修改，Esc 取消）'; input.spellcheck = false;
    const go = el('button', 'pk-wb-iedit__go'); go.type = 'button'; go.append(icon('sparkle'), el('span', '', '修改'));
    node.append(icon('edit'), input, go);
    const widget = {
      getId: () => 'pinkie.inlineEdit', getDomNode: () => node,
      getPosition: () => ({position: {lineNumber: sel.startLineNumber, column: 1}, preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE, monaco.editor.ContentWidgetPositionPreference.BELOW]}),
      dispose() { editor.removeContentWidget(widget); editWidget = null; },
    };
    editWidget = widget;
    editor.addContentWidget(widget);
    const deco = editor.createDecorationsCollection([{range: sel, options: {className: 'pk-wb-iedit-range', isWholeLine: false}}]);
    const close = () => { deco.clear(); widget.dispose(); editor.focus(); };
    const run = async () => {
      const instruction = input.value.trim();
      if (!instruction) return;
      node.classList.add('is-busy'); input.disabled = true; go.disabled = true;
      try {
        const r = await wb.rpc('pinkie.ai.edit', {
          path: decodeURIComponent(model.uri.path.slice(1)), language: model.getLanguageId(), instruction, code: model.getValueInRange(sel),
          before: model.getValueInRange({startLineNumber: Math.max(1, sel.startLineNumber - 40), startColumn: 1, endLineNumber: sel.startLineNumber, endColumn: sel.startColumn}),
          after: model.getValueInRange({startLineNumber: sel.endLineNumber, startColumn: sel.endColumn, endLineNumber: Math.min(model.getLineCount(), sel.endLineNumber + 20), endColumn: 10000}),
        }, 70000);
        close();
        editor.pushUndoStop();
        editor.executeEdits('pinkie.inlineEdit', [{range: sel, text: r.text, forceMoveMarkers: true}]);
        editor.pushUndoStop();
        const lines = r.text.split('\n');
        const end = {lineNumber: sel.startLineNumber + lines.length - 1, column: lines.length > 1 ? lines.at(-1).length + 1 : sel.startColumn + lines[0].length};
        const changed = editor.createDecorationsCollection([{range: new monaco.Range(sel.startLineNumber, 1, end.lineNumber, 1), options: {isWholeLine: true, className: 'pk-wb-iedit-done'}}]);
        setTimeout(() => changed.clear(), 2400);
        wb.toast('Li An 改好了', {label: '撤销', run: () => { editor.focus(); editor.trigger('pinkie', 'undo'); }});
      } catch (error) {
        node.classList.remove('is-busy'); input.disabled = false; go.disabled = false; input.focus();
        wb.toast('行内修改失败：' + error.message);
      }
    };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); run(); } if (e.key === 'Escape') { e.preventDefault(); close(); } });
    go.addEventListener('click', run);
    setTimeout(() => input.focus(), 30);
  }

  /* ═════════════ ▶ 运行 ═════════════ */
  const q = wb.shellQuote;
  let runBusy = false, runPhase = '', closeRunPicker = null;
  const manifestCache = new Map();
  const extensionOf = path => (wb.basename(path).match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
  function runCommand(path, manifest = '') {
    const name = wb.basename(path), dir = wb.dirname(path) || '.', file = q(path);
    const out = q('/tmp/pinkie-run-' + name.replace(/\W/g, '_'));
    switch (extensionOf(path)) {
      // 只选择一次解释器；程序报错后不能换一个解释器重复执行。
      case 'py': return 'if [ -x .venv/bin/python ]; then .venv/bin/python ' + file + '; elif [ -x venv/bin/python ]; then venv/bin/python ' + file + '; else python3 ' + file + '; fi';
      case 'js': case 'mjs': case 'cjs': return 'node ' + file;
      case 'ts': case 'mts': case 'cts': return 'node ' + file;
      case 'tsx': case 'jsx': return 'deno run -A ' + file;
      case 'go': return manifest ? '(cd ' + q(dir) + ' && go run .)' : 'go run ' + file;
      case 'rs': return manifest ? 'cargo run --manifest-path ' + q(manifest) : 'rustc --edition 2021 ' + file + ' -o ' + out + ' && ' + out;
      case 'c': return 'cc -std=c17 -Wall -g ' + file + ' -o ' + out + ' && ' + out;
      case 'cc': case 'cpp': case 'cxx': return 'c++ -std=c++20 -Wall -g ' + file + ' -o ' + out + ' && ' + out;
      case 'm': return 'clang -fobjc-arc -framework Foundation ' + file + ' -o ' + out + ' && ' + out;
      case 'java': return 'java ' + file;
      case 'swift': return 'swift ' + file;
      case 'kt': case 'kts': return 'kotlinc -script ' + file;
      case 'rb': return 'ruby ' + file;
      case 'php': return 'php ' + file;
      case 'pl': return 'perl ' + file;
      case 'lua': return 'lua ' + file;
      case 'sh': case 'bash': return 'bash ' + file;
      case 'zsh': return 'zsh ' + file;
      case 'html': case 'htm': return 'open ' + file;
      default: return '';
    }
  }
  function updateRunButton(button) {
    button.disabled = runBusy;
    button.setAttribute('aria-busy', String(runBusy));
    button.title = runBusy ? runPhase : '运行（F5）';
    button.setAttribute('aria-label', runBusy ? runPhase : '运行');
    button.replaceChildren(icon(runBusy ? 'loading codicon-modifier-spin' : 'play'));
  }
  function setRunBusy(busy, phase = '') {
    runBusy = busy; runPhase = phase;
    // renderTabs 会重建按键；新旧节点都从同一份状态取 busy，而非只锁一次 click 的节点。
    for (const button of document.querySelectorAll('.pk-wb-run')) updateRunButton(button);
    if (phase) wb.statusFlash(phase);
  }
  const runContext = () => ({root: wb.state.root, sessionKey: wb.state.key, active: wb.state.active});
  function assertRunContext(context) {
    if (!context.root) throw new Error('先打开项目文件夹。');
    if (wb.state.root !== context.root || wb.state.key !== context.sessionKey || wb.state.active !== context.active) throw new Error('项目或当前文件已切换，本次运行已取消。');
  }
  function projectRunPath(path, tab, context) {
    if (tab?.readOnly) throw new Error('这是项目外的参考文件，请先保存到当前项目再运行。');
    const base = context.root.replace(/\/$/, '');
    let relative = String(path).replace(/^\.\//, '');
    if (relative.startsWith(base + '/')) relative = relative.slice(base.length + 1);
    if (!relative || relative.startsWith('/') || relative.split('/').some(part => part === '..') || /^[A-Za-z]:[\\/]/.test(relative)) throw new Error('只能运行当前项目里的文件。');
    return relative;
  }
  async function runManifest(path, context) {
    const filename = extensionOf(path) === 'go' ? 'go.mod' : extensionOf(path) === 'rs' ? 'Cargo.toml' : '';
    if (!filename) return ''; // 单文件语言不等待全项目扫描。
    const paths = [];
    for (let dir = wb.dirname(path); ; dir = wb.dirname(dir)) {
      paths.push((dir ? dir + '/' : '') + filename);
      if (!dir) break;
    }
    if (paths.length > 200) throw new Error('文件目录层级过深，请在终端中运行。');
    const prefix = context.sessionKey + '\0' + context.root + '\0';
    const missing = paths.filter(p => {
      const cached = manifestCache.get(prefix + p);
      return !cached || Date.now() - cached.at >= (cached.exists ? 20000 : 3000);
    });
    if (missing.length) {
      assertRunContext(context);
      // 只检查必要的各级清单文件，不枚举目录或扫描 node_modules 等整棵项目树。
      const result = await wb.rpc('pinkie.fs.stat', {paths: missing}, 4000);
      assertRunContext(context);
      if (!Array.isArray(result?.stats) || missing.some(p => !result.stats.some(stat => stat.path === p))) throw new Error('无法检查项目运行配置，请重试。');
      if (manifestCache.size + result.stats.length > 300) manifestCache.clear();
      for (const stat of result.stats) manifestCache.set(prefix + stat.path, {at: Date.now(), exists: stat.exists && stat.kind === 'file'});
    }
    return paths.find(p => manifestCache.get(prefix + p)?.exists) || '';
  }
  window.addEventListener('pinkie:wb-model', event => { if (event.detail?.type === 'save') manifestCache.clear(); });
  async function saveRunFiles(context) {
    assertRunContext(context);
    setRunBusy(true, '正在保存运行文件…');
    await wb.saveAll();
    assertRunContext(context);
    // saveActive 会自行展示冲突/保存失败，dirty 未清除时禁止运行磁盘上的旧版本。
    if (wb.state.tabs.some(tab => tab.dirty && tab.model)) throw new Error('还有文件未保存成功，请处理保存提示后再运行。');
  }
  async function sendRun(command, context) {
    await saveRunFiles(context);
    if (typeof command === 'function') { setRunBusy(true, '正在检查运行配置…'); command = await command(); }
    assertRunContext(context);
    setRunBusy(true, '正在连接终端…');
    wb.togglePanel('terminal', true);
    await wb.terminalType(' cd ' + q(context.root) + ' && ' + command + '\r', {...context, wait: true, timeoutMs: 10000});
    wb.statusFlash('运行命令已发送到终端');
  }
  async function runActive() {
    if (runBusy) return;
    const context = runContext();
    setRunBusy(true, '正在准备运行…');
    try {
      assertRunContext(context);
      const tab = wb.findTab(context.active);
      const rawPath = tab?.kind === 'diff' ? tab.source : tab?.path;
      if (!rawPath) { await pickScript(context); return; }
      const path = projectRunPath(rawPath, tab, context);
      if (wb.basename(path) === 'package.json') { await pickScript(context); return; }
      if (!runCommand(path)) throw new Error('不知道怎么运行「' + wb.basename(path) + '」，可以在终端里自己跑，或者让 Li An 来。');
      await sendRun(async () => runCommand(path, await runManifest(path, context)), context);
    } catch (error) { wb.toast('未运行：' + (error?.message || String(error))); }
    finally { setRunBusy(false); }
  }
  async function runScript(name, context) {
    if (runBusy) return;
    setRunBusy(true, '正在准备运行…');
    try { await sendRun('npm run ' + q(name), context); }
    catch (error) { wb.toast('未运行：' + (error?.message || String(error))); }
    finally { setRunBusy(false); }
  }
  async function pickScript(context) {
    closeRunPicker?.();
    await saveRunFiles(context);
    setRunBusy(true, '正在读取项目脚本…');
    const pkg = await wb.rpc('pinkie.fs.read', {path: 'package.json'}, 4000);
    assertRunContext(context);
    const scripts = JSON.parse(pkg.content).scripts;
    const names = scripts && typeof scripts === 'object' ? Object.keys(scripts).filter(name => typeof scripts[name] === 'string') : [];
    if (!names.length) throw new Error('package.json 里没有可运行的 scripts。');
    showPicker(names.map(name => ({label: 'npm run ' + name, run: () => runScript(name, context)})));
  }
  function showPicker(items) {
    const box = el('div', 'pk-wb-menu'); box.setAttribute('role', 'menu');
    const close = () => { box.remove(); document.removeEventListener('pointerdown', off, true); if (closeRunPicker === close) closeRunPicker = null; };
    const off = e => { if (!box.contains(e.target)) close(); };
    closeRunPicker = close;
    for (const item of items) { const b = el('button', 'pk-wb-menu__item'); b.type = 'button'; b.append(icon('play'), el('span', '', item.label)); b.addEventListener('click', () => { close(); void item.run(); }); box.append(b); }
    document.body.append(box);
    const r = document.querySelector('.pk-wb-tabs__actions')?.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min((r?.right || 400) - 240, innerWidth - box.offsetWidth - 8)) + 'px';
    box.style.top = Math.max(8, Math.min((r?.bottom || 80) + 4, innerHeight - box.offsetHeight - 8)) + 'px';
    document.addEventListener('pointerdown', off, true);
    box.querySelector('button')?.focus();
  }
  wb.tabActions.set('run', tab => {
    const path = tab?.kind === 'diff' ? null : tab?.path;
    if (!path || (!runCommand(path) && wb.basename(path) !== 'package.json')) return null;
    const b = el('button', 'pk-wb-icon pk-wb-run'); b.type = 'button';
    updateRunButton(b);
    b.addEventListener('click', runActive);
    return b;
  });

  /* ═════════════ 编辑器命令与快捷键 ═════════════ */
  function wire(editor) {
    if (!editor || editor.__pkCode) return;
    editor.__pkCode = true;
    editor.updateOptions({inlineSuggest: {enabled: true, showToolbar: 'onHover'}, quickSuggestions: {other: true, comments: false, strings: true}, suggestOnTriggerCharacters: true, parameterHints: {enabled: true}, 'semanticHighlighting.enabled': true});
    editor.addAction({id: 'pinkie.inlineEdit', label: '让 Li An 修改选中的代码（行内）', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI], contextMenuGroupId: '0_pinkie', contextMenuOrder: 3, run: inlineEdit});
    editor.addAction({id: 'pinkie.run', label: '运行当前文件', keybindings: [monaco.KeyCode.F5, monaco.KeyMod.WinCtrl | monaco.KeyMod.Alt | monaco.KeyCode.KeyN], contextMenuGroupId: '1_run', contextMenuOrder: 1, run: runActive});
    editor.addAction({id: 'pinkie.aiTrigger', label: '让 AI 补全这里', keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.Backslash], run: () => editor.trigger('pinkie', 'editor.action.inlineSuggest.trigger', {})});
  }
  wire(wb.editor);
  const timer = setInterval(() => { if (wb.editor) { wire(wb.editor); clearInterval(timer); } }, 500);
  document.addEventListener('keydown', e => { if (e.key === 'F5' && document.querySelector('.pk-wb')?.contains(e.target) && !e.target.closest?.('.monaco-editor')) { e.preventDefault(); runActive(); } }, true);
  wb.renderTabs(); wb.renderStatus();
  Object.assign(wb, {runActive, inlineEdit, lspClients: clients});
})();

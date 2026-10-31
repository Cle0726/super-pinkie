// Narrow migration for an installed mode-architecture entry. Do not replace
// the entry with the repository copy: other agents own unrelated work there.
const once = (text, before, after, label) => {
  if (text.split(before).length !== 2) throw Error('Work UI migration needs review: '+label);
  return text.replace(before, after);
};
const within = (text, start, end, edit) => {
  const a=text.indexOf(start),b=text.indexOf(end,a+start.length);
  if(a<0||b<a)throw Error('Work UI method boundary changed: '+start);
  return text.slice(0,a)+edit(text.slice(a,b))+text.slice(b);
};
export function transformWorkPanel(original) {
  let text=original;
  const imports="import {ReasoningEnhancer, ReviewStore, registerReasoningGateway} from './reasoning.mjs';";
  if(!text.includes("from './background-jobs.mjs'")) text=once(text,imports,imports+"\nimport {BackgroundJobs} from './background-jobs.mjs';",'background import');
  if(!text.includes("from './work-status.mjs'")) text=once(text,imports,imports+"\nimport {registerWorkGateway} from './work-status.mjs';",'work import');
  if(!text.includes('  childOutput(sessionKey, id) {')) {
    text=once(text,'      roles: progress.roles,\n      updatedAt:',`      roles: progress.roles,
      children: Object.entries(state.childTimeline || {}).slice(-24).map(([key, row]) => ({
        id: hashForAudit(key).slice(0, 12), role: row.role, roleLabel: ROLE_LABELS[row.role] || row.role || '协作', label: row.label,
        model: row.model || state.childModels.get(key) || '', state: row.state, startedAt: row.startedAt, endedAt: row.endedAt,
        summary: row.summary, hasOutput: Boolean(state.childResults.get(key)?.text),
      })),
      updatedAt:`,'child status');
    text=once(text,'  disarm(sessionKey) {',`  // Results are resolved within this parent, never by a globally shared child id.
  childOutput(sessionKey, id) {
    const state = this.getRun(sessionKey);
    if (!state) return {found: false};
    for (const [key, row] of Object.entries(state.childTimeline || {})) {
      if (hashForAudit(key).slice(0, 12) !== id) continue;
      return {found: true, role: row.role, label: row.label, state: row.state, output: String(state.childResults.get(key)?.text || row.summary || '')};
    }
    return {found: false};
  }

  disarm(sessionKey) {`,'child detail');
  }
  text=within(text,'  spawned(event, ctx) {','  ended(event) {',body=>body.includes('state.childTimeline')?body:once(body,'    state.lastEventAt = Date.now();',`    state.childTimeline ||= {};
    if (firstSeen || !state.childTimeline[event.childSessionKey]) {
      state.childTimeline[event.childSessionKey] = {role, label: String(event.label || ''), model: resolvedModel, startedAt: Date.now(), endedAt: 0, state: 'running', summary: ''};
    }
    state.lastEventAt = Date.now();`,'child start'));
  text=within(text,'  ended(event) {','  beforeCompaction(event, ctx) {',body=>body.includes('const row = state.childTimeline')?body:once(body,
    '      state.lastEventAt = Date.now();\n      this.setRun(parent, state);\n    }\n    if (parent)',
    `      const row = state.childTimeline?.[event.targetSessionKey];
      if (row) {
        row.endedAt = row.endedAt || Date.now();
        row.state = acceptedSuccess ? 'done' : 'failed';
        row.summary = resultText.replace(/\\s+/g, ' ').slice(0, 80);
      }
      state.lastEventAt = Date.now();
      this.setRun(parent, state);
    }
    if (parent)`,'child finish'));
  if(!text.includes('registerWorkGateway(api, {reasoning, architecture, background});')) {
    if(text.includes("api.registerGatewayMethod('pinkie.work.status'"))throw Error('Existing work gateway registration needs a manual merge');
    const block=`    const background = new BackgroundJobs({
      runProcess,
      cliEntry: resolveGatewayCliEntry(),
      isBusy: sessionKey => {
        const activity = architecture.activityFor(sessionKey) || {};
        return Boolean(activity.parentRunning) || Number(activity.pending) > 0;
      },
    });
    registerWorkGateway(api, {reasoning, architecture, background});
`;
    text=once(text,'    registerModelSync(api);',block+'    registerModelSync(api);','work registration');
  }
  const hook="    api.on('after_tool_call', async (event, ctx) => {\n";
  if(!text.includes('      background.afterTool(event, ctx);'))text=once(text,hook,hook+'      background.afterTool(event, ctx);\n','background hook');
  return text;
}

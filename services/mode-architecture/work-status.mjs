// Read-only presentation API for the existing execution engines. Keep the
// aggregate contract in one module so packaging and UI tests use the same code.
const SESSION_KEY = /^agent:(main|project|thinking|learning|unrestricted):[^\s]+$/;

export function registerWorkGateway(api, {reasoning, architecture, background}) {
  const sessionFor = (params, respond) => {
    const key = String(params?.sessionKey || '');
    if (SESSION_KEY.test(key) && !/:(?:subagent|internal-session-effects):/.test(key)) return key;
    respond(false, undefined, {code: 'INVALID_REQUEST', message: '工作面板会话无效'});
    return '';
  };
  api.registerGatewayMethod('pinkie.work.status', ({params, respond}) => {
    const sessionKey = sessionFor(params, respond);
    if (!sessionKey) return;
    respond(true, {
      sessionKey,
      reasoning: reasoning.status({sessionKey}),
      tier: architecture.status(sessionKey),
      background: background.status(sessionKey),
      now: Date.now(),
    });
  }, {scope: 'operator.admin'});
  api.registerGatewayMethod('pinkie.work.detail', ({params, respond}) => {
    const sessionKey = sessionFor(params, respond);
    if (!sessionKey) return;
    const id = String(params?.id || '');
    const result = params?.kind === 'child' ? architecture.childOutput(sessionKey, id)
      : params?.kind === 'job' ? reasoning.job({sessionKey, jobId: id}) : {found: false};
    respond(true, {...result, sessionKey});
  }, {scope: 'operator.admin'});
}

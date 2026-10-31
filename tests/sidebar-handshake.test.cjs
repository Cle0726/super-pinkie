const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

// Isolated: a local fake gateway on a random port, never the running one on 18789.
// It enforces the real handshake rule: until a connection's connect has finished
// authenticating, any other request is answered "invalid handshake: first request
// must be connect" and the socket is closed.
const sidebar = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-sidebar.js'), 'utf8');
let harnessModule;
test.before(async () => { harnessModule = await import('../tools/study-desk/harness.mjs'); });

function WebSocketServer() {
  try { return require('ws').WebSocketServer; }
  catch { return require('/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/lib/utilsBundle.js').wsServer; }
}

// Stands in for the App's gateway client: wait for the challenge, spend a while
// signing (the real client awaits buildConnectPlan here), send connect, and
// reconnect when the gateway goes away.
const page = `<!doctype html><meta charset="utf-8"><title>握手隔离验收</title>
<script src="/laolao-sidebar.js"></script>
<script>
window.qa = {results: [], onOpen: null, onClose: null};
let sockets = 0;
window.startApp = (signMs) => {
  const n = ++sockets;
  const ws = new WebSocket(location.origin.replace('http', 'ws') + '/');
  ws.addEventListener('open', () => { const hook = qa.onOpen; qa.onOpen = null; hook?.(); });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      setTimeout(() => ws.send(JSON.stringify({type: 'req', id: 'app-connect-' + n, method: 'connect', params: {minProtocol: 3, maxProtocol: 4, client: {id: 'qa'}}})), signMs);
    }
  });
  ws.addEventListener('close', () => { const hook = qa.onClose; qa.onClose = null; hook?.(); setTimeout(() => startApp(signMs), 50); });
};
// An injection script that asks the gateway as early as it can, like the study desk's desk.today.
window.probe = (label) => __laolaoSidebar.gwRequest('desk.today', {label}).then(
  (payload) => qa.results.push({label, ok: true, conn: payload.conn}),
  (error) => qa.results.push({label, ok: false, error: error.message}));
</script>`;

async function fakeGateway({authMs = 400} = {}) {
  const log = [];
  const rejected = [];
  let conns = 0;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/laolao-sidebar.js')) { res.setHeader('Content-Type', 'text/javascript'); res.end(sidebar); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page);
  });
  const Server = WebSocketServer();
  const wss = new Server({server});
  wss.on('connection', (socket) => {
    const conn = ++conns;
    let accepted = false;
    let authenticating = false;
    socket.send(JSON.stringify({type: 'event', event: 'connect.challenge', payload: {nonce: `qa-${conn}`, ts: Date.now()}}));
    socket.on('message', (raw) => {
      let req; try { req = JSON.parse(String(raw)); } catch { return; }
      if (req.type !== 'req') return;
      log.push(`${conn}:${req.method}`);
      if (!accepted && (req.method !== 'connect' || authenticating)) {
        const message = 'invalid handshake: first request must be connect';
        rejected.push(`${conn}:${req.method}`);
        socket.send(JSON.stringify({type: 'res', id: req.id, ok: false, error: {code: 'INVALID_REQUEST', message}}));
        queueMicrotask(() => socket.close(1008, message));
        return;
      }
      if (!accepted) {
        authenticating = true;
        setTimeout(() => {
          accepted = true;
          log.push(`${conn}:hello-ok`);
          socket.send(JSON.stringify({type: 'res', id: req.id, ok: true, payload: {type: 'hello-ok', protocol: 4, server: {version: 'isolated-qa', connId: `qa-${conn}`}, features: {methods: [], events: []}, snapshot: {}, auth: {role: 'operator', scopes: []}, policy: {tickIntervalMs: 30000}}}));
        }, authMs);
        return;
      }
      const payload = req.method === 'sessions.list' ? {sessions: []} : {method: req.method, conn};
      socket.send(JSON.stringify({type: 'res', id: req.id, ok: true, payload}));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`, log, rejected, conns: () => conns,
    restart: () => { for (const socket of wss.clients) socket.close(1012, 'service restart'); },
    close: () => { for (const socket of wss.clients) socket.terminate(); wss.close(); return new Promise((resolve) => server.close(resolve)); },
  };
}

const after = (log, first, then) => log.indexOf(first) >= 0 && log.indexOf(first) < log.indexOf(then);

test('a gwRequest sent before connect is held until hello-ok, and again after the gateway restarts', async () => {
  const gateway = await fakeGateway();
  const browser = await harnessModule.playwright().webkit.launch({headless: true});
  try {
    const tab = await browser.newPage();
    const errors = []; tab.on('pageerror', (error) => errors.push(error.message));
    await tab.goto(gateway.url);

    // Page load: the socket opens and an injection asks before the App has even sent connect.
    await tab.evaluate(() => { qa.onOpen = () => probe('on-open'); startApp(400); });
    await tab.waitForFunction(() => qa.results.length >= 1, null, {timeout: 10_000});
    assert.deepEqual(await tab.evaluate(() => qa.results), [{label: 'on-open', ok: true, conn: 1}]);
    assert.deepEqual(gateway.rejected, []);
    assert.equal(gateway.conns(), 1, 'the App never had to reconnect');
    assert.equal(gateway.log[0], '1:connect', 'the first request on the connection is the App\'s own connect');
    assert.ok(after(gateway.log, '1:hello-ok', '1:desk.today'), gateway.log.join(' '));

    // Gateway restart: the accepted socket closes and the App reconnects. Readiness must not carry over.
    await tab.evaluate(() => { qa.onClose = () => probe('while-closed'); qa.onOpen = () => probe('on-reopen'); });
    gateway.restart();
    await tab.waitForFunction(() => qa.results.length >= 3, null, {timeout: 10_000});
    const results = await tab.evaluate(() => qa.results.slice(1).sort((a, b) => a.label.localeCompare(b.label)));
    assert.deepEqual(results, [{label: 'on-reopen', ok: true, conn: 2}, {label: 'while-closed', ok: true, conn: 2}]);
    assert.deepEqual(gateway.rejected, []);
    assert.equal(gateway.conns(), 2);
    assert.equal(gateway.log.find((entry) => entry.startsWith('2:')), '2:connect');
    assert.ok(gateway.log.filter((entry) => entry === '2:desk.today').length === 2 && after(gateway.log, '2:hello-ok', '2:desk.today'), gateway.log.join(' '));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await gateway.close(); }
});

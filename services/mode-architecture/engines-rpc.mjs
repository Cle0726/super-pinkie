// T3 Code 服务端的实时通道（T3 自己的网页也用这条）：ws://127.0.0.1:<端口>/ws?orchestrationProtocol=2。
// 计划：briefs/metre-engines-1122/PLAN.md 3.3。
//
// 消息是 Effect RPC 的 JSON：
//   发：{_tag:'Request', id, tag, payload, headers:[]}；流式回复每收一批回 {_tag:'Ack', requestId}；不要了发 {_tag:'Interrupt', requestId}
//   收：{_tag:'Chunk', requestId, values:[...]}（流）、{_tag:'Exit', requestId, exit:{_tag:'Success', value} | {_tag:'Failure', cause}}、{_tag:'Pong'}
// 令牌：由调用方给（引擎服务用 `t3 auth session issue` 现签），只在内存里，不进日志、不出这个文件。
export const PROTOCOL_VERSION = 2;
const PING_MS = 20_000;
const REQUEST_TIMEOUT_MS = 60_000;

// Effect 的失败原因是一棵树（Fail / Die / Sequential / Parallel …）；取第一句能给人看的话。
export function causeMessage(cause, depth = 0) {
  if (cause == null || depth > 8) return '';
  if (typeof cause === 'string') return cause;
  if (Array.isArray(cause)) {
    for (const item of cause) { const text = causeMessage(item, depth + 1); if (text) return text; }
    return '';
  }
  if (typeof cause !== 'object') return String(cause);
  for (const key of ['message', 'detail', 'diagnostic', 'reason']) {
    if (typeof cause[key] === 'string' && cause[key].trim()) return cause[key].trim();
  }
  for (const key of ['error', 'defect', 'failure', 'cause', 'left', 'right', 'failures', 'value']) {
    const text = causeMessage(cause[key], depth + 1);
    if (text) return text;
  }
  return typeof cause._tag === 'string' && !/^(Fail|Die|Sequential|Parallel|Empty|Interrupt)$/.test(cause._tag) ? cause._tag : '';
}

export class RpcError extends Error {
  constructor(message, {tag = '', cause = null} = {}) {
    super(message || '引擎服务没有说明原因');
    this.name = 'RpcError';
    this.tag = tag;
    this.cause = cause;
  }
}

export class T3Rpc {
  constructor({url, token, WebSocketImpl = globalThis.WebSocket, logger = null, timeout = REQUEST_TIMEOUT_MS} = {}) {
    if (!url) throw new Error('需要引擎服务地址');
    Object.assign(this, {url, token, WebSocketImpl, logger, timeout});
    this.socket = null;
    this.opening = null;
    this.nextId = 1;
    this.pending = new Map();
    this.streams = new Map();
    this.pinger = null;
    this.closed = false;
  }

  log(text) { try { this.logger?.warn?.(`engines rpc ${text}`); } catch {} }

  endpoint() {
    const base = String(this.url).replace(/^http/, 'ws').replace(/\/+$/, '');
    return `${base}/ws?orchestrationProtocol=${PROTOCOL_VERSION}`;
  }

  connect() {
    if (this.socket && this.socket.readyState === 1) return Promise.resolve(this.socket);
    if (this.opening) return this.opening;
    if (typeof this.WebSocketImpl !== 'function') return Promise.reject(new Error('这个运行环境没有 WebSocket，外部引擎用不了'));
    this.closed = false;
    this.opening = (async () => {
      const bearer = typeof this.token === 'function' ? await this.token() : this.token;
      if (!bearer) throw new Error('没有拿到引擎服务的令牌');
      return await new Promise((resolve, reject) => {
        let settled = false;
        const socket = new this.WebSocketImpl(this.endpoint(), {headers: {authorization: `Bearer ${bearer}`}});
        socket.onopen = () => {
          settled = true;
          this.socket = socket;
          clearInterval(this.pinger);
          this.pinger = setInterval(() => this.raw({_tag: 'Ping'}), PING_MS);
          this.pinger.unref?.();
          resolve(socket);
        };
        socket.onmessage = event => this.onMessage(event.data);
        socket.onerror = event => {
          if (!settled) { settled = true; reject(new Error('连不上引擎服务：' + (event?.message || '连接被拒绝'))); }
        };
        socket.onclose = event => {
          if (!settled) { settled = true; reject(new Error(`引擎服务关闭了连接（${event?.code || '?'}）`)); }
          if (this.socket === socket) this.onClosed(event);
        };
      });
    })().finally(() => { this.opening = null; });
    return this.opening;
  }

  raw(message) {
    try { if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(message)); } catch {}
  }

  onClosed(event) {
    this.socket = null;
    clearInterval(this.pinger);
    const error = new RpcError(`和引擎服务的连接断了（${event?.code || '?'}）`, {tag: 'Disconnected'});
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
    for (const stream of this.streams.values()) { try { stream.onEnd?.(error); } catch {} }
    this.streams.clear();
  }

  onMessage(data) {
    let parsed;
    try { parsed = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8')); } catch { return; }
    for (const message of [].concat(parsed)) {
      if (!message || typeof message !== 'object') continue;
      const id = message.requestId == null ? '' : String(message.requestId);
      if (message._tag === 'Chunk') {
        const stream = this.streams.get(id);
        if (!stream) continue;
        for (const value of message.values || []) { try { stream.onValue(value); } catch (error) { this.log(`stream handler failed: ${error.message}`); } }
        this.raw({_tag: 'Ack', requestId: id});
      } else if (message._tag === 'Exit') {
        const exit = message.exit || {};
        const failure = exit._tag === 'Success' ? null : new RpcError(causeMessage(exit.cause) || '引擎服务拒绝了这个操作', {tag: 'Failure', cause: exit.cause});
        const entry = this.pending.get(id);
        if (entry) {
          this.pending.delete(id);
          clearTimeout(entry.timer);
          if (failure) entry.reject(failure); else entry.resolve(exit.value);
        }
        const stream = this.streams.get(id);
        if (stream) { this.streams.delete(id); try { stream.onEnd?.(failure); } catch {} }
      } else if (message._tag === 'Defect' || message._tag === 'ClientProtocolError') {
        const error = new RpcError(causeMessage(message.defect || message.error) || '引擎服务出错了', {tag: message._tag});
        for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
        this.pending.clear();
      }
    }
  }

  async request(tag, payload = {}, {timeout = this.timeout} = {}) {
    await this.connect();
    const id = String(this.nextId++);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.raw({_tag: 'Interrupt', requestId: id});
        reject(new RpcError('引擎服务太久没有回应', {tag: 'Timeout'}));
      }, timeout);
      timer.unref?.();
      this.pending.set(id, {resolve, reject, timer});
      this.raw({_tag: 'Request', id, tag, payload, headers: []});
    });
  }

  // 流式订阅：onValue 每条调一次；返回 close()。连接断了 onEnd(error)。
  async stream(tag, payload, onValue, onEnd = null) {
    await this.connect();
    const id = String(this.nextId++);
    this.streams.set(id, {onValue, onEnd});
    this.raw({_tag: 'Request', id, tag, payload, headers: []});
    return {
      id,
      close: () => {
        if (!this.streams.delete(id)) return;
        this.raw({_tag: 'Interrupt', requestId: id});
      },
    };
  }

  // 拿流的第一条就停（比如外壳快照）。
  async first(tag, payload = {}, {timeout = this.timeout} = {}) {
    let handle = null;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { handle?.close(); reject(new RpcError('引擎服务太久没有回应', {tag: 'Timeout'})); }, timeout);
      timer.unref?.();
      this.stream(tag, payload, value => { clearTimeout(timer); handle?.close(); resolve(value); }, error => {
        clearTimeout(timer);
        reject(error || new RpcError('引擎服务没有给出数据', {tag: 'Empty'}));
      }).then(h => { handle = h; }, error => { clearTimeout(timer); reject(error); });
    });
  }

  close() {
    this.closed = true;
    clearInterval(this.pinger);
    const socket = this.socket;
    this.socket = null;
    try { socket?.close(1000, 'bye'); } catch {}
    if (socket) this.onClosed({code: 1000});
  }
}

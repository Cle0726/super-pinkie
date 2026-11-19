// 反馈上报传输层（可替换）：
// 默认走 GitHub 专用私有仓库（每次新建唯一文件名，不修改已有文件）；
// 若配置了中转地址（如 Cloudflare Workers 免费额度），则优先走中转，令牌无需进安装包。
// 所有网络异常、断网、令牌失效均返回结构化状态，不抛异常、不阻断 App、不打印凭据。
import crypto from 'node:crypto';

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function makeBatchFilePath(date = new Date()) {
  const iso = date.toISOString();
  const day = iso.slice(0, 10);
  const stamp = iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const rand = crypto.randomBytes(6).toString('hex');
  return `reports/${day}/${stamp}-${rand}.enc.json`;
}

export function classifyTransportError(status, error) {
  if (Number.isFinite(status) && status > 0) {
    if (status === 401 || status === 403) return {errorCode: 'auth', retryable: false};
    if (status === 404) return {errorCode: 'not_found', retryable: false};
    if (status === 429) return {errorCode: 'rate_limit', retryable: true};
    if (status === 409 || status === 422) return {errorCode: 'conflict', retryable: true};
    if (status >= 500) return {errorCode: 'server', retryable: true};
    return {errorCode: 'rejected', retryable: false};
  }
  const name = String(error?.name || '');
  const code = String(error?.cause?.code || error?.code || '');
  if (name === 'TimeoutError' || name === 'AbortError' || /ETIMEDOUT/i.test(code)) {
    return {errorCode: 'timeout', retryable: true};
  }
  return {errorCode: 'offline', retryable: true};
}

function validEndpointUrl(raw = '') {
  try {
    const url = new URL(String(raw || '').trim());
    if (url.protocol === 'https:') return url.href;
    if (url.protocol === 'http:' && /^(?:127\.0\.0\.1|localhost|\[::1\])$/i.test(url.hostname)) return url.href;
    return '';
  } catch {
    return '';
  }
}

export function createFeedbackTransport(config = {}, {
  fetchFn = globalThis.fetch,
  appVersion = '0.0.0',
  timeoutMs = 15_000,
} = {}) {
  const endpoint = validEndpointUrl(config.endpoint || '');
  if (endpoint) {
    return {
      kind: 'relay',
      configured: true,
      async upload({envelope, filePath = makeBatchFilePath()} = {}) {
        if (typeof fetchFn !== 'function') return {ok: false, retryable: false, errorCode: 'no_fetch'};
        try {
          const response = await fetchFn(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': `SuperPinkie-Feedback/${String(appVersion || '0.0.0').slice(0, 24)}`,
            },
            body: JSON.stringify({path: filePath, envelope}),
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (response.ok) return {ok: true, path: filePath, status: response.status};
          return {ok: false, status: response.status, ...classifyTransportError(response.status)};
        } catch (error) {
          return {ok: false, ...classifyTransportError(0, error)};
        }
      },
    };
  }

  const repo = String(config.repo || '').trim();
  const token = String(config.token || '').trim();
  if (REPO_RE.test(repo) && token) {
    const [owner, name] = repo.split('/');
    const apiBase = String(config.githubApiBase || 'https://api.github.com').replace(/\/+$/, '');
    return {
      kind: 'github',
      configured: true,
      async upload({envelope, filePath = makeBatchFilePath()} = {}) {
        if (typeof fetchFn !== 'function') return {ok: false, retryable: false, errorCode: 'no_fetch'};
        const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
        const url = `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${encodedPath}`;
        const serialized = JSON.stringify(envelope, null, 2) + '\n';
        const body = JSON.stringify({
          message: `feedback: ${filePath}`,
          content: Buffer.from(serialized, 'utf8').toString('base64'),
        });
        try {
          const response = await fetchFn(url, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': `SuperPinkie-Feedback/${String(appVersion || '0.0.0').slice(0, 24)}`,
              'Content-Type': 'application/json',
            },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (response.ok) return {ok: true, path: filePath, status: response.status};
          return {ok: false, status: response.status, ...classifyTransportError(response.status)};
        } catch (error) {
          return {ok: false, ...classifyTransportError(0, error)};
        }
      },
    };
  }

  return {
    kind: 'none',
    configured: false,
    async upload() {
      return {ok: false, retryable: false, errorCode: 'not_configured'};
    },
  };
}

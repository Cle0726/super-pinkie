// 各模式的 openclaw-agent.sqlite 如果是更新版 OpenClaw 写的（结构版本比本运行时认的高），
// 运行时一打开就报「uses newer schema version 19; this OpenClaw build supports 1」，
// memory_search 每调一次都白费一轮（tools-health-1113 A2，Mac 11-13 6/6 失败）。
//
// 网关启动时检查一遍：版本更新的库连同 -wal / -shm / -journal 原样挪到
// <状态目录>/backups/agent-db-<日期>/<模式>/，让运行时下次用到时重建一个它认得的空库。
// 只挪不删，不做降级转换；挪之前确认没人在写（库和 -wal / -journal 最近 60 秒没动过，
// Windows 上被占用的文件改名会失败，失败就整组放回、这次不动）。
// -shm 不算：运行时启动时（早于插件的 gateway_start）会打开每个模式库，读到版本太新就报错关掉，
// 但打开这一下已经重写了 -shm；按它算「有人在写」就永远挪不动（Windows 副本实测 11-13）。
import fs from 'node:fs';
import path from 'node:path';

const SIDECARS = ['-wal', '-shm', '-journal'];

// SQLite 文件头第 60–63 字节是 PRAGMA user_version（大端）。不打开库，不加依赖。
export function sqliteUserVersion(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const header = Buffer.alloc(100);
    if (fs.readSync(fd, header, 0, 100, 0) < 100) return null;
    if (header.toString('latin1', 0, 16) !== 'SQLite format 3\u0000') return null;
    return header.readUInt32BE(60);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

// 本运行时认的结构版本：读打包代码里的 OPENCLAW_AGENT_SCHEMA_VERSION，读不到就返回 null（什么都不做）。
export function supportedAgentSchemaVersion(distDir) {
  if (!distDir) return null;
  try {
    for (const name of fs.readdirSync(distDir)) {
      if (!/^openclaw-agent-db-[^.]+\.m?js$/u.test(name)) continue;
      const match = fs.readFileSync(path.join(distDir, name), 'utf8').match(/OPENCLAW_AGENT_SCHEMA_VERSION = (\d+);/u);
      if (match) return Number(match[1]);
    }
  } catch { /* 读不到就不动 */ }
  return null;
}

// 运行时 dist 目录：Windows / Mac 隔离副本和 App 都会设 PINKIE_OPENCLAW_RUNTIME；
// 没设时从网关入口（.../openclaw/openclaw.mjs）推。
export function runtimeDistDir(env = process.env, argv = process.argv) {
  if (env.PINKIE_OPENCLAW_RUNTIME) return env.PINKIE_OPENCLAW_RUNTIME;
  const entry = env.PINKIE_OPENCLAW_ENTRY || argv?.[1] || '';
  return entry ? path.join(path.dirname(entry), 'dist') : '';
}

function agentEntries(config) {
  const agents = config?.agents || {};
  const list = Array.isArray(agents.list) ? agents.list : [];
  const entries = agents.entries && typeof agents.entries === 'object'
    ? Object.entries(agents.entries).map(([id, value]) => ({...value, id}))
    : [];
  const seen = new Set();
  return [...entries, ...list].filter(agent => agent?.id && !seen.has(agent.id) && seen.add(agent.id));
}

function day(now) {
  const d = new Date(now);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export function quarantineNewerAgentDatabases({config, stateDir, supported, now = Date.now(), quietMs = 60_000} = {}) {
  const report = [];
  if (!stateDir || !Number.isInteger(supported)) return report;
  for (const agent of agentEntries(config)) {
    const agentDir = agent.agentDir ? path.resolve(agent.agentDir) : path.join(stateDir, 'agents', agent.id, 'agent');
    const db = path.join(agentDir, 'openclaw-agent.sqlite');
    const version = sqliteUserVersion(db);
    if (version === null || version <= supported) continue;
    const files = [db, ...SIDECARS.map(suffix => db + suffix)].filter(file => fs.existsSync(file));
    const busy = files.some(file => !file.endsWith('-shm') && now - fs.statSync(file).mtimeMs < quietMs);
    if (busy) {
      report.push({agent: agent.id, version, supported, action: 'skipped-busy', file: db});
      continue;
    }
    const target = path.join(stateDir, 'backups', `agent-db-${day(now)}`, agent.id);
    fs.mkdirSync(target, {recursive: true});
    const moved = [];
    try {
      for (const file of files) {
        const dest = path.join(target, path.basename(file));
        if (fs.existsSync(dest)) throw new Error(`backup already has ${path.basename(file)}`);
        fs.renameSync(file, dest);
        moved.push([file, dest]);
      }
      report.push({agent: agent.id, version, supported, action: 'moved', from: db, to: target, files: moved.map(([, dest]) => path.basename(dest))});
    } catch (error) {
      // 整组放回：不能留下一个没有 -wal 的主库。
      for (const [file, dest] of moved.reverse()) try { fs.renameSync(dest, file); } catch { /* 尽力 */ }
      report.push({agent: agent.id, version, supported, action: 'skipped-error', file: db, error: String(error?.code || error?.message || error)});
    }
  }
  return report;
}

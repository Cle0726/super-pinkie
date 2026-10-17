import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';

export function loginConfig(config) {
  return {
    plugins: {allow: ['openclaw-weixin'], entries: {'openclaw-weixin': {enabled: true}}},
    channels: {'openclaw-weixin': structuredClone(config.channels?.['openclaw-weixin'] || {})},
    // Only the parent gateway may activate an account after checking its route.
    gateway: {mode: 'remote'},
  };
}

export function isolateLegacyWechatCliLogin({argv = process.argv, env = process.env,
  stdin = process.stdin, stdout = process.stdout, onExit = cleanup => process.once('exit', cleanup)} = {}) {
  const expected = ['channels', 'login', '--channel', 'openclaw-weixin'];
  const args = argv.slice(2);
  if (args.length !== expected.length || !expected.every((value, index) => args[index] === value)
    || env.NO_COLOR !== '1' || stdin.isTTY || stdout.isTTY || env.PINKIE_WECHAT_LOGIN_ISOLATED === '1') return null;
  const expand = value => path.resolve(value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value);
  const stateDir = expand(env.OPENCLAW_STATE_DIR || path.join(os.homedir(), '.openclaw'));
  const sourcePath = expand(env.OPENCLAW_CONFIG_PATH || path.join(stateDir, 'openclaw.json'));
  const text = fs.readFileSync(sourcePath, 'utf8');
  let config;
  try { config = JSON.parse(text); }
  catch { config = createRequire(path.resolve(argv[1]))('json5').parse(text); }
  const directory = fs.mkdtempSync(path.join(stateDir, '.pinkie-wechat-cli-'));
  const cleanup = () => { try { fs.rmSync(directory, {recursive: true, force: true}); } catch {} };
  try {
    fs.chmodSync(directory, 0o700);
    const configPath = path.join(directory, 'openclaw.json');
    fs.writeFileSync(configPath, JSON.stringify(loginConfig(config)), {mode: 0o600, flag: 'wx'});
    env.OPENCLAW_CONFIG_PATH = configPath;
    env.PINKIE_WECHAT_LOGIN_ISOLATED = '1';
    onExit(cleanup);
    return {configPath, cleanup};
  } catch (error) { cleanup(); throw error; }
}

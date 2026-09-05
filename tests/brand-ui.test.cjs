const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('connection and fallback chrome use CLE Kk while stored chat text stays protected',()=>{
  const phrases=read('ui/injections/laolao-phrases.js');
  const mac=read('installer/macos/apply-theme.sh');
  const windows=read('installer/windows/apply-theme.ps1');
  assert.match(phrases,/网关仪表盘.*CLE Kk 本地工作台/);
  assert.match(phrases,/OPENCLAW_GATEWAY_TOKEN.*CLE Kk 访问令牌/);
  assert.match(phrases,/OPENCLAW_GATEWAY_TOKEN\(\?:.*可选/);
  assert.match(phrases,/更新凭据后再次点击 Connect。.*填好后再次点击“连接”/);
  assert.match(phrases,/isProtectedContent\(node\).*return/s);
  assert.match(mac,/s\{OpenClaw\}\{CLE Kk\}g/);
  assert.match(windows,/Replace\('OpenClaw', 'CLE Kk'\)/);
  assert.match(mac,/phrases10/);assert.match(windows,/phrases10/);
});

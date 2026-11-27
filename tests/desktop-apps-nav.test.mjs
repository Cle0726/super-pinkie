import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {navGuardScript, withPolicy} from '../services/mode-architecture/desktop-apps.mjs';

const PAGE = 'file:///tmp/apps/w0123456789abcde/index.html';

function install(origins) {
  const clicks = [];
  const navs = [];
  const sandbox = {
    location: {href: PAGE},
    URL, Set,
    addEventListener(type, fn) { if (type === 'click') clicks.push(fn); },
    window: {open(url) { this.opened = url; return {url}; }},
  };
  sandbox.window.navigation = {addEventListener(type, fn) { if (type === 'navigate') navs.push(fn); }};
  const source = navGuardScript(origins);
  assert.match(source, /^<script>[\s\S]*<\/script>$/);
  vm.runInNewContext(source.slice('<script>'.length, -'</script>'.length), sandbox);
  const click = (href, tag = 'A') => {
    const event = {
      composedPath: () => [{tagName: tag, href}],
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
    };
    clicks[0](event);
    return event;
  };
  const go = (url, extra = {}) => {
    const event = {
      destination: {url, sameDocument: false},
      hashChange: false,
      navigationType: 'push',
      preventDefault() { this.prevented = true; },
      ...extra,
    };
    navs[0](event);
    return event;
  };
  return {sandbox, click, go};
}

test('没勾的地址不能换页：链接、area、location、window.open、data: 和目录外的文件', () => {
  const guard = install(['https://api.example:443']);
  assert.equal(guard.click('https://evil.example/x').prevented, true);
  assert.equal(guard.click('https://api.example/v1').prevented, undefined, '勾过的来源，默认端口写法也算');
  assert.equal(guard.click('https://api.example:8443/v1').prevented, true, '另一个端口不算同一个来源');
  assert.equal(guard.click('http://api.example/v1').prevented, true, '换协议不算');
  assert.equal(guard.click('https://evil.example/x', 'AREA').prevented, true);
  assert.equal(guard.click('file:///tmp/apps/w0123456789abcde/other.html').prevented, undefined);
  assert.equal(guard.click('file:///tmp/apps/w0123456789abcde/../secret.html').prevented, true, '目录外的相对路径要按解析后的地址拦');
  assert.equal(guard.click('file:///tmp/apps/w0123456789abcdex/index.html').prevented, true, '只是前缀相同的兄弟目录不算');
  assert.equal(guard.go('https://evil.example/').prevented, true);
  assert.equal(guard.go('data:text/html,hi').prevented, true);
  assert.equal(guard.go('blob:file:///tmp/apps/w0123456789abcde/uuid').prevented, true);
  assert.equal(guard.go('https://api.example/ok').prevented, undefined);
  assert.equal(guard.go('https://evil.example/', {navigationType: 'reload', destination: {url: PAGE, sameDocument: false}}).prevented, undefined, '刷新本页要留着');
  assert.equal(guard.go(PAGE + '#part', {hashChange: true, destination: {url: PAGE + '#part', sameDocument: true}}).prevented, undefined);
  assert.equal(guard.sandbox.window.open('https://evil.example/'), null);
  assert.equal(guard.sandbox.window.open('https://api.example/ok').url, 'https://api.example/ok');
  assert.equal(guard.sandbox.window.open(), null);
});

test('装出来的页面在作品脚本之前带上跳转守卫，勾过的默认端口按浏览器的 origin 放行', () => {
  const html = withPolicy('<!doctype html><html><head><title>t</title></head><body><script>location.replace("https://evil.example")</script></body></html>',
    {origins: ['https://api.example:443', 'javascript:alert(1)']});
  const guard = html.indexOf('addEventListener("navigate"');
  assert.ok(guard > 0 && guard < html.indexOf('location.replace'));
  const set = html.slice(html.indexOf('const allowed=new Set'), html.indexOf('const ok='));
  assert.equal(set, 'const allowed=new Set(["https://api.example"]);');
  const files = withPolicy('<html><head><title>t</title></head></html>', {files: true, origins: []});
  assert.ok(files.includes('addEventListener("navigate"'));
});

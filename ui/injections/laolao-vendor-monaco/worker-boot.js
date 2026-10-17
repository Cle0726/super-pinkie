/* 超級碧琪：Monaco 的 worker 启动器。
 * 页面 CSP 只允许同源 worker（worker-src 'self'），而 Monaco 默认用 blob: 地址包一层，会被拦下。
 * 这里做同样的事：只加载同目录 vs/workers/ 里的 worker 脚本（网关把带 /assets/ 的路径当成它自己的资源目录，取不到，所以从 Monaco 的 vs/assets 改名而来），然后告诉编辑器已就绪。 */
(function () {
  'use strict';
  var name = new URL(self.location.href).searchParams.get('w') || '';
  if (!/^[A-Za-z0-9._-]+\.js$/.test(name)) throw new Error('bad worker');
  importScripts(new URL('./vs/workers/' + name, self.location.href).href);
  self.postMessage({type: 'vscode-worker-ready'});
})();

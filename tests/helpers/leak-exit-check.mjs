// B55 (uireview #385 issuecomment-7205982818): CI runs node --test with --test-force-exit so a leaked
// handle cannot hang a step for 30 minutes. On its own that turns a pure leak (every test passed)
// into exit 0. Imported into every test process with --import, this fails the process at exit when a
// server is still listening, and names it.
//
// Why owner objects and not process.getActiveResourcesInfo(): under --test-force-exit the process
// exits right after the last test, before libuv has released handles a test DID close, so a server
// closed correctly still shows up as TCPServerWrap there (probed on node 24, Windows). The owning
// net.Server's `listening` is false once close() has run and true only for a real leak. Client and
// stdio sockets are not counted: the runner's own pipes and fetch keep-alive sockets are always open.
import net from 'node:net';

process.on('exit', () => {
  const handles = typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : [];
  const leaked = handles.filter((h) => h instanceof net.Server && h.listening);
  if (!leaked.length) return;
  const names = leaked.map((s) => {
    const a = s.address();
    return `${s.constructor.name}(${a && typeof a === 'object' ? `${a.address}:${a.port}` : a})`;
  });
  process.stderr.write(`LEAKED HANDLES: ${names.join(', ')} still listening (close it in the test; see tests/helpers/leak-exit-check.mjs)\n`);
  process.exitCode = 1;
});

// B5: read a request body without ever killing the connection before the reply.
// Over `max` the rest is still read and thrown away (up to `drain` more bytes), so the 413 reaches the client:
// destroying the request, or leaving a `for await` early, resets the socket and a client that sends first and
// reads afterwards (urllib, Windows) never sees the reply. Past max + drain we stop reading and the caller says
// Connection: close (same rule as roundtable #204).
export const DRAIN_LIMIT = 1 << 20;

export function readBody(req, {max, drain = DRAIN_LIMIT} = {}) {
  return new Promise(resolve => {
    let done = false;
    const finish = value => { if (!done) { done = true; resolve(value); } };
    const declared = Number(req.headers?.['content-length']);
    if (Number.isFinite(declared) && declared > max + drain) return finish({tooLarge: true, close: true});
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size <= max) chunks.push(chunk);
      else if (size > max + drain) { req.pause(); finish({tooLarge: true, close: true}); }
    });
    req.on('end', () => finish(size > max ? {tooLarge: true, close: false} : {body: Buffer.concat(chunks)}));
    req.on('error', () => finish({error: true}));
    req.on('aborted', () => finish({error: true}));
  });
}

/* WebKit compatibility for PDF.js 6: async iteration over native streams.
   Kept outside the vendored upstream source; copied into the worker realm. */
if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
    configurable: true,
    value: async function* ({preventCancel = false} = {}) {
      const reader = this.getReader();
      let done = false;
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) { done = true; return; }
          yield result.value;
        }
      } finally {
        try { if (!done && !preventCancel) await reader.cancel(); }
        finally { reader.releaseLock(); }
      }
    },
  });
  if (!ReadableStream.prototype.values) Object.defineProperty(ReadableStream.prototype, 'values', {
    configurable: true, value(options) { return this[Symbol.asyncIterator](options); },
  });
}

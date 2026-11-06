"""Stop the Control UI service worker from rewriting unchanged files.

The installers turn OpenClaw's service worker network-first (patched chunks
keep their upstream hashed names, so cache-first served stale code). Its
fetch handler then stored a fresh copy of every response in Cache Storage on
every start -- megabytes of scripts, styles and art written to disk each
time, on Windows each write also scanned. With the gateway's ETag
(patch/apply-control-ui-cache.mjs) an unchanged file now comes back as the
same response; it is only stored again when its ETag differs.

  python tools/ui-parity/sw_cache.py <path/to/sw.js>
"""

import sys
from pathlib import Path

MARKER = "pinkie-sw-etag:v1"

NETWORK_FIRST = """fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))"""

ETAG_AWARE = """fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            // pinkie-sw-etag:v1 -- store again only when the file changed.
            void caches.open(CACHE_NAME).then(async (cache) => {
              const tag = clone.headers.get("etag");
              const kept = tag ? await cache.match(event.request) : null;
              if (!kept || kept.headers.get("etag") !== tag) await cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(() => caches.match(event.request))"""


def transform(text):
    if MARKER in text:
        return text
    return text.replace(NETWORK_FIRST, ETAG_AWARE)


def main(argv):
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[-1].strip(), file=sys.stderr)
        return 2
    path = Path(argv[1])
    if not path.is_file():
        return 0
    text = path.read_text(encoding="utf-8")
    updated = transform(text)
    if updated != text:
        # Byte-preserving like the installers: UTF-8, no BOM, same newlines.
        path.write_bytes(updated.encode("utf-8"))
        print(f"sw cache: etag-aware ({path})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

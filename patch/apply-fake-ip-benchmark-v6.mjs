// Clash / mihomo fake-IP mode answers every hostname with a 198.18.0.0/15
// address AND an IPv6 twin from the benchmarking block 2001:2::/48 (its
// default fake-ip-range6). OpenClaw's tools.web.fetch.ssrfPolicy
// .allowRfc2544BenchmarkRange only opens the IPv4 half, so with that option on
// web_fetch still refused every public page ("resolves to private/internal/
// special-use IP address"). The same opt-in now also opens 2001:2::/48 — the
// IPv6 benchmarking range of the same RFC family. Nothing changes while the
// option is off; loopback, private, link-local and metadata ranges stay blocked.

const IP_MARKER = '/* pinkie-fake-ip-benchmark-v6:ip:v1 */';
const SSRF_MARKER = '/* pinkie-fake-ip-benchmark-v6:ssrf:v1 */';

export function transformIp(source) {
  if (source.includes(IP_MARKER)) return {changed: false, reason: 'already-patched', text: source};
  const anchor = '\tif (range === "uniqueLocal" && options.allowUniqueLocalRange === true) return false;\n';
  if (!source.includes('function isBlockedSpecialUseIpv6Address(address, options = {}) {\n\tconst range = address.range();\n' + anchor)
      || source.split(anchor).length !== 2) return {changed: false, reason: 'unsupported-runtime', text: source};
  return {changed: true, reason: 'patched', text: source.replace(anchor,
    anchor + `\tif (range === "benchmarking" && options.allowBenchmarkingRange === true) return false; ${IP_MARKER}\n`)};
}

export function transformSsrf(source) {
  if (source.includes(SSRF_MARKER)) return {changed: false, reason: 'already-patched', text: source};
  const anchor = 'function resolveIpv6SpecialUseBlockOptions(policy) {\n\treturn { allowUniqueLocalRange: policy?.allowIpv6UniqueLocalRange === true };\n}';
  if (source.split(anchor).length !== 2) return {changed: false, reason: 'unsupported-runtime', text: source};
  return {changed: true, reason: 'patched', text: source.replace(anchor,
    'function resolveIpv6SpecialUseBlockOptions(policy) {\n\treturn {\n\t\tallowUniqueLocalRange: policy?.allowIpv6UniqueLocalRange === true,\n'
    + `\t\tallowBenchmarkingRange: policy?.allowRfc2544BenchmarkRange === true ${SSRF_MARKER}\n\t};\n}`)};
}

// CLI: OPENCLAW_ROOT=<openclaw package> node patch/apply-fake-ip-benchmark-v6.mjs
import {applyDist as pinkieApplyDist} from './lib-apply-dist.mjs';
import {fileURLToPath as pinkieFileURL} from 'node:url';
import pinkiePath from 'node:path';
if (process.argv[1] && pinkiePath.resolve(process.argv[1]) === pinkieFileURL(import.meta.url)) {
  if (!process.env.OPENCLAW_ROOT) throw new Error('Set OPENCLAW_ROOT to the active OpenClaw package');
  console.log(JSON.stringify(pinkieApplyDist(process.env.OPENCLAW_ROOT, 'fake-ip-benchmark-v6', [transformIp, transformSsrf])));
}

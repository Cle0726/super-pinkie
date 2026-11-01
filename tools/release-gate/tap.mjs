// Interpret Node's TAP output without mistaking skipped tests for passes.
export function outcomes({file, code, output}) {
  const passed = new Set(), failed = new Set(), skipped = new Set();
  for (const line of output.split('\n')) {
    const match = /^\s*(ok|not ok) \d+ - (.+?)(?: # (.*))?$/.exec(line);
    if (!match) continue;
    const key = `${file} :: ${match[2].trim()}`;
    if (match[3]?.startsWith('SKIP')) skipped.add(key);
    else if (match[1] === 'not ok') failed.add(key);
    else passed.add(key);
  }
  if (code !== 0 && failed.size === 0) failed.add(`${file} :: <file failed>`);
  return {passed, failed, skipped};
}

export function appliesToPlatform(entry, platform) {
  return typeof entry === 'string' || entry.platforms.includes(platform);
}

// 把检查结果写成先生和碧琪都看得懂的话：哪一块、什么问题、怎么改。
export function slotLabel(template, slotName) {
  if (!slotName) return '某一块';
  const base = String(slotName).split('[')[0];
  const slot = template.slots?.[base];
  if (!slot) return slotName;
  const m = String(slotName).match(/\[(\d+)\]\.?(.*)$/);
  if (m) {
    const field = slot.item?.[m[2]]?.label;
    return `${slot.label || base}第 ${m[1]} 条${field ? `的${field}` : ''}`;
  }
  return slot.label || base;
}

export function describe(template, issue) {
  const name = `「${slotLabel(template, issue.slot)}」`;
  switch (issue.kind) {
    case 'overflow': return `${name}字太多：这里大约放得下 ${issue.fit} 个字，现在 ${issue.chars} 个字，请删短。`;
    case 'tiny': return `${name}缩到 ${issue.size}px，手机上看不清（至少 ${issue.min}px），请删短。`;
    case 'contrast': return `${name}和底色对比不够（${issue.ratio}，至少要 ${issue.need}），换一套配色，或者让字压在色块上。`;
    case 'outside': return `${name}跑出画面了，请删短。`;
    case 'overlap': return `${name}和「${slotLabel(template, issue.other)}」叠在一起了，请删短其中一个。`;
    case 'font': return `${name}的字体（${issue.family}）没加载上：再跑一次；还不行先跑 pinkie-make doctor。`;
    case 'image-broken': return `${name}的图片打不开，换一张 jpg / png / webp。`;
    case 'missing': return `${name}是必填的，content 里还没写。`;
    case 'unknown': return `content 里的「${issue.slot}」这个模板没有对应的位置，不会显示（模板的位置：${issue.known}）。`;
    case 'too-long': return `${name}写了 ${issue.chars} 个字，建议不超过 ${issue.max} 个字。`;
    case 'too-many': return `${name}写了 ${issue.count} 条，这个模板最多放 ${issue.max} 条，多出的没有显示。`;
    case 'image-missing': return `${name}的图片文件找不到：${issue.path}`;
    default: return `${name}：${issue.kind}`;
  }
}

// 只有这些算「没过」；too-long 是提醒（真放不下会报 overflow）。
export const BLOCKING = new Set(['overflow', 'tiny', 'contrast', 'outside', 'overlap', 'font', 'image-broken', 'missing', 'image-missing', 'too-many']);

export function summarize(template, issues) {
  const blocking = issues.filter(i => BLOCKING.has(i.kind));
  const notes = issues.filter(i => !BLOCKING.has(i.kind));
  const lines = [];
  if (!blocking.length) lines.push('检查：全部通过 ✓');
  else {
    lines.push(`检查：有 ${blocking.length} 处要改 ✗`);
    blocking.forEach((i, n) => lines.push(`  ${n + 1}. ${describe(template, i)}`));
  }
  notes.forEach(i => lines.push(`  提醒：${describe(template, i)}`));
  return {ok: !blocking.length, lines};
}

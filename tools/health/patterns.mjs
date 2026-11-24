// M0 返工 L4：手写源码里绕开字面写法的计数。只做静态文本匹配，不执行代码。
// 每个指标只数旧口径数不到的写法，所以加进来不会抬高任何已有数字。
const ID = '[\\p{ID_Continue}$]';
const token = name => new RegExp(`(?<!${ID})${name}(?!${ID})`, 'gu');
const count = (text, pattern) => [...text.matchAll(pattern)].length;

function skipString(text, i) {
  const quote = text[i];
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') j++;
    else if (text[j] === quote) return j;
    else if (quote === '`' && text[j] === '$' && text[j + 1] === '{') {
      let depth = 0;
      for (j++; j < text.length; j++) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}' && --depth === 0) break;
      }
    }
  }
  return text.length;
}

// 从 open（左括号的位置）起按括号、引号和注释配对，切出顶层参数；配不上就返回 null。
export function callArguments(text, open) {
  const args = [];
  let depth = 0, start = open + 1;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') i = skipString(text, i);
    else if (c === '/' && text[i + 1] === '*') i = text.includes('*/', i + 2) ? text.indexOf('*/', i + 2) + 1 : text.length;
    else if (c === '/' && text[i + 1] === '/') i = text.includes('\n', i) ? text.indexOf('\n', i) : text.length;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (--depth === 0) {
        args.push(text.slice(start, i));
        const trimmed = args.map(arg => arg.trim());
        return trimmed.filter((arg, k) => arg || k < trimmed.length - 1);
      }
    } else if (c === ',' && depth === 1) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return null;
}

// CSS 标识符：字母或转义（\69、\0069 后可跟一个空白；\o 即 o）。JS 字符串里的 \\69 同样当转义。
function cssIdentifier(text, i) {
  let out = '';
  while (i < text.length && out.length < 16) {
    const c = text[i];
    if (/[a-z]/i.test(c)) { out += c; i++; continue; }
    if (c !== '\\') break;
    while (text[i] === '\\') i++;
    const hex = /^[0-9a-f]{1,6}/i.exec(text.slice(i, i + 6));
    if (hex) {
      const code = parseInt(hex[0], 16);
      if (code > 0x10ffff) break;
      out += String.fromCodePoint(code);
      i += hex[0].length;
      if (/[ \t\n\f]/.test(text[i] ?? '')) i++;
    } else if (i < text.length && text[i] !== '\n') {
      out += text[i++];
    } else break;
  }
  return out;
}

// `!` 后隔着注释、或用转义写出的 important（字面 `!important`、`! important` 由旧口径数）。
function hiddenImportant(text) {
  let total = 0;
  for (let at = text.indexOf('!'); at !== -1; at = text.indexOf('!', at + 1)) {
    if (/^!\s*important\b/i.test(text.slice(at, at + 64))) continue;
    let i = at + 1;
    for (;;) {
      while (/\s/.test(text[i] ?? '')) i++;
      if (!text.startsWith('/*', i) || !text.includes('*/', i + 2)) break;
      i = text.indexOf('*/', i + 2) + 2;
    }
    if (cssIdentifier(text, i).toLowerCase() === 'important') total++;
  }
  return total;
}

// style.setProperty(name, value, 'important')，含 ?.()、['setProperty'](...) 和值为 'important' 的常量。
function setPropertyImportant(text) {
  const priorities = new Set([...text.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*(['"`])important\2/gi)].map(m => m[1]));
  let total = 0;
  for (const m of text.matchAll(/(?:\.\s*setProperty|\[\s*(['"`])setProperty\1\s*\])\s*(?:\?\.\s*)?\(/g)) {
    const args = callArguments(text, m.index + m[0].length - 1);
    if (args?.some(arg => /^(['"`])important\1$/i.test(arg) || priorities.has(arg))) total++;
  }
  return total;
}

// observe 的选项看不出是不是监听子树：选项是变量/调用、带展开或计算键、subtree 不是字面布尔，或 observe.call/apply。
function unclearObserveCalls(text) {
  let total = 0;
  const calls = /(?:\.\s*observe|\[\s*(['"`])observe\1\s*\])\s*(?:\?\.\s*)?\(|\.\s*observe\s*\.\s*(?:call|apply)\s*\(/g;
  for (const m of text.matchAll(calls)) {
    if (/(?:call|apply)\s*\($/.test(m[0])) { total++; continue; }
    const args = callArguments(text, m.index + m[0].length - 1);
    if (!args || args.length < 2) continue;
    const options = args[1];
    if (!options.startsWith('{') || !options.endsWith('}')) { total++; continue; }
    const body = options.slice(1, -1);
    if (/\.\.\.|(?:^|,)\s*\[/.test(body) || /(?:^|,)\s*subtree\s*(?:,|$)/.test(body)) { total++; continue; }
    const subtree = /(?:^|,)\s*(?:subtree|(['"`])subtree\1)\s*:\s*([^,]*)/.exec(body);
    if (subtree && !/^(?:true|false|!\s*[01]|0)$/.test(subtree[2].trim())) total++;
  }
  return total;
}

// window.__x = 以外挂 __ 全局名的写法：globalThis/self/top/parent.__x =、window['__x'] =、
// ||= ??= &&=、Object.defineProperty / Reflect.set / Object.assign(window, {...})。只数直接写法没数到的名字。
function indirectGlobalNames(text, direct) {
  const names = new Set();
  const NAME = `(__${ID}+)`;
  const ASSIGN = '\\s*(?:\\|\\||&&|\\?\\?)?=(?!=|>)';
  const patterns = [
    new RegExp(`\\b(?:globalThis|self|top|parent)\\s*\\.\\s*${NAME}${ASSIGN}`, 'gu'),
    new RegExp(`\\b(?:window|globalThis|self|top|parent)\\s*(?:\\?\\.)?\\s*\\[\\s*(['"\`])${NAME}\\1\\s*\\]${ASSIGN}`, 'gu'),
    new RegExp(`\\bwindow\\s*\\.\\s*${NAME}\\s*(?:\\|\\||&&|\\?\\?)=`, 'gu'),
    new RegExp(`\\b(?:Object\\s*\\.\\s*defineProperty|Reflect\\s*\\.\\s*(?:set|defineProperty))\\s*\\(\\s*(?:window|globalThis|self)\\s*,\\s*(['"\`])${NAME}\\1`, 'gu'),
  ];
  for (const pattern of patterns) for (const m of text.matchAll(pattern)) names.add(m[m.length - 1]);
  for (const m of text.matchAll(/\bObject\s*\.\s*(?:assign|defineProperties)\s*\(\s*(?:window|globalThis|self)\s*,\s*\{([^{}]*)/g)) {
    for (const key of m[1].matchAll(new RegExp(`(?:^|,)\\s*(['"\`]?)${NAME}\\1\\s*(?=[:,]|$)`, 'gu'))) names.add(key[2]);
  }
  for (const name of direct) names.delete(name);
  return names.size;
}

export function indirectMetrics(text, {mutationObservers, setIntervals}, directGlobals) {
  return {
    importantIndirect: hiddenImportant(text) + setPropertyImportant(text),
    mutationObserverRefs: Math.max(0, count(text, token('(?:WebKit)?MutationObserver')) - mutationObservers),
    observeUnclear: unclearObserveCalls(text),
    setIntervalRefs: Math.max(0, count(text, token('setInterval')) - setIntervals),
    windowGlobalsIndirect: indirectGlobalNames(text, directGlobals),
  };
}

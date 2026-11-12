// 目录和搜索：按一句话需求找模板。不靠分词库：中文按两字切片，加一张常用说法的同义词表。
import fs from 'node:fs';
import path from 'node:path';
import {SKILL_ROOT, homePaths} from './paths.mjs';

export const FAMILY_LABELS = {
  social: '社媒图（小红书 / 朋友圈 / 公众号）', poster: '海报', shop: '店铺物料', occasion: '人情物料（请柬 / 贺卡）',
  certificate: '证书 / 名片 / 工牌', ecommerce: '电商图', infographic: '信息图 / 长图', diagram: '图解',
  slides: 'PPT', document: 'Word / 公文', resume: '简历', print: '打印件', kids: '儿童教育', data: '数据图表',
  web: '网页', blocks: '网页积木', showcase: '3D / 互动展示', game: '小游戏', app: '小程序 / App / AI 应用',
  video: '视频', audio: '音频', photo: '照片处理', generator: '图形生成器', writing: '写作', ideas: '点子和策划',
  automation: '自动化', publish: '发布', learning: '学习',
};

// 常用说法 → 目录里的词。左边出现在需求里，就把右边也加进去一起搜。
const SYNONYMS = [
  [['小红书', '红书', 'xhs', '笔记封面'], ['小红书', '封面', '社媒']],
  [['朋友圈', '九宫格'], ['朋友圈', '社媒']],
  [['公众号', '头图', '推文'], ['公众号', '社媒']],
  [['抖音', '视频号', '快手'], ['抖音', '竖屏']],
  [['奶茶', '咖啡', '茶饮', '饮品', '甜品', '蛋糕', '面包', '烘焙'], ['餐饮', '饮品', '甜品']],
  [['饭店', '餐厅', '小吃', '火锅', '烧烤', '外卖', '菜'], ['餐饮', '美食']],
  [['打折', '优惠', '满减', '特价', '促销', '大促', '双十一', '618'], ['促销', '优惠']],
  [['开业', '开张', '新店'], ['开业']],
  [['招聘', '招人', '招募'], ['招聘']],
  [['课程', '讲座', '培训', '分享会', '公开课'], ['课程', '讲座', '教育']],
  [['干货', '攻略', '教程', '清单', '指南', '技巧', '方法'], ['干货', '清单', '攻略']],
  [['探店', '打卡', '推荐', '种草', '好物', '测评'], ['种草', '探店', '好物']],
  [['旅行', '旅游', '出游', '游记', '景点'], ['旅行']],
  [['读书', '书单', '阅读'], ['读书']],
  [['学习', '考试', '备考', '考研', '自律', '打卡'], ['学习']],
  [['减肥', '健身', '运动', '瘦'], ['健身', '运动']],
  [['穿搭', 'ootd', '衣服'], ['穿搭']],
  [['化妆', '美妆', '护肤', '口红'], ['美妆']],
  [['宝宝', '母婴', '育儿', '孩子'], ['母婴', '儿童']],
  [['猫', '狗', '宠物', '萌宠'], ['萌宠']],
  [['语录', '金句', '一句话', '情绪', '文案'], ['语录', '情绪']],
  [['对比', '前后', '改造', '之前之后'], ['对比']],
  [['春节', '过年', '新年', '元旦', '中秋', '端午', '节气', '国风', '国潮', '古风'], ['国风', '节日']],
  [['婚礼', '结婚', '请柬', '喜帖'], ['婚礼', '请柬']],
  [['生日', '派对'], ['生日', '派对']],
  [['ppt', '幻灯片', '汇报', '演示', '路演', '答辩', '述职'], ['PPT', '汇报']],
  [['简历', '求职'], ['简历']],
  [['海报', '宣传'], ['海报']],
  [['数据', '图表', '统计'], ['数据', '图表']],
];

function bigrams(text) {
  const s = String(text || '').toLowerCase().replace(/[\s，。、！？,.!?：:；;「」“”"'（）()【】\[\]·\-—_/]+/g, ' ');
  const out = new Set();
  for (const part of s.split(' ').filter(Boolean)) {
    if (/^[a-z0-9]+$/.test(part)) { out.add(part); continue; }
    const chars = [...part];
    if (chars.length === 1) out.add(chars[0]);
    for (let i = 0; i < chars.length - 1; i++) out.add(chars[i] + chars[i + 1]);
  }
  return out;
}

function expand(query) {
  const q = String(query || '').toLowerCase();
  const extra = [];
  for (const [keys, adds] of SYNONYMS) if (keys.some(k => q.includes(k.toLowerCase()))) extra.push(...adds);
  return `${query} ${extra.join(' ')}`;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function templateRoots() {
  return [{root: path.join(SKILL_ROOT, 'families'), mine: false}, {root: homePaths().mine, mine: true}];
}

export function listTemplates() {
  const list = [];
  for (const {root, mine} of templateRoots()) {
    if (!fs.existsSync(root)) continue;
    const walk = (dir, depth) => {
      const file = path.join(dir, 'template.json');
      if (fs.existsSync(file)) {
        const t = readJson(file);
        if (t?.id) list.push({...t, dir, mine});
        return;
      }
      if (depth > 2) return;
      for (const name of fs.readdirSync(dir)) {
        const sub = path.join(dir, name);
        if (fs.statSync(sub).isDirectory()) walk(sub, depth + 1);
      }
    };
    walk(root, 0);
  }
  // 先生自己的模板和官方同名时，先生的优先。
  const byId = new Map();
  for (const t of list) if (!byId.has(t.id) || t.mine) byId.set(t.id, t);
  return [...byId.values()];
}

export function findTemplate(id) {
  const t = listTemplates().find(x => x.id === id);
  if (!t) {
    const near = search(id, {limit: 5}).map(x => x.id).join('、');
    throw new Error(`没有叫「${id}」的模板${near ? `。是不是：${near}` : ''}`);
  }
  return t;
}

export function search(query, {family, kind, limit = 8} = {}) {
  const grams = bigrams(expand(query));
  let pool = listTemplates();
  if (family) pool = pool.filter(t => t.family === family);
  if (kind) pool = pool.filter(t => (t.kinds || []).includes(kind));
  const scored = pool.map(t => {
    const fields = [
      [t.name, 3], [(t.scenes || []).join(' '), 4], [(t.keywords || []).join(' '), 3], [(t.moods || []).join(' '), 2],
      [FAMILY_LABELS[t.family] || t.family, 2], [t.summary, 1],
    ];
    let score = 0;
    for (const [text, weight] of fields) {
      const g = bigrams(text);
      for (const x of grams) if (g.has(x)) score += weight;
    }
    if (t.mine) score += 2;
    return {t, score};
  });
  scored.sort((a, b) => b.score - a.score || (a.t.order ?? 99) - (b.t.order ?? 99));
  let hits = scored.filter(s => s.score > 0);
  if (!hits.length) hits = scored; // 不会返回零个：至少给出同家族 / 全部里排前面的
  return hits.slice(0, limit).map(s => ({...s.t, score: s.score}));
}

// 形态技能表（v4 第二批）：写进 services/mode-architecture/learning-game-forms.json 的每个形态的 skill 字段。幂等。
// 用法：node tools/study-game/art/forms-v4-skills.mjs
// kind：eliminate 排除两个错项 · heal 回 1 颗心 · shield 下一次答错不掉心不断连击 · double 下一题答对星星翻倍。cost = 要连着攒几道答对。
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const file = fileURLToPath(new URL('../../../services/mode-architecture/learning-game-forms.json', import.meta.url));
export const SKILLS = {
  daily: ['heal', '打气', 5], unrestricted: ['double', '彩虹共鸣', 4], alicorn: ['heal', '日光祝福', 4], crystal: ['shield', '水晶折光', 4],
  seapony: ['heal', '潮汐', 5], kirin: ['double', '麒麟火', 4], batpony: ['eliminate', '回声定位', 4], serious: ['eliminate', '较真', 5],
  breezie: ['shield', '顺风', 4], changeling: ['shield', '拟态', 3], lidong: ['heal', '一杯热茶', 5], detective: ['eliminate', '推理', 4],
  pirate: ['double', '双份宝藏', 4], astronaut: ['shield', '舱外护罩', 4], knight: ['shield', '举盾', 4, {hearts: 1}], 'magical-girl': ['heal', '治愈之光', 4],
  zhuangyuan: ['eliminate', '破题', 3], cyber: ['eliminate', '全频扫描', 4], ninja: ['shield', '替身术', 5], chef: ['heal', '甜点时间', 5],
  idol: ['double', '安可', 4], astrologer: ['eliminate', '观星', 3], xiaoxue: ['heal', '围炉', 5], graduate: ['double', '上岸', 3],
};
const TEXT = {
  eliminate: n => `连对 ${n} 题攒满：这道选择题排除两个错项`,
  heal: n => `连对 ${n} 题攒满：回 1 颗心`,
  shield: n => `连对 ${n} 题攒满：下一次答错不掉心、不断连击`,
  double: n => `连对 ${n} 题攒满：下一题答对星星翻倍`,
};
// v4 重画回归的 12 个形态：来源、换装 / 变身、一句话造型。只有美术入了库（manifest 里有 portrait + avatar）的才上架，其余保持下架。
export const RETURN = {
  pirate: [['shop', 'gacha-star', 'gacha-seal'], 'outfit', '酒红三角帽插大粉羽、鬃毛编成一条粗辫、金扣船长外套、胸前挂铜望远镜'],
  astronaut: [['gacha-star', 'gacha-seal'], 'outfit', '珍珠白配玫粉的宇航服、透明球形头盔、卷毛在头盔里失重飘起'],
  knight: [['shop', 'gacha-star'], 'outfit', '玫瑰金板甲、露脸头盔、鬃毛从盔顶冲成一束高马尾、绯红短披风'],
  'magical-girl': [['gacha-star', 'gacha-seal'], 'transform', '星星缎带扎的双马尾、发尾渐变成发光的淡紫、背后一对光之缎带翼、心形宝石胸针'],
  zhuangyuan: [['seal-shop', 'gacha-seal'], 'outfit', '大红金云纹圆领袍、簪金花的乌纱帽、胸前大红绸花、鬃毛盘成高髻留两缕卷鬓'],
  cyber: [['gacha-star', 'gacha-seal'], 'outfit', '侧分不对称卷发里有青与粉的荧光发丝、黑色机能短外套、推到额头的透明护目镜、颈挂耳机'],
  ninja: [['shop', 'gacha-star'], 'outfit', '靛蓝忍装配洋红腰带、面罩拉到颈间、护额、鬃毛扎成高马尾'],
  chef: [['shop', 'gacha-star'], 'outfit', '白色双排扣甜点师服、高帽下两团蓬蓬的丸子头、粉格领巾、鼻尖一点面粉'],
  idol: [['shop', 'gacha-seal'], 'outfit', '星星发夹扎的高侧马尾、白粉亮片打歌服、背后大蝴蝶结、耳麦'],
  astrologer: [['gacha-star', 'gacha-seal'], 'transform', '鬃毛和尾巴变成缓缓流动的星砂（洋红渐变到深蓝）、银河里衬的午夜蓝斗篷、新月额饰、星盘吊坠'],
  xiaoxue: [['limited:xiaoxue'], 'outfit', '冰蓝白毛领短斗篷、红绳扎的两条低辫、雪花发簪和一小枝红果、白绒短靴'],
  graduate: [['achievement:realPass'], 'outfit', '藏青学位袍配粉缎兜帽、金穗学位帽、鬃毛梳成顺滑的侧分波浪、粉绶带金奖章'],
};
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
let n = 0;
{
  const manifest = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../../ui/assets/study-game/manifest.json', import.meta.url)), 'utf8')).slots;
  const live = [];
  for (const f of data.forms) {
    const r = RETURN[f.id]; if (!r) continue;
    const ready = ['portrait', 'ult', 'icon', 'avatar', 'cheer', 'hurt'].every(k => manifest[`form/${f.id}/${k}`]);
    if (!ready) continue;
    const [source, look, form] = r;
    delete f.retired; f.season1 = true; f.source = source; f.look = look; f.form = form; f.series = f.series === 'season' || f.series === 'honor' ? f.series : 'v4';
    f.art = {portrait: `form/${f.id}/portrait`, ult: `form/${f.id}/ult`, icon: `form/${f.id}/icon`, avatar: `form/${f.id}/avatar`, idle: `form/${f.id}/idle`, ...(manifest[`form/${f.id}/plate`] ? {stage: `form/${f.id}/plate`} : {})};
    live.push(f.id);
  }
  console.log('returned:', live.join(', ') || '(none yet)');
}
for (const f of data.forms) {
  const s = SKILLS[f.id]; if (!s) continue;
  const [kind, name, cost, extra = {}] = s;
  const text = TEXT[kind](cost).replace('连对', '答对') + (extra.hearts ? `；多 ${extra.hearts} 颗心` : '');
  const next = {kind, name, cost, text, ...extra};
  if (JSON.stringify(f.skill) !== JSON.stringify(next)) { f.skill = next; n += 1; }
}
fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
console.log('skills written:', n);

#!/usr/bin/env node
// 生成 services/mode-architecture/learning-game-forms.json（形态 + 外观商品目录）。改数据改这里再跑。
import {writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../../services/mode-architecture/learning-game-forms.json');

// [id, 名字, 系列, 稀有度, 来源[], palette, particle, hit, ult, sound, bonus, awaken, season?, extra?]
// source: start / shop / gacha-star / gacha-seal / seal-shop / limited:<term> / boss:<id> / achievement:<stat>
const F = [
  ['daily', '日常碧琪', 'mode', 'N', ['start'], ['#F7A8C8', '#DB1F74', '#FFE36E'], 'confetti', 'pop', 'burst', 'bubbly', {kind: 'firstSetStars', add: 10, text: '元气：每天第一组 +10 ⭐'}, {stat: 'streak', count: 7, text: '连续盖章 7 天'}],
  ['learning', '学习碧琪', 'mode', 'R', ['shop', 'gacha-star'], ['#F4B6D2', '#7A3E9D', '#FFD54F'], 'stars', 'stamp', 'stamp', 'chime', {kind: 'lessonStarsPct', pct: 0.3, text: '好学：学习关 ⭐ +30%'}, {stat: 'nodesLit', count: 15, text: '点亮 15 个节点'}],
  ['project', '项目碧琪', 'mode', 'R', ['shop', 'gacha-star'], ['#F6C1D6', '#2F6FB0', '#F2B33D'], 'gold', 'stamp', 'stamp', 'click', {kind: 'questStarsPct', pct: 0.5, text: '计划通：委托 ⭐ +50%'}, {stat: 'questsDone', count: 20, text: '完成 20 个委托'}],
  ['thinking', '思考碧琪', 'mode', 'SR', ['shop'], ['#E9C6F2', '#5B3FA8', '#8FE3FF'], 'crystal', 'shard', 'spell', 'glass', {kind: 'writeStarsMul', mul: 1.5, text: '深想：默写 / 挖空 ⭐ ×1.5'}, {stat: 'writePerfectSets', count: 3, text: '默写全对 3 组'}],
  ['unrestricted', '无限制碧琪', 'mode', 'SR', ['shop'], ['#FF8FC7', '#7B5CFF', '#3DE0C8'], 'confetti', 'rainbow', 'warp', 'synth', {kind: 'comboStarsMul', mul: 2, noPerfect: true, text: '狂欢：连击奖 ×2，但本组没有全对奖'}, {stat: 'maxCombo', count: 30, text: '一组连击 30'}],
  ['detective', '名侦探碧琪', 'mystery', 'SR', ['shop', 'gacha-star', 'gacha-seal'], ['#E8C9A0', '#7A2E4F', '#F6EEE6'], 'cards', 'lens', 'curtain', 'pluck', {kind: 'captureStarsPct', pct: 0.4, text: '推理：收服错题怪 ⭐ +40%'}, {stat: 'captures', count: 30, text: '收服 30 只'}],
  ['pirate', '海盗船长碧琪', 'mystery', 'SR', ['shop'], ['#F2C14E', '#3A2A35', '#DB1F74'], 'coins', 'coin', 'rain', 'brass', {kind: 'dailyShelfExtra', add: 1, text: '寻宝：每日货架多 1 格'}, {stat: 'regionsLit', count: 1, text: '点亮一整个区'}],
  ['astronaut', '宇航员碧琪', 'mystery', 'SR', ['shop'], ['#F7B6D2', '#1B2A5C', '#9AD8FF'], 'stars', 'ping', 'warp', 'sine', {kind: 'streakStarsPct', pct: 0.5, text: '远航：连续盖章奖励 +50%'}, {stat: 'streak', count: 21, text: '连续盖章 21 天'}],
  ['dragon-rider', '龙骑士碧琪', 'mystery', 'exclusive', ['boss:babel'], ['#FF9EC4', '#B23A48', '#FFB347'], 'embers', 'flame', 'beam', 'roar', {kind: 'examSealsAdd', add: 1, text: '屠龙：考试 🟡 +1'}, {stat: 'examBest', count: 85, text: '考试 ≥ 85 分'}],
  ['queen', '女王碧琪', 'royal', 'SSR', ['seal-shop', 'gacha-seal'], ['#C8102E', '#F2C14E', '#FFF4E0'], 'gold', 'carpet', 'curtain', 'fanfare', {kind: 'guardExamSealsAdd', add: 1, text: '王权：守关战 / 考试 🟡 +1'}, {stat: 'guardPerfect', count: 3, text: '守关战满分 3 次'}],
  ['princess', '公主碧琪', 'royal', 'SR', ['shop', 'gacha-star', 'gacha-seal'], ['#FFC2DD', '#E85A9B', '#FFF1A8'], 'petals', 'sparkle', 'rain', 'harp', {kind: 'streakMilestoneMul', mul: 2, text: '被宠爱：连续盖章里程碑奖励 ×2'}, {stat: 'streak', count: 14, text: '连续盖章 14 天'}],
  ['knight', '骑士碧琪', 'royal', 'SR', ['gacha-star', 'gacha-seal'], ['#F7A8C8', '#8C9BB0', '#FFE36E'], 'lightning', 'slash', 'slash', 'steel', {kind: 'huntStarsPct', pct: 0.5, text: '守护：讨伐打赢 ⭐ +50%'}, {stat: 'huntWins', count: 50, text: '讨伐打赢 50 次'}],
  ['chef', '甜点师碧琪', 'royal', 'R', ['shop', 'gacha-star'], ['#FFF4E0', '#F48FB1', '#8D5B3E'], 'confetti', 'sprinkle', 'rain', 'pop', {kind: 'setFinishAdd', add: 3, text: '出炉：一组完成奖 +3'}, {stat: 'setsDone', count: 50, text: '完成 50 组'}],
  ['magical-girl', '魔法少女碧琪', 'magic', 'SSR', ['gacha-star', 'gacha-seal'], ['#FF6FAE', '#FFD1E8', '#B388FF'], 'hearts', 'heart', 'spell', 'twinkle', {kind: 'ultThreshold', value: 8, text: '变身：大招门槛连击 10 → 8'}, {stat: 'ults', count: 30, text: '触发大招 30 次'}],
  ['astrologer', '星砂占星师碧琪', 'magic', 'SSR', ['seal-shop', 'gacha-seal'], ['#1F1B4D', '#B9A4FF', '#FFE6A8'], 'crystal', 'constellation', 'warp', 'celesta', {kind: 'comboStepAdd', add: 2, text: '星图：连击每满 5 再 +2 ⭐'}, {stat: 'combo20Sets', count: 5, text: '一组连击 20 ×5'}],
  ['zhuangyuan', '古风状元碧琪', 'east', 'SSR', ['seal-shop', 'gacha-seal'], ['#C8102E', '#1F1A17', '#F2C14E'], 'ink', 'brush', 'ink', 'guzheng', {kind: 'examStarsPct', pct: 0.3, text: '金榜：考试交卷 ⭐ +30%'}, {stat: 'examsSafe', count: 3, text: '考试 3 次 ≥ 稳过线'}],
  ['idol', '偶像碧琪', 'stage', 'SR', ['gacha-star', 'gacha-seal'], ['#FF8AC2', '#7C4DFF', '#FFFFFF'], 'hearts', 'glow', 'curtain', 'pop', {kind: 'chestExtra', add: 1, text: '应援：委托宝箱每天多开一次'}, {stat: 'dailyQuests', count: 30, text: '完成 30 个每日委托'}],
  ['cyber', '赛博荧光碧琪', 'tech', 'SR', ['shop'], ['#0E0B1F', '#FF3EA5', '#38F2FF'], 'neon', 'glitch', 'beam', 'synth', {kind: 'notesStarsPct', pct: 0.25, text: '高亮：笔记背诵 ⭐ +25%'}, {stat: 'notesDrilled', count: 200, text: '背完 200 条笔记'}],
  ['ninja', '忍者碧琪', 'tech', 'R', ['gacha-star'], ['#F7A8C8', '#2B2340', '#E0E0E0'], 'smoke', 'shuriken', 'slash', 'whoosh', {kind: 'perfectSetAdd', add: 5, text: '疾：一组全对 +5 ⭐'}, {stat: 'perfectSets', count: 20, text: '全对 20 组'}],
  ['lidong', '立冬碧琪', 'season', 'limited', ['limited:lidong'], ['#C62828', '#FFF4E0', '#BFE3FF'], 'snow', 'steam', 'rain', 'bell', {kind: 'firstSetStars', add: 15, text: '暖冬：每天第一组 +15 ⭐'}, {stat: 'streak', count: 10, text: '连续盖章 10 天'}, 'lidong'],
  ['xiaoxue', '小雪碧琪', 'season', 'limited', ['limited:xiaoxue'], ['#E3F2FD', '#F48FB1', '#90A4AE'], 'snow', 'flake', 'rain', 'bell', {kind: 'huntStarsPct', pct: 0.3, text: '小雪：讨伐 ⭐ +30%'}, {stat: 'captures', count: 15, text: '收服 15 只'}, 'xiaoxue'],
  ['daxue', '大雪碧琪', 'season', 'limited', ['limited:daxue'], ['#0D1B3E', '#7FFFD4', '#FFC1E3'], 'snow', 'aurora', 'warp', 'bell', {kind: 'streakStarsPct', pct: 0.5, text: '大雪：连续盖章奖励 +50%'}, {stat: 'streak', count: 14, text: '连续盖章 14 天'}, 'daxue'],
  ['graduate', '毕业碧琪', 'honor', 'exclusive', ['achievement:realPass'], ['#1A1A2E', '#F2C14E', '#F7A8C8'], 'confetti', 'stamp', 'burst', 'fanfare', {kind: 'none', text: '纪念：毕业证书（外观）'}, {stat: 'realPass', count: 1, text: 'B 级真实分数 ≥ 60'}],
  ['gold-master', '金章大师碧琪', 'honor', 'exclusive', ['achievement:allGold'], ['#F2C14E', '#DB1F74', '#FFF8E1'], 'gold', 'stamp', 'stamp', 'fanfare', {kind: 'none', text: '荣耀：金色描边（外观）'}, {stat: 'allGold', count: 1, text: '第一卷全部节点金章'}],
];

const forms = F.map(([id, name, series, rarity, source, palette, particle, hit, ult, sound, bonus, awaken, season]) => ({
  id, name, series, rarity, source, palette, particle, hit, ult, sound, bonus, awaken,
  ...(season ? {season} : {}),
  art: {portrait: `form/${id}/portrait`, ult: `form/${id}/ult`, icon: `form/${id}/icon`, idle: `form/${id}/idle`},
  season1: true,
}));

// 外观商品（特效包 / 粒子 / 大招过场 / 结算动画 / 书封 / 贴纸包 / 称号）。presets 都是 A 的引擎已有预设。
const items = [];
const addItem = (kind, id, name, extra = {}) => items.push({kind, id: `${kind}:${id}`, name, ...extra});
[['ink', '红笔批注'], ['star', '星光一击'], ['bubble', '泡泡啪'], ['petal', '花瓣扫过'], ['neon', '霓虹划线'], ['stamp', '印章咚']].forEach(([id, name]) => addItem('hit', id, name, {preset: id}));
[['sakura', '樱花纸片', 'petals'], ['snowfall', '纸雪', 'snow'], ['firefly', '萤火纸灯', 'embers'], ['galaxy', '星砂', 'stars'], ['notes', '音符飞舞', 'notes'], ['coins', '金币叮当', 'coins']].forEach(([id, name, p]) => addItem('particles', id, name, {preset: p}));
[['curtain', '舞台幕布', 'curtain'], ['ink', '水墨晕开', 'ink'], ['warp', '星空跃迁', 'warp'], ['stamp', '金印砸下', 'stamp']].forEach(([id, name, p]) => addItem('ult', id, name, {preset: p}));
[['fireworks', '纸烟花'], ['ribbon', '彩带横幅'], ['stamp-rain', '印章雨'], ['popup', '立体书弹开']].forEach(([id, name]) => addItem('result', id, name, {preset: id}));
[['sakura', '樱花书封'], ['night', '星夜书封'], ['kraft', '牛皮纸书封'], ['palace', '宫廷书封', {set: 'royal', notForSale: true}], ['ink', '水墨书封', {set: 'east'}], ['winter', '初冬书封', {season: 'lidong'}]].forEach(([id, name, extra]) => addItem('cover', id, name, extra || {}));
for (let i = 1; i <= 8; i += 1) addItem('stickers', `pack${i}`, `贴纸包 ${i}`);
[['early-bird', '早起的鸟'], ['night-owl', '夜读猫头鹰'], ['combo-king', '连击王'], ['monster-friend', '小怪的朋友'], ['ink-lover', '红笔达人'], ['shore-seeker', '寻岸人'], ['star-hoarder', '囤星星的人'], ['steady', '稳稳的'], ['comeback', '回来啦'], ['bookworm', '书虫'], ['planner', '计划家'], ['lucky', '欧气满满']].forEach(([id, name]) => addItem('title', id, name));
// 套装奖励（不卖）
addItem('title', 'royal-family', '王室全员', {reward: 'set:royal', notForSale: true});
addItem('title', 'five-faces', '五面碧琪', {reward: 'set:mode', notForSale: true});

const sets = [
  {id: 'royal', name: '皇家系列', forms: ['queen', 'princess', 'knight', 'chef'], rewards: ['title:royal-family', 'cover:palace']},
  {id: 'mode', name: '模式系列', forms: ['daily', 'learning', 'project', 'thinking', 'unrestricted'], rewards: ['title:five-faces']},
];

writeFileSync(out, JSON.stringify({version: 1, forms, items, sets}, null, 1) + '\n');
console.log(forms.length, 'forms', items.length, 'items');

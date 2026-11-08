#!/usr/bin/env node
// 生成 art-slots.json（槽位清单 + 提示词模板）。改提示词改这里，再跑 `node slots-src.mjs`。
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const PONY = 'the pink pony shown in the attached reference images (bright pink body, voluminous curly magenta-pink mane and tail, big blue eyes, a cutie mark of exactly three balloons — one yellow, two blue — on her flank)';
const STYLE = 'Keep exactly the same flat cartoon style as the references: clean bold dark-magenta outlines, flat bright colors, minimal soft cel shading, cute, warm and friendly. Original costume design — do not copy any specific character from any existing franchise.';
const DIECUT = 'Papercraft stand-up treatment: the whole figure and props are surrounded by one continuous thick clean WHITE die-cut border (about 8px at 512px size) with a very subtle soft grey drop shadow, like a pop-up-book paper figure / planner sticker. Isolated on a fully transparent background (if transparency is impossible, use plain flat pure white).';
const NOTEXT = 'No text, no letters, no numbers, no watermark, no frame, no background scenery.';

const templates = {
  portrait: {
    refs: ['refs/ref-face.png', 'refs/ref-body.png'],
    text: `Use case: full-body character portrait for a study game (碧琪上岸记). Character: ${PONY}. ${STYLE}
Costume and pose: {desc}
{extra}
Full body, standing in a confident lively three-quarter pose, all four hooves visible, the balloon cutie mark visible. Square 1024x1024 composition, character centered with generous margin, nothing cropped.
${DIECUT}
${NOTEXT}`,
  },
  ult: {
    refs: ['refs/ref-face.png', 'refs/ref-body.png'],
    text: `Use case: full-screen "ultimate move" cinematic key art for a study game, landscape 1536x1024. Character: ${PONY}. ${STYLE}
Scene: {desc}
{extra}
Cinematic composition: low camera angle, strong rim backlight, dynamic diagonal, speed lines or magic light, rich but readable background in the same flat cartoon style, character large in frame (left or right third) leaving some calm space on the other side. No text, no letters, no numbers, no watermark, no UI.`,
  },
  monster: {
    refs: ['refs/ref-face.png'],
    text: `Use case: enemy creature for a cute study game — a "mistake monster" born from a wrong answer. Use the reference image ONLY for line and color style (bold dark outlines, flat colors, minimal cel shading); the creature is NOT a pony.
Creature: {desc}
{extra}
Round, chubby, cute-not-scary papercraft little monster with big expressive eyes and a mischievous-but-harmless expression, readable silhouette, one main color plus one accent. Square 1024x1024, centered, generous margin, nothing cropped.
${DIECUT}
${NOTEXT}`,
  },
  boss: {
    refs: ['refs/ref-face.png'],
    text: `Use case: boss creature for a cute study game, landscape 1536x1024. Use the reference image ONLY for line and color style (bold dark outlines, flat bright colors, minimal cel shading).
Boss "Babel Beast": a big, majestic-but-cute guardian beast built from stacked hardcover books and wooden alphabet blocks, carrying a small spiral tower on its back (a tiny tower of Babel made of books), glowing pink-gold letter runes on its body (abstract glyph shapes, not readable words), round friendly face with big eyes.
State: {desc}
{extra}
Whole creature visible with margin. ${DIECUT}
No readable text, no watermark, no frame, no background scenery.`,
  },
  layer: {
    refs: [],
    text: `Use case: one layer of a pop-up book diorama for a study game; layers are stacked in 3D, so this layer must be isolated on a fully TRANSPARENT background with nothing outside the cut-paper shapes.
Style: handmade layered paper-cut / papercraft pop-up book, visible paper grain and slightly rough deckled edges, warm studio lighting, soft shadows, palette of cream paper #F6EEE6, ink plum #3A2A35 and accents of pink #DB1F74 plus the region colors given below. Cozy, whimsical, premium.
Region and layer: {desc}
{extra}
Landscape 1536x1024. No characters, no text, no letters, no numbers, no watermark.`,
  },
  scene: {
    refs: [],
    text: `Use case: background scene for a study game, handmade papercraft pop-up diorama style: layered paper-cut shapes, visible paper grain and deckled edges, warm studio lighting, shallow depth of field. Palette cream paper #F6EEE6, ink plum #3A2A35, pink accents #DB1F74.
Scene: {desc}
{extra}
Landscape 1536x1024, full-bleed (opaque background). No characters, no text, no letters, no numbers, no watermark.`,
  },
  sticker: {
    refs: ['refs/ref-face.png', 'refs/ref-body.png'],
    text: `Use case: die-cut character sticker for a study-planner app (碧琪手账). Character: ${PONY}. ${STYLE}
Scene: {desc}
{extra}
Sticker treatment: the whole character and its props are surrounded by one continuous thick clean WHITE die-cut border (about 8px at 512px size) with a very subtle soft grey drop shadow, like a vinyl planner sticker. Isolated on a fully transparent background. Square 1024x1024 composition, character centered with generous margin, whole sticker visible, nothing cropped.
${NOTEXT}`,
  },
};

const slots = [];
const add = (prio, slot, template, desc, extra = '') => slots.push({ prio, slot, template, desc, extra });

// ① 当季 + 推理 / 皇家主角
const P = {
  lidong: 'Beginning-of-Winter look: a long cozy red knitted scarf wrapped around the neck, holding a steaming mug of ginger tea with both front hooves, the very first snowflake resting on top of her curly mane, rosy cheeks, gentle happy smile.',
  detective: 'Great-detective look: a pink-and-cream houndstooth deerstalker-style cap, short caped coat in plum, holding a big brass magnifying glass up to one eye (the eye looks huge through the lens), a swirl lollipop held like a pipe, clever smug grin.',
  queen: 'Queen look: an ornate golden crown with pink gems, a long flowing red velvet cape with white fur trim, a golden scepter topped with a balloon-shaped jewel, golden horseshoes, chin raised in a proud but sweet regal pose.',
  princess: 'Princess look: a small sparkly tiara, a fluffy layered pastel-pink ball gown with ruffles and tiny stars, holding a star-tipped magic wand, twirling happily with sparkles.',
  pirate: 'Pirate-captain look: a plum tricorne hat with a pink feather, a captain coat with gold buttons, holding a rolled treasure map that looks like an open pop-up book, a spyglass tucked under the arm, adventurous grin (no eyepatch, no skull symbols).',
  astronaut: 'Astronaut look: a rounded pink spacesuit with white panels, a clear bubble helmet with her curly mane floating weightlessly inside, a small star patch, floating pose with a few tiny stars around.',
  'dragon-rider': 'Dragon-rider look: light pink knight-ish riding armor, riding on the back of a small chubby friendly pink baby dragon with tiny wings (dragon is cute, round, and fully visible), both looking heroic.',
  knight: 'Knight look: shiny rose-pink plate armor, a round shield decorated with three balloons, a short blunt practice sword raised, brave determined smile, helmet visor pushed up.',
  chef: 'Pastry-chef look: a tall white chef hat, a frilly apron with sprinkles, holding a piping bag in one hoof and a big cupcake with swirly frosting in the other, frosting smudge on her nose.',
  'magical-girl': 'Magical-girl look: a big pink bow, a sparkly transformation outfit with ribbons and a heart brooch, holding a magic wand shaped like a giant red marking pen with a heart tip, ribbons of light swirling around her.',
  astrologer: 'Star-sand astrologer look: a deep indigo star-map cloak with constellation patterns, holding a crystal compass astrolabe like a staff with a glowing crystal, tiny floating star particles, mysterious gentle smile.',
  zhuangyuan: 'Ancient-Chinese top-scholar (状元) look: a red scholar robe with gold trim, a black scholar hat with two flat wings, a big calligraphy brush held proudly, a red ribbon flower on the chest.',
  idol: 'Idol singer look: a sparkly stage outfit with a short pleated skirt, a headset microphone, holding a glowing pink light stick, winking with one hoof raised.',
  cyber: 'Cyber-neon look: glowing visor goggles, a sleek techwear jacket with neon pink and cyan lines, holding a big glowing neon highlighter pen leaving a light trail.',
  ninja: 'Ninja look: a pink ninja outfit with a scarf tail, holding a scroll, a few soft round paper shuriken stars, crouched in a playful sneaky pose.',
  xiaoxue: 'Light-Snow look: a knitted pom-pom beanie and mittens, standing next to a small cheerful snowman buddy, gentle snowflakes around.',
  daxue: 'Heavy-Snow look: a thick hooded winter cloak with fur trim, pulling a small wooden sled, a faint aurora ribbon swirl above her head.',
  graduate: 'Graduate look: a square graduation cap with tassel, a graduation gown, holding a rolled diploma tube with a ribbon, proud teary happy smile.',
  'gold-master': 'Gold-master look: her outline glows with a gold rim light, a row of shiny gold medal stamps pinned across her chest like a sash, a golden laurel hair clip, triumphant pose.',
};
for (const id of ['lidong', 'detective', 'queen', 'princess']) add(1, `form/${id}/portrait`, 'portrait', P[id]);

// ② 16 只错题怪 + 巴别兽
const M = {
  'ink-slime': ['迷糊史莱姆 (grammar): a wobbly round ink-blot slime, plum-purple with a pink sheen, droopy confused eyes, a little ink drip on top like a hair curl.'],
  bookworm: ['书虫 (reading): a chubby green caterpillar-like bookworm peeking out of a hole bitten through a small book, big round glasses.'],
  'lost-crane': ['迷路纸鹤 (translation): a folded origami paper crane with a dizzy spiral in its eyes, pale blue paper, one wing folded the wrong way.'],
  'inkpot-imp': ['墨水瓶小鬼 (writing): a small round glass inkpot creature with tiny arms, a feather quill stuck in its lid like a hat, splashing a little ink.'],
  'echo-bat': ['回声蝙蝠 (listening): a round fluffy paper bat with giant floppy ears and tiny sound-wave curls around them, lavender color.'],
  'block-golem': ['字母积木魔像 (vocabulary): a tiny stocky golem made of three stacked wooden toy blocks with blank faces painted as eyes, warm wood and pink.'],
  'tangle-yarn': ['时态毛线团 (grammar, tenses): a round ball of tangled pink-orange yarn with stubby legs, eyes peeking through the tangles.'],
  'eraser-gnome': ['橡皮小精灵 (writing): a squishy pink rubber-eraser creature with a little paper-sleeve hat, rubbing crumbs off itself.'],
  'sticky-ghost': ['便利贴幽灵 (vocabulary): a floating ghost made of a curled yellow sticky note, wavy tail, blank sticky-note body, shy blush.'],
  'quiz-shroom': ['题目蘑菇 (vocabulary forest): a plump red-capped mushroom with cream spots shaped like question-mark curls, puzzled face, tiny feet.'],
  'shell-crab': ['海螺小蟹 (listening port): a small round hermit crab living in a spiral seashell that looks like an ear, cupping a claw to listen.'],
  'clock-beetle': ['时钟甲虫 (grammar, tenses): a round beetle whose shell is an alarm-clock face with no numbers, two clock hands as antennae, sleepy eyes.'],
  'bridge-troll': ['小桥怪 (translation bridge): a tiny chubby moss-green troll holding a little wooden plank, cute underbite with one tooth, grumpy-cute.'],
  'paper-fox': ['纸狐 (reading library): a folded origami fox with a tiny bookmark ribbon tail, sly smile, orange and cream paper.'],
  'fog-puff': ['迷雾团 (forgetting fog): a soft round grey-lavender cloud puff with sleepy eyes, wisps trailing, slightly translucent edges.'],
  'shaving-hog': ['卷笔刀刺猬 (writing tower): a round hedgehog whose spikes are colored pencil tips and curly pencil shavings, holding a pencil sharpener.'],
};
for (const [id, [d]] of Object.entries(M)) add(2, `monster/${id}`, 'monster', d);
add(2, 'boss/babel/full', 'boss', 'Full health: standing tall and proud, runes glowing brightly, tower upright, confident playful roar pose.');
add(2, 'boss/babel/hurt', 'boss', 'Hurt: wobbling, a few book pages flying loose, some blocks cracked, runes flickering, sweat drop, still determined.');
add(2, 'boss/babel/broken', 'boss', 'Defeated/broken guard: lying down flat on its belly, tower tilted sideways, little dizzy stars and swirls circling its head, smiling sheepishly, books spilled around.');
add(2, 'boss/babel/portrait', 'monster', 'Head-and-shoulders portrait of the "Babel Beast": a cute majestic guardian beast made of stacked hardcover books and alphabet blocks, a tiny spiral book tower on its head, glowing pink-gold abstract rune glyphs, big friendly eyes.');

// ③ B 级卷 6 区 × 4 层 + 书 + 营地 + 考场
const R = {
  listening: ['听力港 Listening Harbor', 'a cozy paper harbor with a lighthouse whose lamp is a big gramophone horn, small paper boats, sound-wave shaped waves, seagull silhouettes; region colors sea teal and sunrise peach'],
  vocab: ['词汇森林 Vocabulary Forest', 'a whimsical paper forest where tree leaves are tiny flash cards, mushrooms, a winding path; region colors leaf green and honey yellow'],
  grammar: ['语法工坊 Grammar Workshop', 'a cute paper workshop with gears, cogs, workbenches, sentence-building blocks and little conveyor belts; region colors copper orange and slate blue'],
  reading: ['阅读图书馆 Reading Library', 'a grand cozy paper library with towering bookshelves, a spiral staircase, warm reading lamps, floating open books; region colors burgundy and warm gold'],
  translation: ['翻译桥 Translation Bridge', 'an elegant arched paper bridge connecting a Chinese garden side (pagoda, willow) and a Western town side (clock tower, cottages) over a calm river; region colors jade and brick red'],
  writing: ['写作塔 Writing Tower', 'a tall whimsical tower shaped like a fountain pen and stacked notebooks, ink-cloud swirls, paper airplanes circling; region colors indigo ink and pink'],
};
const LAYER = {
  bg: 'BACK layer (far background): distant skyline / sky shapes and soft hills of the region, low contrast, misty.',
  mg: 'MIDDLE layer: the main landmark of the region, centered, clear iconic silhouette.',
  fg: 'FRONT layer: foreground framing elements along the bottom and both side edges (foliage, props, small details), leaving the center open.',
  base: 'GROUND / base board: a top-down-ish ground plate for the diorama (path, grass, water or floor appropriate to the region) filling the lower 60% of the frame as an organic paper shape, transparent above.',
};
for (const [rid, [name, d]] of Object.entries(R)) {
  for (const [lid, ld] of Object.entries(LAYER)) add(3, `world/pretco-b/${rid}/${lid}`, 'layer', `${name}: ${d}. ${ld}`);
}
add(3, 'world/book/cover', 'scene', 'The cover of a magical hardcover study journal "the Book of Reaching the Shore": pink fabric cover, gold foil corner ornaments, a ribbon bookmark, a small balloon-shaped emblem embossed in the center, lying on a wooden desk, viewed from above.');
add(3, 'world/book/page', 'scene', 'A seamless, tileable texture of thick cream journal paper with subtle grain, faint fibers and very light ruled lines, flat even lighting, viewed straight on, edge-to-edge (no book edges).');
add(3, 'camp/day', 'scene', "A cozy papercraft study camp at daytime: a small round tent-like cottage made of notebook pages, bunting flags, a desk with books, a campfire with paper flames, a signpost, a distant mountain with a castle on top (the goal), sunny warm light. Leave the center-left foreground open for a character to stand.", 'Landscape 2560x1440 feel (render 1536x1024).');
add(3, 'camp/night', 'scene', 'The same cozy papercraft study camp at night: deep indigo sky with paper stars, warm lamp light glowing from the cottage windows, campfire glow, fireflies made of paper dots, the distant castle with lit windows. Leave the center-left foreground open for a character to stand.');
add(3, 'exam/hall', 'scene', 'A quiet calm exam hall in muted papercraft: neat rows of wooden desks, a big clock on the wall without numbers, tall windows with soft daylight, low saturation, very calm and focused atmosphere.');

// ④ 其余 ★ 形态立绘
for (const id of ['pirate', 'astronaut', 'dragon-rider', 'knight', 'chef', 'magical-girl', 'astrologer', 'zhuangyuan', 'idol', 'cyber', 'ninja', 'xiaoxue', 'daxue', 'graduate', 'gold-master']) add(4, `form/${id}/portrait`, 'portrait', P[id]);

// ⑤ 24 张大招立绘
const U = {
  daily: 'Confetti party burst: she leaps toward the camera from an exploding party cannon, rainbow confetti and balloons everywhere.',
  learning: 'She slams down a giant golden approval stamp onto an open notebook, a shockwave of stars bursting out.',
  project: 'She stands on a stack of finished project folders as a giant golden checklist stamp crashes down behind her, golden sparks.',
  thinking: 'Deep-thought spell: she floats in front of a huge glowing crystal magic circle with geometric runes, eyes closed, crystals orbiting.',
  unrestricted: 'Rainbow warp: she rides a rainbow streak through a starfield tunnel at hyperspeed, rainbow confetti trails.',
  detective: 'Spotlight reveal: dark stage, a single dramatic spotlight on her pointing forward with the magnifying glass, glowing clue threads connecting pinned notes behind her.',
  pirate: 'Treasure rain: on the deck of a paper ship at sunset, she raises the treasure map as gold coins rain from the sky.',
  astronaut: 'Warp jump: she launches through a swirling galaxy portal, stars stretching into light streaks.',
  'dragon-rider': 'Dragon breath: riding the pink baby dragon in the sky as it breathes a huge beam of warm pink-gold fire.',
  queen: 'Royal entrance: curtains part on a grand stage, a red carpet shockwave rolls toward the camera, she stands under golden spotlights with the scepter raised.',
  princess: 'Rose-petal rain: she twirls in a moonlit castle garden as a storm of pink rose petals and sparkles pours down.',
  knight: 'Lightning slash: she swings her blunt practice sword leaving a giant crescent of pink lightning across the frame.',
  chef: 'Sprinkle storm: a giant cupcake erupts like a volcano of colorful sugar sprinkles raining over a bakery kitchen.',
  'magical-girl': 'Transformation: she spins inside a pillar of ribbons and hearts, a huge heart magic circle beneath her.',
  astrologer: 'Starmap warp: she raises the crystal astrolabe, constellation lines connect across a deep indigo sky and a star-warp tunnel opens.',
  zhuangyuan: 'Ink-splash golden list: she swings the giant brush, a massive ink wash explodes across a scroll sky, a red-gold honor banner unfurls (no readable characters).',
  idol: 'Concert stage: she sings center stage, a sea of glowing light sticks in the crowd, heart-shaped spotlights.',
  cyber: 'Neon beam: she fires a beam of neon light from the giant highlighter across a cyber city skyline at night, glitch sparks.',
  ninja: 'Smoke dash: she dashes through a cloud of pink smoke leaving afterimages, soft paper shuriken stars flying.',
  lidong: 'First snow: she stands on a quiet winter street holding the ginger tea as the first heavy snowfall of the year begins, warm lantern light, steam rising.',
  xiaoxue: 'Snow shower: she and the snowman buddy throw up their arms as a gentle shower of big snowflakes swirls around them.',
  daxue: 'Aurora warp: sledding down a snowy hill under a huge rippling aurora that bends into a warp tunnel.',
  graduate: 'Graduation: she tosses the graduation cap high into a bright sky, confetti and paper airplanes everywhere.',
  'gold-master': 'Gold stamp: she slams a giant gold medal stamp down, a golden shockwave lights up a pop-up-book world behind her.',
};
for (const [id, d] of Object.entries(U)) {
  const costume = P[id] ? ` Costume: ${P[id]}` : ` Costume: her look in the attached mode reference image.`;
  const refs = P[id] ? null : ['refs/ref-face.png', id === 'daily' ? 'refs/ref-body.png' : `refs/mode-${id}.png`];
  slots.push({ prio: 5, slot: `form/${id}/ult`, template: 'ult', desc: d + costume, extra: '', ...(refs ? { refs } : {}) });
}

// ⑦ 欠下的 7 张贴纸
const S = {
  cheer: 'jumping up joyfully holding a big red pen, drawing a check mark in the air.',
  oops: 'holding a pink eraser, sticking her tongue out with a sheepish laugh, "no big deal" vibe.',
  combo: 'hugging an armful of glowing golden stars, beaming.',
  focus: 'resting her chin on one hoof, nibbling the end of a pencil, concentrating.',
  finish: 'proudly holding up a big rubber stamp with a heart pattern, ready to stamp.',
  jar: 'hugging a glass jar overflowing with little golden stars.',
  leave: 'politely handing over a small pink folded note card with a little heart seal, warm smile.',
};
for (const [id, d] of Object.entries(S)) add(7, `sticker/${id}`, 'sticker', d);

writeFileSync(join(here, 'art-slots.json'), JSON.stringify({ version: 1, templates, slots }, null, 1) + '\n');
console.log(`${slots.length} slots`);

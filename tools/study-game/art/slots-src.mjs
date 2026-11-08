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
    text: `Use case: premium cinematic "ultimate skill" cut-in key art for a study game, landscape 1536x1024, opaque. Character: ${PONY}. Keep her exactly on-model in the reference style (bold outlines, flat colors).
Scene: {desc}
{extra}
Composition (strict): medium shot from a slightly low camera; her face exactly at the horizontal center with her eyes about 40% down from the top edge; head and chest fill the central third; left and right thirds are background only; nothing important in the top or bottom 15%.
Lighting: low-key and fairly dark so white titles read on top; one strong rim light / backlight; volumetric light shafts, haze, background depth with soft depth-of-field blur. Restrained grading on the given palette plus white; no rainbow, confetti, cartoon stars, hearts or sticker sparkles. Mature and cinematic, not childish. No text, letters, numbers, watermark or UI.`,
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

// ⑤ 24 张大招立绘（11-08 v2：大厂电影感、克制配色、脸在水平中间距顶约 40%——前端斜切条带按这个取景，见 VFX.md §4）
// 网页版 ChatGPT 不带参考图，所以 web 提示词里用文字把碧琪写清楚；costume 是网页版用的简写。
const ULT_COSTUME = {
  daily: 'her classic look (no costume)',
  learning: 'a yellow pencil tucked behind her ear, holding a purple notebook with a star on the cover',
  project: 'a pencil behind her ear, a rolled checklist scroll',
  thinking: 'no costume, a calm focused expression',
  unrestricted: 'rainbow-streaked mane (pink, yellow, blue stripes) and a blue bow with a yellow star',
  detective: 'a pink-and-cream houndstooth deerstalker-style cap, short plum caped coat, a big brass magnifying glass',
  pirate: 'a plum tricorne hat with a pink feather, captain coat with gold buttons, a treasure map (no eyepatch, no skulls)',
  astronaut: 'a rounded pink spacesuit with white panels and a clear bubble helmet with her curly mane floating inside',
  'dragon-rider': 'light pink riding armor, riding a small chubby friendly pink baby dragon with tiny wings',
  queen: 'an ornate golden crown with pink gems, a long red velvet cape with white fur trim, a golden scepter topped with a balloon-shaped jewel',
  princess: 'a small sparkly tiara and a fluffy layered pastel-pink ball gown, a star-tipped wand',
  knight: 'shiny rose-pink plate armor, a round shield with three balloons, a short blunt practice sword, helmet visor pushed up',
  chef: 'a tall white chef hat, a frilly apron, holding a big swirly-frosted cupcake',
  'magical-girl': 'a big pink bow, a transformation outfit with ribbons and a heart brooch, a wand shaped like a giant red marker pen',
  astrologer: 'a deep indigo star-map cloak with constellation patterns, a crystal astrolabe staff',
  zhuangyuan: 'an ancient-Chinese top-scholar red robe with gold trim, a black scholar hat with two flat wings, a giant calligraphy brush',
  idol: 'a sparkly idol stage outfit, a headset microphone, a glowing pink light stick',
  cyber: 'glowing visor goggles pushed up on her forehead, a sleek techwear jacket with neon pink and cyan lines, a giant glowing highlighter pen',
  ninja: 'a pink ninja outfit with a long scarf tail',
  lidong: 'a long cozy red knitted scarf, holding a steaming mug of ginger tea',
  xiaoxue: 'a knitted pom-pom beanie and mittens, a small cheerful snowman buddy beside her',
  daxue: 'a thick hooded winter cloak with fur trim, on a small wooden sled',
  graduate: 'a square graduation cap with tassel and a graduation gown',
  'gold-master': 'a sash of shiny gold medal stamps across her chest and a golden laurel hair clip',
};
const U = {
  daily: ['Party-cannon release: she bursts toward the viewer out of a dark warm room as a single golden party-cannon blast flares behind her; a few soft out-of-focus balloon bokeh shapes far behind', 'rose pink, deep magenta and warm gold'],
  learning: ['She brings a giant golden approval stamp down onto an open notebook in a quiet study at night; a ring of golden light blooms up from the page and backlights her', 'plum purple, warm gold and soft pink'],
  project: ['She stands on top of a tall stack of finished project folders in a dim blue office at dusk, a huge amber checklist-stamp glow rising behind her like a sunrise', 'deep blue, amber gold and pale pink'],
  thinking: ['Deep-thought spell: eyes closed, she hovers before a vast thin-line crystal magic circle of geometric runes; slow orbiting crystal shards catch cyan light in a dark violet void', 'deep violet, ice cyan and lavender'],
  unrestricted: ['Warp: she dives forward through a dark hyperspace tunnel of thin streaking light lines converging behind her head', 'electric violet, teal and pink'],
  detective: ['Reveal: a dark study at night lit by one hard spotlight from above-behind; she stands at an old desk and raises the brass magnifying glass toward the viewer, thin glowing red clue threads link blank pinned cards in the shadowy background', 'wine plum, warm tan and cream'],
  pirate: ['On a ship deck at dusk she raises the open treasure map; gold coins fall in slow motion through the low golden sun backlight, sails in silhouette against a dark plum sky', 'ink plum, old gold and a magenta accent'],
  astronaut: ['She floats before the dark curve of a huge navy planet, a swirling warp portal opening behind her, starlight stretched into thin lines', 'deep navy, ice blue and pale pink'],
  'dragon-rider': ['Riding the chubby pink baby dragon above dark storm clouds at sunset as it breathes a long beam of amber fire out of frame to the side; embers drifting', 'crimson, amber ember and pink'],
  queen: ['Royal entrance: a dark throne hall, heavy crimson curtains parting, one golden spotlight from above; she stands tall with the scepter raised, cape flowing, gold dust in the light shaft', 'crimson, gold and ivory'],
  princess: ['A moonlit castle balcony at night; she twirls as a slow storm of rose petals swirls through a pale moonbeam', 'rose, blush pink and pale moon gold over deep blue-violet night'],
  knight: ['Mid-swing of her blunt practice sword in a dark stone courtyard at night, one thin crescent of white-gold light trailing the blade, rain-wet stones reflecting', 'steel blue-grey, gold and rose pink'],
  chef: ['A night bakery kitchen lit by a warm oven glow from behind; she lifts the giant frosted cupcake as a fine cascade of sugar sprinkles falls through the backlight', 'chocolate brown, strawberry pink and cream'],
  'magical-girl': ['Transformation: she rises inside a column of thin glowing ribbons of light above a fine-line magic circle in a dark lilac void', 'hot pink, lilac and pale pink'],
  astrologer: ['On an observatory rooftop under a deep midnight sky she raises the crystal astrolabe; thin gold constellation lines connect across the sky', 'midnight indigo, lavender and starlight gold'],
  zhuangyuan: ['On a misty ink-wash landscape at dusk she swings the giant calligraphy brush; one huge black ink stroke sweeps across the sky behind her and a vermilion silk banner (blank, no characters) unfurls', 'vermilion, ink black and gold'],
  idol: ['Center stage in a dark arena under one white spotlight from above, a sea of soft pink light-stick bokeh in the dark crowd below; she sings into the headset with one hoof raised', 'violet, pink and white'],
  cyber: ['A rain-soaked rooftop in a dark cyber city at night; holding the giant glowing highlighter like a pen (clearly a chunky marker pen with a cap, not a gun), she draws one thin neon line that slashes across the frame; wet reflections', 'near-black, neon pink and cyan'],
  ninja: ['A night bamboo forest under a pale moon; she dashes forward through a thin swirl of smoke leaving two faint afterimages', 'dark plum, moon silver and pink'],
  lidong: ['A quiet winter street at blue hour as the first snow of the year begins; warm lantern light behind her, steam rising from the ginger tea, snowflakes in soft focus', 'scarf red, warm lantern cream and ice blue'],
  xiaoxue: ['A still snowy field at dusk with her snowman buddy small beside her; big snowflakes drift through a cold backlight', 'slate grey-blue, snow white and a pink accent'],
  daxue: ['Night: she sleds toward the viewer down a snowy slope under a vast rippling aquamarine aurora that bends into a tunnel behind her', 'navy, aquamarine and soft pink'],
  graduate: ['Graduation night on a stone terrace; she tosses her cap upward into a dark navy sky as a golden backlight bursts from behind her', 'dark navy, gold and pink'],
  'gold-master': ['She slams a giant gold medal stamp down; a ring shockwave of golden light spreads across a dark pop-up-book landscape behind her', 'gold, deep magenta and ivory'],
};
const ULT_WEB = (moment, costume, palette) => `Please generate an image, landscape 1536x1024, full-bleed opaque. Premium cinematic key art, the quality of a top-tier anime game character ultimate-skill cut-in splash. Fan-art of Pinkie Pie, the pink earth pony from My Little Pony: Friendship is Magic, kept exactly on-model in the show's clean flat vector style: bold dark-magenta outlines, flat colors, big blue eyes, voluminous curly magenta-pink mane and tail, bright pink body, cutie mark of exactly three balloons (one yellow, two blue). Costume: ${costume}. Moment: ${moment}.
Composition (strict): medium shot from a slightly low camera. Her face sits exactly at the horizontal center of the image with her eyes about 40% down from the top edge; her head and chest fill the central third; the left and right thirds are background only; nothing important in the top 15% or bottom 15%.
Lighting and mood: low-key and fairly dark overall so white titles read on top; one strong rim light / backlight outlining her silhouette; volumetric light shafts and atmospheric haze; a background with real depth and soft depth-of-field blur; she is fully part of the scene (grounded and lit by the same light), not a cut-out pasted on the background. Restrained color grading built only on ${palette} plus white. No rainbow colors, no confetti, no cartoon stars, no hearts, no sparkle stickers, no speed-line clutter. Mature, elegant, cinematic, not childish.
No text, letters, numbers, logos, watermark, frame or UI.`;
for (const [id, [moment, palette]] of Object.entries(U)) {
  const costume = ULT_COSTUME[id];
  const refs = P[id] ? null : ['refs/ref-face.png', id === 'daily' ? 'refs/ref-body.png' : `refs/mode-${id}.png`];
  slots.push({ prio: 5, slot: `form/${id}/ult`, template: 'ult', desc: `${moment}. Costume: ${costume}. Palette: ${palette}.`, extra: '', web: ULT_WEB(moment, costume, palette), ...(refs ? { refs } : {}) });
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

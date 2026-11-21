// 形态 v4（Windows 侧）：把 12 个下架的贴纸风形态重画成和 v3 一样的电影感立绘。
// 用法：node tools/study-game/art/forms-v4-src.mjs hero   > 写 <art>/v4/jobs-forms-hero.json
//       node tools/study-game/art/forms-v4-src.mjs poses  > 写 <art>/v4/jobs-forms-poses.json（要先有 hero）
// 然后 node tools/study-game/art/gpt-web-batch.mjs <jobs.json> --parallel=4；出完用 ingest-forms-v4.py 入库。
// 提示词的骨架照 v3/prompts.json（Mac 侧过审的那一版），只换形态和场景。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const ART = path.resolve(process.env.STUDY_GAME_ART || path.join(repo, '../super-pinkie-handoff/art/study-game'));
const RAW = path.join(ART, 'v4', 'raw', 'forms');
const REFS = ['v2h-alicorn.jpg', 'v2h-crystal.jpg'].map(f => path.join(ART, 'refs', f));

const ID = "Please generate an image. The character is Pinkie Pie (fan art): a rose-pink pony with big glossy sky-blue eyes, a voluminous curly magenta mane and tail, and a cutie mark on her flank of exactly three balloons (one yellow, two blue). The attached images are approved key art of this same character in other transformed forms. They define the rendering style to match exactly: cinematic, movie-quality painterly art — soft painterly cel shading with real volume, thin dark-rose linework, glossy detailed eyes with layered highlights, sculpted curls with strand highlights, elegant slightly tall proportions, real lighting. Do NOT use the flat vector look of the TV show. Do NOT copy the horn, wings, crystal body or scenery of the references; only their rendering style and her identity.";
const ANAT = "Anatomy (strict): she is a quadruped pony with exactly FOUR legs ending in four hooves, all four visible. No hands, no fingers, no arms, no extra limbs; she does not hold or carry anything.";
const COMP = "Composition: landscape 1536x1024, full-bleed opaque scene. Her WHOLE body is visible (hooves to the tip of the mane and tail, nothing cropped), three-quarter view, in the right-center of the frame; the left 40% of the image is calmer background. Real depth: soft foreground elements out of focus, sharp character, atmospheric haze, a rim light that separates her silhouette from the background. Style rules: premium, elegant, cinematic key art for adult fans (around 20 years old). NOT a sticker: no white cut-out border, no outline around the silhouette. Not chibi, not toddler-like, no cartoon confetti, hearts or emoji-like stars. No text, letters, numbers, logo, watermark, frame or UI.";
const KEEP = "Please generate an image. The attached image is the approved art of this exact character in this exact form (Pinkie Pie fan art). Keep her identity and every form feature identical — species features, colours, mane and tail shape, hairstyle and material, wings / horn / antennae / fins / scales if she has them, every outfit piece she wears, cutie mark of three balloons (one yellow, two blue) — and the same painterly cinematic rendering quality.";
const POSE = "Composition: square 1024x1024, her whole body inside the frame with a comfortable margin on all sides, centered, three-quarter view, on a plain flat seamless light warm-grey background (#d9d1d5): no floor, no cast shadow, no scenery, no props, no particles, no glow outside her body. NOT a sticker: no white outline around her. Anatomy (strict): a quadruped pony with exactly FOUR legs ending in four hooves; no hands, no fingers, no arms, no extra limbs, she holds nothing. Premium and elegant, for adult fans; not chibi. No text, letters, logo or watermark.";

// look: 这个形态穿什么 / 变成什么；mood: 立绘的神态；scene: 场景；cheer / hurt: 两个反应姿势；blur: 头像背景的一句话
export const FORMS = {
  pirate: {
    look: "THEMED OUTFIT — the pirate captain. She is still an earth pony (no horn, no wings). She wears: a burgundy tricorne hat trimmed in gold with one huge curled pink ostrich feather; her curly mane is gathered into one thick loose braid that falls over her shoulder (her hairstyle is visibly different from usual); a burgundy captain's coat with gold buttons and gold fringed epaulettes, open at the chest over a cream ruffled cravat with a rose gem pin; a small brass spyglass hanging on a leather strap across her body (worn, not held).",
    mood: "A bold, adventurous grin, chin up, one front hoof planted on a coil of rope; standing on all four hooves.",
    scene: "the deck of a tall sailing ship at golden sunset: polished wooden planks, ropes and rigging, a brass lantern, billowing cream sails catching orange light, sea spray and a distant island on the horizon. Teal sea, burgundy and warm gold palette.",
    cheer: "a 'land ho!' triumph — rearing up with one front hoof raised high toward the horizon, coat tails and braid flying, a huge delighted laugh",
    hurt: "caught by a wave — stumbling back a step, tricorne hat knocked crooked with the feather drooping, ears back, a sheepish gritted-teeth grimace; not crying, not injured",
    blur: "a ship's deck at golden sunset with warm sails and sea light",
  },
  astronaut: {
    look: "THEMED OUTFIT — the astronaut. She is still an earth pony (no horn, no wings). She wears: a sleek pearl-white space suit with rose-pink panels and soft gold trim covering her body and all four legs down to round white boots; a small life-support pack on her back with a tiny blinking light; a large perfectly clear glass bubble helmet around her whole head, inside which her curly magenta mane floats weightlessly upward and outward like a cloud (her hairstyle is visibly different from usual); a small mission patch shaped like three balloons on her shoulder.",
    mood: "Wide-eyed wonder and a bright open smile, looking slightly up; standing on all four hooves in low gravity with one front hoof barely lifted.",
    scene: "the pale dusty surface of a moon with soft craters, her hoofprints behind her, a huge blue-and-white planet rising over the horizon, a field of sharp stars and a faint pink nebula. Deep navy, pearl white and rose palette with strong rim light from the planet.",
    cheer: "a zero-gravity leap of joy — floating a little off the ground with both front hooves thrown up, mane swirling inside the helmet, a huge laughing smile",
    hurt: "tumbling off balance in low gravity — tilted sideways, legs splayed awkwardly, eyes wide in a comic 'whoa', mouth in a wobbly worried line; not crying, not injured",
    blur: "deep space with a soft blue planet glow and distant stars",
  },
  knight: {
    look: "THEMED OUTFIT — the knight. She is still an earth pony (no horn, no wings). She wears: polished rose-gold plate armour with engraved balloon filigree — a chest plate, layered shoulder pauldrons, a back plate and four articulated leg greaves down to armoured hooves; an open-faced helm that leaves her whole face visible, from whose crest her curly mane bursts out as one tall magenta plume-like ponytail (her hairstyle is visibly different from usual); a short crimson cape fastened with a gold clasp; a small round shield strapped to her side (worn, not held).",
    mood: "A brave, steady smile with determined eyes, chest out; standing firmly on all four hooves.",
    scene: "a castle courtyard at dawn: tall stone walls, long crimson and gold banners moving in the wind, a drawbridge behind, low sun cutting through morning mist and catching the armour. Rose gold, crimson and cool stone-blue palette.",
    cheer: "a victorious salute — rearing up with one front hoof thrust proudly into the air, cape snapping behind her, plume flying, a beaming triumphant grin",
    hurt: "a clanging block gone wrong — braced low and skidding back a step, helm knocked askew over one eye, ears back, teeth gritted in a comic wince; not crying, not injured",
    blur: "a castle courtyard at dawn with crimson banners and warm mist",
  },
  'magical-girl': {
    look: "TRANSFORMATION — her magical girl form. Body transformation plus outfit: her mane is tied into two enormous bouncy twin-tails with big star-topped ribbons, and the curls fade from magenta at the roots to glowing lavender at the tips with tiny points of light inside them (her hairstyle is visibly different from usual); a pair of small translucent ribbon-shaped wings of light at her back; a frilled white-and-pink sailor collar with a large heart-cut rose gem brooch; a layered short tulle skirt in pink and lilac around her waist; ribbon wraps with little bows above each hoof; her eyes carry a star-shaped highlight.",
    mood: "A radiant, confident smile with one front hoof lifted in a graceful pose, as if the transformation has just finished; three hooves on the ground.",
    scene: "a city rooftop at night beneath an enormous full moon: ribbons of pink and lilac aurora, a skyline of tiny warm windows far below, drifting motes of light, a few glowing ribbons of magic curling through the air. Midnight blue, rose and lilac palette.",
    cheer: "a sparkling finishing pose — leaping lightly with one front hoof raised to the sky, twin-tails and ribbons swirling around her, a huge joyful open smile",
    hurt: "the spell fizzled — flinching back with twin-tails drooping and ribbons limp, one eye squeezed shut, a small embarrassed pout; not crying, not injured",
    blur: "a night sky with a giant soft moon and pink-lilac aurora",
  },
  zhuangyuan: {
    look: "THEMED OUTFIT — the ancient Chinese top scholar (zhuangyuan) on the day the results are posted. She is still an earth pony (no horn, no wings). She wears: a round-collared scarlet silk robe draped over her body, embroidered with fine gold cloud patterns, with a jade-studded belt; a black gauze scholar's hat with two long horizontal wings, decorated at the front with two golden flowers; a large red silk rosette with trailing ribbons on her chest; her curly mane is pinned up into a neat high bun under the hat with two soft curled sidelocks framing her face (her hairstyle is visibly different from usual); her tail is tied with a red silk cord.",
    mood: "A proud, glowing, slightly tearful-with-joy smile, head held high; standing on all four hooves.",
    scene: "the white marble steps of an ancient palace at sunrise: vermilion walls, golden glazed roof tiles, blossoming peach trees with petals drifting, long plain red silk banners (no writing) moving in the wind, warm golden haze. Scarlet, gold and soft peach palette.",
    cheer: "the moment her name tops the list — rearing up joyfully with one front hoof raised high, robe sleeves and ribbons flying, hat wings bouncing, an overjoyed open-mouthed laugh",
    hurt: "an ink blot on the answer sheet — shrinking back with the hat slipped forward over her brow, ears flattened, lips pressed in a comically mortified grimace; not crying, not injured",
    blur: "vermilion palace walls and golden roofs at sunrise with drifting peach petals",
  },
  cyber: {
    look: "THEMED OUTFIT — neon cyber runner. She is still an earth pony (no horn, no wings). Her curly mane is swept to one side in an asymmetric undercut style with glowing streaks of electric cyan and hot pink running through the magenta curls (her hairstyle is visibly different from usual). She wears: a cropped black techwear jacket with glowing pink piping and a high collar; a thin translucent cyan visor pushed up onto her forehead (her eyes fully visible); a pair of chunky headphones resting around her neck; glowing holographic bands around each leg above the hoof; a small glowing circuit pattern running along her tail.",
    mood: "A cool, playful smirk with one eyebrow raised, head tilted; standing on all four hooves with a relaxed confident stance.",
    scene: "a rain-slick back alley in a neon megacity at night: glowing abstract signs in pink and cyan (shapes only, no letters), steam from vents, puddles with crisp reflections, hanging cables, distant flying traffic lights. Black, hot pink and cyan palette.",
    cheer: "a system-cracked celebration — hopping up with one front hoof punching the air, headphones bouncing, glowing streaks in her mane flaring bright, a wide triumphant grin",
    hurt: "signal glitch — jolting back with the visor slipped down crooked over one eye, mane streaks flickering dim, a startled gritted-teeth wince; not crying, not injured",
    blur: "a rainy neon alley with pink and cyan lights melting into bokeh",
  },
  ninja: {
    look: "THEMED OUTFIT — the ninja. She is still an earth pony (no horn, no wings). She wears: a fitted deep-indigo shinobi wrap over her body with a magenta sash tied at the waist, its long ends trailing; a matching indigo cloth mask pulled DOWN around her neck like a scarf so her whole face is visible; a steel forehead protector band; cloth wraps around all four legs above the hooves; her curly mane is pulled into one high tight ponytail that bursts into curls at the end (her hairstyle is visibly different from usual).",
    mood: "A focused, mischievous half-smile, body lowered slightly in a ready stance; all four hooves on the ground.",
    scene: "the tiled roof of an old Japanese-style castle town under a huge pale moon: bamboo swaying, drifting maple leaves, paper lanterns glowing far below, thin night mist. Indigo, moon-silver and magenta palette.",
    cheer: "a perfect landing — springing up with one front hoof raised in a sharp victory sign-like pose, sash ends and ponytail whipping, a big delighted grin",
    hurt: "smoke bomb backfire — coughing and recoiling a step, forehead band slipped over one eye, ponytail frazzled, a comic squinting grimace; not crying, not injured",
    blur: "a moonlit rooftop night with bamboo shadows and distant warm lanterns",
  },
  chef: {
    look: "THEMED OUTFIT — the pastry chef. She is still an earth pony (no horn, no wings). She wears: a crisp white double-breasted pastry chef jacket with rose-pink buttons and piping; a tall pleated white toque, with her curly mane gathered into two round fluffy buns poofing out on either side beneath it (her hairstyle is visibly different from usual); a pink gingham neckerchief; a short pink apron tied in a big bow at her back; a dusting of flour on one cheek and on the tip of her nose.",
    mood: "A warm, proud, 'ta-da' smile with sparkling eyes; standing on all four hooves beside her work.",
    scene: "a bright Parisian-style patisserie kitchen in the morning: a marble counter with an elaborate tiered strawberry cake, rows of macarons and cream puffs softly out of focus, copper pans hanging, sunlight through tall windows catching floating flour dust. Cream, strawberry pink and copper palette.",
    cheer: "the cake came out perfect — bouncing up with one front hoof raised high in celebration, apron bow fluttering, toque wobbling, a huge delighted open smile",
    hurt: "the soufflé collapsed — flinching back with the toque flopped sideways, a puff of flour on her face, eyes wide and mouth in a wobbly dismayed line; not crying, not injured",
    blur: "a sunlit patisserie kitchen with copper pans and pastel cakes",
  },
  idol: {
    look: "THEMED OUTFIT — the stage idol. She is still an earth pony (no horn, no wings). Her curly mane is tied into one high bouncy side ponytail with a big star-shaped clip and scattered glitter (her hairstyle is visibly different from usual). She wears: a sparkling stage outfit in white and hot pink — a fitted bodice with a frilled layered short skirt around her waist and a big satin bow at the back with long ribbon tails; a slim headset microphone on her cheek; a ribbon choker with a small star charm; lace-trimmed ribbon cuffs above each hoof.",
    mood: "A dazzling wink and a radiant open smile toward the audience, one front hoof lifted in a pose; three hooves on the stage.",
    scene: "a huge concert stage seen from the stage itself: sweeping pink and white light beams through haze, a glossy reflective floor, an ocean of tiny glow-stick lights far out in the dark hall, falling metallic streamers softly out of focus. Hot pink, white and deep violet palette.",
    cheer: "the encore pose — leaping with one front hoof thrown up toward the lights, ponytail and ribbon tails flying, a huge sparkling laugh",
    hurt: "missed the cue — freezing mid-step with the headset mic slipped down, ponytail drooping, an embarrassed wobbly smile with one eye squeezed shut; not crying, not injured",
    blur: "a concert stage with pink light beams and a sea of tiny lights",
  },
  astrologer: {
    look: "TRANSFORMATION — her star-sand astrologer form. Body transformation plus outfit: her mane and tail have turned into slowly flowing star-sand — magenta at the roots darkening to deep violet and midnight blue toward the long drifting ends, with glittering grains and tiny constellations inside (her hairstyle is visibly longer and flowing, different from usual); a deep midnight-blue hooded cloak lined with a soft galaxy, the hood down on her shoulders, fastened by a gold crescent-moon clasp; a delicate gold circlet with a small crescent on her forehead; a brass astrolabe pendant on a chain at her chest; thin gold star-chart bands above each hoof.",
    mood: "A serene, knowing smile with half-lidded sparkling eyes, gazing up as if reading the sky; standing on all four hooves.",
    scene: "the inside of an ancient observatory whose great dome is open to a brilliant galaxy: a large brass orrery turning slowly, star charts and glass spheres softly out of focus, drifting golden star-sand in the air. Midnight blue, violet and antique gold palette.",
    cheer: "the stars aligned — rising up with one front hoof lifted toward the sky, cloak and star-sand mane swirling in a wide arc, a bright overjoyed smile",
    hurt: "a misread constellation — drawing back with the circlet slipped crooked, star-sand mane scattering messily, eyes wide and mouth in a small flustered 'oh'; not crying, not injured",
    blur: "an observatory dome open to a violet and gold galaxy",
  },
  xiaoxue: {
    look: "SEASONAL OUTFIT — 'Light Snow' (the solar term). She is still an earth pony (no horn, no wings). She wears: a short pale ice-blue Chinese-style winter cape with a white fluffy fur collar and silver plum-blossom embroidery; her curly mane is woven into two low loose braids tied with red cords, decorated with small silver snowflake pins and a sprig of red winter berries (her hairstyle is visibly different from usual); four short white fluffy boots; a small round red-tasselled charm hanging from the cape clasp. A few real snowflakes rest on her eyelashes and curls.",
    mood: "A soft, delighted smile looking up at the first falling snow, cheeks slightly rosy; standing on all four hooves.",
    scene: "a quiet courtyard garden as the first light snow falls: a red plum tree in blossom with snow on its branches, a round moon gate in a white wall, one warm paper lantern, thin snow on stone paving, large soft flakes out of focus in the foreground. Ice blue, white and plum red palette.",
    cheer: "catching the first snowflake — hopping up with one front hoof raised to the sky, braids and cape bouncing, a joyful open laugh",
    hurt: "a lump of snow dropped from the branch — hunching with a little pile of snow on her head, braids drooping, eyes squeezed shut and a comic shivering grimace; not crying, not injured",
    blur: "a snowy courtyard with red plum blossom and one warm lantern",
  },
  graduate: {
    look: "THEMED OUTFIT — graduation day, the day she made it ashore. She is still an earth pony (no horn, no wings). She wears: a deep navy academic gown draped over her body with a rose-pink satin-lined hood folded on her back; a navy mortarboard cap with a gold tassel, with her curly mane brushed into smooth glossy waves that fall to one side beneath it (her hairstyle is visibly different from usual); a gold medal on a pink ribbon around her neck; a small bouquet-coloured corsage pinned at her chest; her tail tied with a gold ribbon.",
    mood: "A proud, bright, moved smile with shining eyes, head high; standing on all four hooves.",
    scene: "a stone harbour quay at sunrise where a little boat has just been moored: a white lighthouse in the distance, calm golden water, gulls, cherry petals drifting across the quay, a long plain pink ribbon banner (no writing) strung between lamp posts. Navy, rose and sunrise gold palette.",
    cheer: "tossing the moment into the sky — rearing up with one front hoof raised high, gown and hood flying, tassel swinging, a huge overjoyed laugh",
    hurt: "tripped on the gown hem — stumbling forward a step with the cap slid down over one eye, ears back, a sheepish gritted-teeth smile; not crying, not injured",
    blur: "a harbour at sunrise with a distant lighthouse and golden water",
  },
};

export function heroJobs() {
  return Object.entries(FORMS).map(([id, f]) => ({out: path.join(RAW, `${id}-hero.png`), refs: REFS, prompt: `${ID} ${f.look} ${f.mood} ${ANAT} Scene: ${f.scene} ${COMP}`}));
}
export function poseJobs() {
  const jobs = [];
  for (const [id, f] of Object.entries(FORMS)) {
    const hero = path.join(RAW, `${id}-hero.png`);
    if (!fs.existsSync(hero)) continue;
    jobs.push({out: path.join(RAW, `${id}-char.png`), refs: [hero], prompt: `${KEEP} Draw her again in the SAME standing pose and expression as in the attached image, full body. ${POSE}`});
    jobs.push({out: path.join(RAW, `${id}-cheer.png`), refs: [hero], prompt: `${KEEP} Draw a NEW full-body pose: ${f.cheer}. ${POSE}`});
    jobs.push({out: path.join(RAW, `${id}-hurt.png`), refs: [hero], prompt: `${KEEP} Draw a NEW full-body pose: ${f.hurt}. ${POSE}`});
    jobs.push({out: path.join(RAW, `${id}-plate.png`), refs: [hero], prompt: `Please generate an image. The attached image is approved key art for a game. Repaint the SAME location with the same camera, lighting, palette and painterly cinematic quality, but as an EMPTY background plate: the pony character is completely removed and nothing replaces her — no character, no animal, no person, no silhouette anywhere. The area where she stood shows the natural continuation of the ground and background, slightly calmer and softly lit, so that a character can be composited there later. Keep the foreground blur, atmospheric haze and depth. Landscape 1536x1024, full-bleed opaque. No text, letters, numbers, logo, watermark, frame or UI.`});
    jobs.push({out: path.join(RAW, `${id}-avatar.png`), refs: [hero], prompt: `Please generate an image. The attached image is the approved art of this exact character in this exact form (Pinkie Pie fan art). Keep her identity and every form feature identical — species features, colours, mane shape and material, horn / wings / fins / scales / antennae / hat / helmet if she has them — and the same painterly cinematic rendering quality. Draw a NEW close-up PORTRAIT to be used as a circular profile avatar: head, neck and upper chest only, three-quarter view, looking at the viewer, with the same expression as in the attached image. Composition (strict): square 1024x1024, full-bleed opaque. Her entire head — including ears, any hat or helmet, and the full volume of her mane — fits inside a centered circle whose diameter is 72% of the image width; nothing important lies outside that circle; her eyes sit slightly above the center of the image. Background: fills the ENTIRE square from edge to edge and corner to corner with one continuous, softly blurred, out-of-focus impression of ${f.blur} with no distinct objects. The background has NO disc, NO circular vignette, NO spotlight shape, NO round halo behind her — it is an ordinary continuous photographic backdrop. Her neck and chest continue naturally past the bottom edge of the image (not cut off by any shape). Her cutie mark is on her flank, which is outside the frame: do NOT draw any balloon mark or symbol anywhere on her chest, neck or shoulder. Soft key light on her face and a rim light on her mane. Do NOT draw a circle, ring, frame or border. NOT a sticker: no white outline around her. No hands or arms anywhere in the picture. Premium and elegant, for adult fans; not chibi. No text, letters, logo or watermark.`});
  }
  return jobs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const which = process.argv[2] || 'hero';
  const only = (process.argv[3] || '').split(',').filter(Boolean);
  let jobs = which === 'poses' ? poseJobs() : heroJobs();
  if (only.length) jobs = jobs.filter(j => only.some(id => path.basename(j.out).startsWith(id + '-')));
  const file = path.join(ART, 'v4', `jobs-forms-${which}.json`);
  fs.mkdirSync(RAW, {recursive: true});
  fs.writeFileSync(file, JSON.stringify(jobs, null, 1));
  console.log(file, jobs.length, 'jobs,', jobs.filter(j => !fs.existsSync(j.out)).length, 'to do');
}

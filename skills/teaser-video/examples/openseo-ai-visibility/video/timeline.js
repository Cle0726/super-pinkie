// The timing table: every time (seconds), caption, colour, capture, and camera key of the teaser. index.html builds
// the video from this file alone; change the video here.

const FPS = 60;
const TOTAL = 10;

// Music: bgm2.mp3 (161.5 BPM) from 51.91 s to the song's end; the clip itself is the <audio> element in index.html
// (HyperFrames reads media from the HTML, not from script). Its section hits, in video time:
const HIT = { pickup: 1.25, drop: 2.45, topics: 4.35, header: 6.24, logo: 8.16, url: 8.86, final: 9.46 };

// Each scene is a layer with its own slow camera; a scene dissolves in over the one before it.
const DISSOLVE = 0.55;
const T = {
  // 1. Enter your URL: the field is focused, the URL types out, the pointer glides in on the pickup, clicks on the drop
  typeStart: 0.6,
  typePer: 0.07, // "linear.app": 10 keystroke frames
  click: HIT.drop,
  // 2. Competitors: rows land on half-beats
  review: 2.55,
  rows: 2.84,
  rowStep: 0.186,
  // 3. Topics and prompts: dissolve in on a hit; the page is tipped back and the list builds row by row as the camera
  //    pans, timed so the second topic header (item 6) lands on the next hit
  topics: HIT.topics,
  cascade: 4.55,
  step: (HIT.header - 0.12 - 4.55) / 6,
  rowDur: 0.7, // a row settles over this long
  // 4. End card: the app fades out from `end`; the card starts just before the strongest hit so the logo blooms on it
  end: HIT.logo - 0.6,
  endCard: HIT.logo - 0.1,
};

const CAPTIONS = [
  { text: 'Enter your URL', from: 0.5, to: 2.6 },
  { text: 'Find competitors', from: 2.84, to: 4.4 },
  { text: 'Monitor your AI visibility', from: 4.75, to: 7.95 },
];

// The app's dark palette (its theme tokens). `row` is the table's own background, sampled from the capture, for the
// mask under rows that have not landed yet.
const C = {
  bg: 'oklch(14% 0 0)',
  text: 'oklch(92% 0 0)',
  muted: 'oklch(70% 0 0)',
  primary: 'oklch(66% 0.12 262)',
  bright: 'oklch(76% 0.11 262)',
  glow: 'oklch(66% 0.12 262 / 0.14)',
  endGlow: 'oklch(66% 0.12 262 / 0.22)',
  pill: 'oklch(22% 0 0 / 0.86)',
  row: '#1d1d1d',
};

// Captures: 1440 CSS px wide at 2x; h is each capture's height in CSS px. The form is a stack of typing frames:
// form-01 focused and empty, then one frame per keystroke.
const CAP = {
  form: { frames: Array.from({ length: 11 }, (_, i) => `assets/dark/form-${String(i + 1).padStart(2, '0')}.png`), h: 900 },
  review: { src: 'assets/dark/review.png', h: 900 },
  topics: { src: 'assets/dark/topics-tall.png', h: 1990 },
};

const END = { icon: 'assets/brand-icon.png', name: 'OpenSEO', url: 'openseo.so' };

// Measured boxes from the capture pass ([x, y, w, h] in capture CSS px), pasted from its boxes.json.
const B = {
  'setup.card': [504.5, 227.3, 672, 383.5],
  'setup.input': [537.5, 434.3, 606, 40],
  'setup.submit': [537.5, 498.3, 606, 48],
  'review.card': [456.5, 179.4, 768, 479.3],
  'review.row.0': [490.5, 340.1, 700, 45],
  'review.row.1': [490.5, 385.1, 700, 45],
  'review.row.2': [490.5, 430.1, 700, 45],
  'review.row.3': [490.5, 475.1, 700, 45],
  'topics.topic.0': [305, 411.5, 229.8, 18.3],
  'topics.topic.1': [305, 920.8, 216.5, 18.3],
  'topics.topic.2': [305, 1430.1, 233.2, 18.3],
  'topics.prompt.0': [306, 460.8, 475.4, 37],
  'topics.prompt.1': [306, 553.8, 418.3, 37],
  'topics.prompt.2': [306, 646.8, 428.6, 37],
  'topics.prompt.3': [306, 739.8, 453.5, 37],
  'topics.prompt.4': [306, 832.8, 452.9, 37],
  'topics.prompt.5': [306, 970.1, 455.6, 37],
  'topics.prompt.6': [306, 1063.1, 454.3, 37],
  'topics.prompt.7': [306, 1156.1, 465.6, 37],
  'topics.prompt.8': [306, 1249.1, 446.5, 37],
  'topics.prompt.9': [306, 1342.1, 472.6, 37],
  'topics.prompt.10': [306, 1479.3, 480.1, 37],
  'topics.prompt.11': [306, 1572.3, 449, 37],
  'topics.prompt.12': [306, 1665.3, 460.8, 37],
  'topics.prompt.13': [306, 1758.3, 420, 37],
  'topics.prompt.14': [306, 1851.3, 475.1, 37],
};
const mid = (k) => [B[k][0] + B[k][2] / 2, B[k][1] + B[k][3] / 2];

// The rows that land. Competitors: the first four table rows. Topics: each header, then its 5 prompts, in reading
// order; every row spans the table (x, w), a header 44.3 px tall around its label, a prompt 93 px from 18 px above
// its text.
const REVIEW_ROWS = [0, 1, 2, 3].map((i) => B[`review.row.${i}`]);
const LIST = { x: 266, w: 1149 };
const TOPIC_ROWS = [0, 1, 2].flatMap((k) => [
  { top: mid(`topics.topic.${k}`)[1] - 22.15, h: 44.3, header: true },
  ...[0, 1, 2, 3, 4].map((j) => ({ top: B[`topics.prompt.${k * 5 + j}`][1] - 18, h: 93 })),
]);

// Camera keys per scene: the capture point at the frame centre (x, y), the zoom (z), the page's tilt back and roll in
// degrees, and the GSAP ease into the key. One long, slow move per scene. Zoom 1.6+ is the least that centres x = 840
// on a 1440 capture; the competitor card sits 42 px high so it and the caption centre together.
const [cardX, cardY] = mid('setup.card');
const [revX, revY] = mid('review.card');
const listTop = mid('topics.topic.0')[1];
const CAMERA = {
  form: [
    { t: 0, x: cardX, y: cardY + 10, z: 1.5, tilt: 18, roll: -4 },
    { t: 1.6, x: cardX, y: cardY, z: 1.62, ease: 'expo.out' },
    { t: 3.2, x: cardX, y: cardY, z: 1.75 },
  ],
  review: [
    { t: T.review, x: revX, y: revY + 42, z: 1.6 },
    { t: T.topics + DISSOLVE, x: revX, y: revY + 42, z: 1.68 },
  ],
  topics: [
    { t: T.topics, x: 640, y: listTop + 20, z: 1.75, tilt: 16, roll: -3 },
    { t: TOTAL, x: 670, y: listTop + 600, z: 1.85, tilt: 13, roll: -2, ease: 'power1.inOut' },
  ],
};

// The pointer (form scene only, on the flat page): one slow glide from the field to the button, then the click.
const [inX, inY] = mid('setup.input');
const [btX, btY] = mid('setup.submit');
const POINTER = { from: 1.3, to: 2.75, start: [inX + 200, inY + 14], glide: [1.3, 2.3], end: [btX + 70, btY + 8], click: T.click };

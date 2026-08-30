import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const modes = [
  { id: "chat", label: "唠嗑模式", ink: "#bf286d", shadow: "#f9b0cd", wash: "#fff4fa" },
  { id: "thinking", label: "想法模式", ink: "#923e82", shadow: "#dfb1df", wash: "#fff3fd" },
  { id: "unrestricted", label: "无限制模式", ink: "#b92861", shadow: "#f6a9c6", wash: "#fff1f7" },
];

for (const mode of modes) {
  // Keep the original 1254px avatar inside the SVG. The banner is small on
  // screen, but the header runs at Retina density and a tiny raster source
  // makes the face look muddy.
  const avatar = await readFile(join(directory, `laolao-mode-${mode.id}-hd.png`));
  const encodedAvatar = avatar.toString("base64");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="36" viewBox="0 0 144 36" role="img" aria-label="碧琪：${mode.label}">
  <defs><clipPath id="avatar"><circle cx="17" cy="17" r="15.5"/></clipPath></defs>
  <rect x=".5" y=".5" width="143" height="35" rx="17.5" fill="${mode.wash}" fill-opacity=".78" stroke="${mode.shadow}" stroke-opacity=".45"/>
  <image href="data:image/png;base64,${encodedAvatar}" x="1.5" y="1.5" width="31" height="31" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar)"/>
  <circle cx="17" cy="17" r="15.5" fill="none" stroke="${mode.ink}" stroke-opacity=".34"/>
  <text x="40" y="22.6" fill="${mode.ink}" font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', sans-serif" font-size="13" font-weight="700" letter-spacing=".25">${mode.label}</text>
  <path d="M135 12.5l3 3.2 3-3.2" fill="none" stroke="${mode.ink}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity=".78"/>
</svg>`;
  await writeFile(join(directory, `laolao-mode-${mode.id}.svg`), svg);
}

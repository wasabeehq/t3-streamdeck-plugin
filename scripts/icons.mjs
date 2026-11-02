// Generates static key PNGs, monochrome action icons and the plugin icons.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const imgs = join(root, "fr.wasabee.t3code.sdPlugin", "imgs");
const CHROME = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const work = mkdtempSync(join(process.env.ICONS_TMP ?? tmpdir(), "t3sd-icons-"));

const C = {
  nav: ["#5aa2ff", "#b67cff"],
  alert: ["#ffc04d", "#ff6a3d"],
  green: ["#2ee87a", "#19c3a0"],
  cyan: ["#3fd8ff", "#3d7bff"],
  teal: ["#2ee8c8", "#2e9be8"],
  pink: ["#ff6fd8", "#9a7cff"],
  red: ["#ff6a5a", "#ff2d7a"],
};

const BUBBLE = `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`;
const GAUGE = `<path d="M3.34 19a10 10 0 1 1 17.32 0"/><path d="m12 14 4.5-4.5"/><circle cx="12" cy="14" r="1.6" fill="url(#g)" stroke="none"/>`;

// [name, colors, glyph, caption?, stat?]  caption = [top, label]; stat = { value, sub } replaces the glyph.
const keys = [
  ["sujet-precedent", C.nav, `${BUBBLE}<path d="M13.5 7 10.5 10l3 3"/>`],
  ["sujet-suivant", C.nav, `${BUBBLE}<path d="M10.5 7l3 3-3 3"/>`],
  ["premier-en-attente", C.alert, `<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><circle cx="19" cy="4.5" r="2.6" fill="url(#g)" stroke="none"/>`],
  ["nouveau-sujet", C.nav, `${BUBBLE}<path d="M12 7v6M9 10h6"/>`],
  ["terminal", C.green, `<rect x="2.5" y="3.5" width="19" height="17" rx="2.5"/><path d="m7 9 3 3-3 3M13 15h4"/>`],
  ["navigateur", C.cyan, `<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>`],
  ["diff", C.teal, `<path d="M12 3v12M6 9h12M6 20h12"/>`],
  ["usages", C.pink, GAUGE],
  ["stop", C.red, `<circle cx="12" cy="12" r="10"/><rect x="8.5" y="8.5" width="7" height="7" rx="1.2" fill="url(#g)" stroke="none"/>`],
  ["approuver", C.green, `<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>`],
  ["envoyer-file", C.nav, `<path d="M3.71 3.05a.5.5 0 0 0-.68.63l2.84 7.62a2 2 0 0 1 0 1.4l-2.84 7.62a.5.5 0 0 0 .68.63l18-8.5a.5.5 0 0 0 0-.9z"/><path d="M6 12h9"/>`],
  ["modele", C.pink, `<path fill="url(#g)" stroke="none" d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>`],
  ["actualiser", C.teal, `<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>`],
  ["ouvrir-usages", C.pink, GAUGE, ["T3", "Usage"]],
  ["palette", C.cyan, `<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>`],
  ["editeur", C.nav, `<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/><path d="m14 4-4 16"/>`],
  ["barre-laterale", C.teal, `<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M9 3v18"/><path d="M5.5 8h1M5.5 11h1" />`],
  ["clore", C.green, `<rect x="2" y="3" width="20" height="5" rx="1.2"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="m9.5 14.5 2 2 3.5-4"/>`],
  ["epingler", C.alert, `<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>`],
  ["vue-cout", C.cyan, "", ["VUE", ""], { value: "$", sub: "coût · C" }],
  ["vue-tokens", C.cyan, "", ["VUE", ""], { value: "Tk", sub: "tokens · T" }],
  ["vue-limites", C.cyan, "", ["VUE", ""], { value: "%", sub: "limites · L" }],
];

const caption = ([top, label]) => `<g font-family="Helvetica Neue, Arial, sans-serif" text-anchor="middle" font-weight="700">
    <text x="72" y="${label ? 30 : 46}" font-size="${label ? 12 : 13}" fill="#7d8496" letter-spacing="1.5">${top.toUpperCase()}</text>
    ${label ? `<text x="72" y="47" font-size="15" fill="#e4e7ee" font-weight="800" letter-spacing="1">${label.toUpperCase()}</text>` : ""}
  </g>`;

const keySvg = ([, [a, b], glyph, cap, stat], size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 144 144">
  <defs>
    <radialGradient id="bg" cx="50%" cy="0%" r="110%">
      <stop offset="0" stop-color="#252932"/><stop offset=".55" stop-color="#14161c"/><stop offset="1" stop-color="#0a0b0f"/>
    </radialGradient>
    <linearGradient id="acc" gradientUnits="userSpaceOnUse" x1="20" y1="124" x2="124" y2="20">
      <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
    </linearGradient>
    <linearGradient id="g" gradientUnits="userSpaceOnUse" x1="2" y1="22" x2="22" y2="2">
      <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
    </linearGradient>
    <linearGradient id="fadeTL" gradientUnits="userSpaceOnUse" x1="12" y1="12" x2="36" y2="36">
      <stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="fadeBR" gradientUnits="userSpaceOnUse" x1="132" y1="132" x2="108" y2="108">
      <stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <mask id="mTL"><rect width="144" height="144" fill="url(#fadeTL)"/></mask>
    <mask id="mBR"><rect width="144" height="144" fill="url(#fadeBR)"/></mask>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="3" result="b"/>
      <feComponentTransfer in="b" result="s"><feFuncA type="linear" slope=".45"/></feComponentTransfer>
      <feMerge><feMergeNode in="s"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="144" height="144" fill="url(#bg)"/>
  <g fill="none" stroke="url(#acc)" stroke-width="3" stroke-linecap="round">
    <path mask="url(#mTL)" d="M12 56V22a10 10 0 0 1 10-10h34"/>
    <path mask="url(#mBR)" d="M132 88v34a10 10 0 0 1-10 10H88"/>
  </g>
  ${cap ? caption(cap) : ""}
  ${stat ? `<text x="72" y="88" font-family="Helvetica Neue, Arial, sans-serif" font-size="${stat.value.length > 2 ? 26 : 32}" text-anchor="middle" fill="#f2f4f8" font-weight="700">${stat.value}</text>
  <text x="72" y="112" font-family="Helvetica Neue, Arial, sans-serif" font-size="12" text-anchor="middle" fill="#7d8496" font-weight="600">${stat.sub}</text>` : `<g filter="url(#glow)" transform="${cap ? "translate(50 60) scale(1.85)" : "translate(42 42) scale(2.5)"}" fill="none" stroke="url(#g)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    ${glyph}
  </g>`}
</svg>
`;

// Plain white glyphs on a 24 grid for action list and category icons.
const mono = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>\n`;
const strip = (g) => g.replace(/fill="url\(#g\)" stroke="none"/g, `fill="#fff" stroke="none"`);
const byName = Object.fromEntries(keys.map((k) => [k[0], k[2]]));
const actionIcons = {
  shortcut: `<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>`,
  "first-waiting": strip(byName["premier-en-attente"]),
  approve: byName.approuver,
  stop: strip(byName.stop),
  "usage-gauge": strip(byName.usages),
  "usage-overview": strip(byName.usages),
  "usage-cost": `<circle cx="12" cy="12" r="10"/><path d="M15 9.5c-.5-1-1.5-1.5-3-1.5-1.8 0-3 .9-3 2.2 0 3 6 1.6 6 4.6 0 1.3-1.2 2.2-3 2.2-1.5 0-2.6-.6-3-1.6M12 6v2M12 16v2"/>`,
  refresh: byName.actualiser,
};

const rasterize = (svgPath, png, size) =>
  execFileSync(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars",
    `--user-data-dir=${join(work, "profile")}`,
    "--default-background-color=00000000",
    `--window-size=${size},${size}`, `--screenshot=${png}`, `file://${svgPath}`,
  ], { stdio: "ignore" });

mkdirSync(join(imgs, "keys"), { recursive: true });
mkdirSync(join(imgs, "plugin"), { recursive: true });

for (const k of keys) {
  for (const [size, suffix] of [[72, ""], [144, "@2x"]]) {
    const svg = join(work, `${k[0]}${suffix}.svg`);
    writeFileSync(svg, keySvg(k, size));
    rasterize(svg, join(imgs, "keys", `${k[0]}${suffix}.png`), size);
  }
}

for (const [slug, inner] of Object.entries(actionIcons)) {
  mkdirSync(join(imgs, "actions", slug), { recursive: true });
  writeFileSync(join(imgs, "actions", slug, "icon.svg"), mono(inner));
}
writeFileSync(
  join(imgs, "plugin", "category-icon.svg"),
  mono(`<path d="M3.34 19a10 10 0 1 1 17.32 0"/><path d="m12 14 4.5-4.5"/><circle cx="12" cy="14" r="1.6" fill="#fff" stroke="none"/>`).replace('width="20" height="20"', 'width="28" height="28"'),
);

const market = keys.find((k) => k[0] === "ouvrir-usages");
for (const [size, suffix] of [[256, ""], [512, "@2x"]]) {
  const svg = join(work, `marketplace${suffix}.svg`);
  writeFileSync(svg, keySvg(["m", market[1], GAUGE], size));
  rasterize(svg, join(imgs, "plugin", `marketplace${suffix}.png`), size);
}

rmSync(work, { recursive: true, force: true });
console.log(`${keys.length} keys (x2), ${Object.keys(actionIcons).length} action icons, plugin icons -> ${imgs}`);

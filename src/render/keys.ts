// Dynamic Stream Deck key renderers (144x144 SVG strings, no filters).

type Colors = readonly [string, string];

const LEVELS: { max: number; colors: Colors }[] = [
  { max: 50, colors: ["#2ee87a", "#19c3a0"] },
  { max: 80, colors: ["#ffc04d", "#ff8a3d"] },
  { max: Infinity, colors: ["#ff6a5a", "#ff2d7a"] },
];
const OFFLINE: Colors = ["#5b6170", "#3b404b"];
const ORANGE: Colors = ["#ffc04d", "#ff6a3d"];
const GREEN: Colors = ["#2ee87a", "#19c3a0"];
const RED: Colors = ["#ff6a5a", "#ff2d7a"];
const NAV: Colors = ["#5aa2ff", "#b67cff"];
const FONT = "Helvetica Neue, Arial, sans-serif";

export function levelColors(pct: number | null): Colors {
  if (pct == null || Number.isNaN(pct)) return OFFLINE;
  return (LEVELS.find((l) => pct < l.max) ?? LEVELS[2]).colors;
}

const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

// Arc from `from` to `to` degrees (0 = top, clockwise).
const arc = (cx: number, cy: number, r: number, from: number, to: number): string => {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

const clamp = (pct: number | null): number =>
  pct == null || Number.isNaN(pct) ? 0 : Math.max(0, Math.min(100, pct));
const pctLabel = (pct: number | null): string =>
  pct == null || Number.isNaN(pct) ? "--" : `${Math.round(pct)}%`;

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const text = (x: number, y: number, size: number, content: string, attrs = ""): string =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" text-anchor="middle" ${attrs}>${content}</text>`;

const frame = ([a, b]: Colors, body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <defs>
    <radialGradient id="bg" cx="50%" cy="0%" r="110%">
      <stop offset="0" stop-color="#252932"/><stop offset=".55" stop-color="#14161c"/><stop offset="1" stop-color="#0a0b0f"/>
    </radialGradient>
    <linearGradient id="acc" gradientUnits="userSpaceOnUse" x1="20" y1="124" x2="124" y2="20">
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
  </defs>
  <rect width="144" height="144" fill="url(#bg)"/>
  <g fill="none" stroke="url(#acc)" stroke-width="3" stroke-linecap="round">
    <path mask="url(#mTL)" d="M12 56V22a10 10 0 0 1 10-10h34"/>
    <path mask="url(#mBR)" d="M132 88v34a10 10 0 0 1-10 10H88"/>
  </g>
  ${body}
</svg>
`;

/** Lucide-style glyph on a 24 grid, drawn with the accent gradient. */
const glyph = (paths: string, transform: string): string =>
  `<g transform="${transform}" fill="none" stroke="url(#acc)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;

export function usageWindowKey(input: {
  provider: string;
  label: string;
  pct: number | null;
  resetIn: string | null;
}): string {
  const { provider, label, pct, resetIn } = input;
  const sweep = -120 + (240 * clamp(pct)) / 100;
  const big = (pct ?? 0) >= 100 ? 21 : 25;
  return frame(
    levelColors(pct),
    `<path d="${arc(72, 90, 33, -120, 120)}" fill="none" stroke="#2a2e38" stroke-width="9" stroke-linecap="round"/>
  ${pct ? `<path d="${arc(72, 90, 33, -120, sweep)}" fill="none" stroke="url(#acc)" stroke-width="9" stroke-linecap="round"/>` : ""}
  ${text(72, 28, 11, esc(provider.toUpperCase()), `fill="#7d8496" font-weight="700" letter-spacing="1.5"`)}
  ${text(72, 44, 14, esc(label.toUpperCase()), `fill="#e4e7ee" font-weight="800" letter-spacing="1"`)}
  ${text(72, 99, big, pctLabel(pct), `fill="#f2f4f8" font-weight="700"`)}
  ${resetIn ? text(72, 127, 13, `&#8635; ${esc(resetIn)}`, `fill="#9aa1b2" font-weight="600"`) : ""}`,
  );
}

export function usageOverviewKey(input: {
  provider: string;
  session: number | null;
  weekly: number | null;
  resetIn: string | null;
}): string {
  const { provider, session, weekly, resetIn } = input;
  const worst =
    session == null && weekly == null ? null : Math.max(session ?? 0, weekly ?? 0);
  const sweep = -120 + (240 * clamp(session)) / 100;
  const weeklyW = (84 * clamp(weekly)) / 100;
  return frame(
    levelColors(worst),
    `<path d="${arc(72, 80, 38, -120, 120)}" fill="none" stroke="#2a2e38" stroke-width="9" stroke-linecap="round"/>
  ${session ? `<path d="${arc(72, 80, 38, -120, sweep)}" fill="none" stroke="url(#acc)" stroke-width="9" stroke-linecap="round"/>` : ""}
  ${text(72, 34, 13, esc(provider.toUpperCase()), `fill="#9aa1b2" font-weight="700" letter-spacing="1.5"`)}
  ${text(72, 90, (session ?? 0) >= 100 ? 26 : 30, pctLabel(session), `fill="#f2f4f8" font-weight="700"`)}
  ${resetIn ? text(72, 108, 13, `&#8635; ${esc(resetIn)}`, `fill="#9aa1b2" font-weight="600"`) : ""}
  <rect x="30" y="120" width="84" height="6" rx="3" fill="#2a2e38"/>
  ${weekly ? `<rect x="30" y="120" width="${weeklyW.toFixed(1)}" height="6" rx="3" fill="${levelColors(weekly)[0]}"/>` : ""}`,
  );
}

export function statKey(input: { label: string; value: string; sub?: string | null }): string {
  const { label, value, sub } = input;
  return frame(
    NAV,
    `${text(72, 46, 13, esc(label.toUpperCase()), `fill="#9aa1b2" font-weight="700" letter-spacing="1.5"`)}
  ${text(72, 88, value.length > 6 ? 26 : 32, esc(value), `fill="#f2f4f8" font-weight="700"`)}
  ${sub ? text(72, 112, 12, esc(sub), `fill="#7d8496" font-weight="600"`) : ""}`,
  );
}

const BELL = `<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>`;
const CHECK = `<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>`;
const STOP = `<circle cx="12" cy="12" r="10"/><rect x="8.5" y="8.5" width="7" height="7" rx="1.2"/>`;

export function attentionKey(input: { count: number | null }): string {
  const { count } = input;
  if (count == null) {
    return frame(
      OFFLINE,
      `${glyph(BELL, "translate(36 34) scale(3)")}${text(72, 126, 18, "--", `fill="#7d8496" font-weight="700"`)}`,
    );
  }
  if (count <= 0) {
    return frame(OFFLINE, glyph(BELL, "translate(36 36) scale(3)"));
  }
  const label = count > 99 ? "99+" : String(count);
  const size = label.length > 2 ? 20 : label.length > 1 ? 26 : 32;
  return frame(
    ORANGE,
    `${glyph(BELL, "translate(30 40) scale(3)")}
  <circle cx="104" cy="40" r="25" fill="url(#acc)"/>
  ${text(104, 40 + size * 0.35, size, label, `fill="#14161c" font-weight="800"`)}`,
  );
}

export function approveKey(input: { kind: string | null; offline?: boolean }): string {
  const { kind, offline } = input;
  if (kind == null || offline) {
    return frame(OFFLINE, glyph(CHECK, "translate(36 36) scale(3)"));
  }
  const label = kind.length > 12 ? `${kind.slice(0, 11)}.` : kind;
  return frame(
    GREEN,
    `${glyph(CHECK, "translate(38 26) scale(2.8)")}
  ${text(72, 124, 14, esc(label.toUpperCase()), `fill="#e4e7ee" font-weight="800" letter-spacing="1"`)}`,
  );
}

export function stopKey(input: { running: number | null }): string {
  const { running } = input;
  if (running === 1 || (running != null && running > 1)) {
    const many = running > 1;
    return frame(
      many ? OFFLINE : RED,
      `${glyph(STOP, many ? "translate(38 26) scale(2.8)" : "translate(36 36) scale(3)")}
  ${many ? text(72, 124, 18, `${running}`, `fill="#f2f4f8" font-weight="800"`) : ""}`,
    );
  }
  return frame(OFFLINE, glyph(STOP, "translate(36 36) scale(3)"));
}

export function offlineKey(input: { label: string }): string {
  return frame(
    OFFLINE,
    text(72, 78, 15, esc(input.label.toUpperCase()), `fill="#7d8496" font-weight="700" letter-spacing="1.5"`),
  );
}

export function toDataUrl(svg: string): string {
  return "data:image/svg+xml;charset=utf8," + encodeURIComponent(svg);
}

const WEEKDAYS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

/** "48m", "3h12", or "jeu. 18h" beyond 24h; null when unknown or already past. */
export function formatResetIn(resetsAt: string | undefined, now: Date): string | null {
  if (!resetsAt) return null;
  const at = new Date(resetsAt);
  const ms = at.getTime() - now.getTime();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "0m";
  const minutes = Math.floor(ms / 60_000);
  if (ms > 24 * 3_600_000) return `${WEEKDAYS[at.getDay()]} ${at.getHours()}h`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}

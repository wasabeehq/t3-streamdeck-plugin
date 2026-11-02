import { describe, expect, it } from "vitest";
import {
  approveKey,
  attentionKey,
  formatResetIn,
  levelColors,
  offlineKey,
  statKey,
  stopKey,
  toDataUrl,
  usageOverviewKey,
  usageWindowKey,
} from "../src/render/keys";

const now = new Date(2026, 5, 1, 12, 0, 0);
const at = (ms: number) => new Date(now.getTime() + ms).toISOString();

describe("formatResetIn", () => {
  it("handles minutes, hours and missing values", () => {
    expect(formatResetIn(undefined, now)).toBeNull();
    expect(formatResetIn("garbage", now)).toBeNull();
    expect(formatResetIn(at(48 * 60_000 + 5000), now)).toBe("48m");
    expect(formatResetIn(at((3 * 60 + 12) * 60_000), now)).toBe("3h12");
    expect(formatResetIn(at((2 * 60 + 5) * 60_000), now)).toBe("2h05");
  });

  it("uses a French weekday beyond 24h", () => {
    const target = new Date(2026, 5, 4, 18, 0, 0); // Thursday
    expect(formatResetIn(target.toISOString(), now)).toBe("jeu. 18h");
  });
});

describe("levels", () => {
  it("switches colors at 50 and 80", () => {
    const green = levelColors(49.9)[0];
    const orange = levelColors(50)[0];
    const red = levelColors(80)[0];
    expect(new Set([green, orange, red]).size).toBe(3);
    expect(levelColors(79.9)[0]).toBe(orange);
    expect(levelColors(100)[0]).toBe(red);
    expect(levelColors(null)[0]).not.toBe(green);
  });

  it("renders the gauge in the level color", () => {
    expect(usageWindowKey({ provider: "claude", label: "5h", pct: 34, resetIn: null })).toContain(levelColors(34)[0]);
    expect(usageWindowKey({ provider: "claude", label: "5h", pct: 88, resetIn: null })).toContain(levelColors(88)[0]);
  });
});

describe("offline variants", () => {
  it("show -- when the value is unknown", () => {
    expect(usageWindowKey({ provider: "claude", label: "5h", pct: null, resetIn: null })).toContain(">--<");
    expect(usageOverviewKey({ provider: "claude", session: null, weekly: null, resetIn: null })).toContain(">--<");
    expect(attentionKey({ count: null })).toContain(">--<");
  });
});

describe("all renderers", () => {
  const svgs = [
    usageWindowKey({ provider: "claude", label: "Fable", pct: 71, resetIn: "jeu. 18h" }),
    usageWindowKey({ provider: "claude", label: "5h", pct: 100, resetIn: "1h20" }),
    usageOverviewKey({ provider: "claude", session: 12, weekly: 58, resetIn: "4h05" }),
    usageOverviewKey({ provider: "codex", session: 0, weekly: 0, resetIn: null }),
    statKey({ label: "Aujourd'hui", value: "$18.40", sub: "2,1 M tokens" }),
    statKey({ label: "Mois", value: "$412" }),
    attentionKey({ count: 0 }),
    attentionKey({ count: 3 }),
    attentionKey({ count: 120 }),
    attentionKey({ count: null }),
    approveKey({ kind: "command" }),
    approveKey({ kind: "file-change" }),
    approveKey({ kind: null }),
    approveKey({ kind: "command", offline: true }),
    stopKey({ running: 0 }),
    stopKey({ running: 1 }),
    stopKey({ running: 3 }),
    stopKey({ running: null }),
    offlineKey({ label: "T3 offline" }),
    offlineKey({ label: "No token" }),
  ];

  it("return clean SVG without filters", () => {
    for (const svg of svgs) {
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
      expect(svg).not.toMatch(/undefined|NaN/);
      expect(svg).not.toContain("<filter");
      expect(svg.match(/<text/g)?.length ?? 0).toBe(svg.match(/<\/text>/g)?.length ?? 0);
    }
  });

  it("escapes text and builds data URLs", () => {
    expect(statKey({ label: "<a&b>", value: "1" })).toContain("&lt;A&amp;B&gt;");
    expect(toDataUrl("<svg/>")).toBe("data:image/svg+xml;charset=utf8,%3Csvg%2F%3E");
  });

  it("shows the stop count only above one", () => {
    expect(stopKey({ running: 3 })).toContain(">3<");
    expect(stopKey({ running: 1 })).not.toContain("<text");
  });
});

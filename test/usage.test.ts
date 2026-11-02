import { describe, expect, it } from "vitest";

import { costRange, sumBuckets } from "../src/t3/usage.js";

describe("costRange", () => {
  const now = new Date(2026, 10, 2, 9, 30);

  it("covers today, the last 7 days including today, and the month to date", () => {
    expect(costRange("day", now)).toEqual({ sinceDay: "2026-11-02", untilDay: "2026-11-02" });
    expect(costRange("week", now)).toEqual({ sinceDay: "2026-10-27", untilDay: "2026-11-02" });
    expect(costRange("month", now)).toEqual({ sinceDay: "2026-11-01", untilDay: "2026-11-02" });
  });
});

describe("sumBuckets", () => {
  it("sums cost and every token category across buckets", () => {
    const totals = { uncachedInputTokens: 1, cachedInputTokens: 2, cacheCreationTokens: 3, outputTokens: 4, reasoningTokens: 5 };
    expect(sumBuckets({ buckets: [{ costUsd: 1.5, totals }, { costUsd: 2, totals }] })).toEqual({ usd: 3.5, tokens: 30 });
    expect(sumBuckets(null)).toEqual({ usd: 0, tokens: 0 });
  });
});

import { toWsUrl } from "../src/t3/discovery.js";

describe("toWsUrl", () => {
  it("targets /ws with the orchestration protocol the server requires", () => {
    expect(toWsUrl("http://127.0.0.1:3773")).toBe("ws://127.0.0.1:3773/ws?orchestrationProtocol=2");
    expect(toWsUrl("https://host.example/")).toBe("wss://host.example/ws?orchestrationProtocol=2");
  });
});

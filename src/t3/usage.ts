export type CostPeriod = "day" | "week" | "month";

export type CostSummary = { usd: number; tokens: number; fetchedAt: number };

export function isCostPeriod(value: unknown): value is CostPeriod {
  return value === "day" || value === "week" || value === "month";
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Inclusive local-day range: today, the last 7 days including today, or since the 1st. */
export function costRange(period: CostPeriod, now: Date): { sinceDay: string; untilDay: string } {
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "week") since.setDate(since.getDate() - 6);
  if (period === "month") since.setDate(1);
  return { sinceDay: localDay(since), untilDay: localDay(now) };
}

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export function sumBuckets(summary: unknown): { usd: number; tokens: number } {
  const buckets = (summary as { buckets?: unknown } | null)?.buckets;
  let usd = 0;
  let tokens = 0;
  if (!Array.isArray(buckets)) return { usd, tokens };
  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== "object") continue;
    const b = bucket as { costUsd?: unknown; totals?: Record<string, unknown> };
    usd += num(b.costUsd);
    const t = b.totals ?? {};
    tokens +=
      num(t.uncachedInputTokens) +
      num(t.cachedInputTokens) +
      num(t.cacheCreationTokens) +
      num(t.outputTokens) +
      num(t.reasoningTokens);
  }
  return { usd, tokens };
}

export function formatUsd(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  if (usd >= 100) return `$${Math.round(usd)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1e9) return `${(tokens / 1e9).toFixed(1)}G tok`;
  if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(1)}M tok`;
  if (tokens >= 1e3) return `${Math.round(tokens / 1e3)}k tok`;
  return `${tokens} tok`;
}

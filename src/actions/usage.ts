import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { formatResetIn, statKey, usageOverviewKey, usageWindowKey } from "../render/keys.js";
import { pickProvider, pickUsageWindow, pickWindow, providerLabel } from "../t3/attention.js";
import { runShortcut } from "../t3/shortcuts.js";
import { formatTokens, formatUsd, isCostPeriod, type CostPeriod } from "../t3/usage.js";
import { describeError, log, store, T3KeyAction } from "./shared.js";

type GaugeSettings = { provider?: string; window?: string };
type OverviewSettings = { provider?: string };
type CostSettings = { period?: string };

const RESET_TICK_MS = 60_000;
const COST_REFRESH_MS = 5 * 60_000;

const providerQuery = (value: string | undefined) => value?.trim() || "claude";

@action({ UUID: "dev.leokun.t3code.usage-gauge" })
export class UsageGaugeAction extends T3KeyAction<GaugeSettings> {
  protected readonly topics = ["config"] as const;
  protected override readonly tickMs = RESET_TICK_MS;

  protected draw(settings: GaugeSettings): string {
    const query = providerQuery(settings.provider);
    const windowQuery = settings.window?.trim() || "session";
    const picked = pickUsageWindow(store.config.providers, query, windowQuery);
    const window = picked?.window ?? null;
    return usageWindowKey({
      provider: providerLabel(picked?.provider, query),
      label: window?.label ?? windowQuery,
      pct: window ? window.usedPercent : null,
      resetIn: window ? formatResetIn(window.resetsAt, new Date()) : null,
    });
  }
}

@action({ UUID: "dev.leokun.t3code.usage-overview" })
export class UsageOverviewAction extends T3KeyAction<OverviewSettings> {
  protected readonly topics = ["config"] as const;
  protected override readonly tickMs = RESET_TICK_MS;

  protected draw(settings: OverviewSettings): string {
    const query = providerQuery(settings.provider);
    const provider = pickProvider(store.config.providers, query);
    const windows = provider?.usageLimits?.windows ?? [];
    const session = pickWindow(windows, "session");
    const weekly = pickWindow(windows, "weekly");
    return usageOverviewKey({
      provider: providerLabel(provider, query),
      session: session?.usedPercent ?? null,
      weekly: weekly?.usedPercent ?? null,
      resetIn: session ? formatResetIn(session.resetsAt, new Date()) : null,
    });
  }

  override async onKeyDown(ev: KeyDownEvent<OverviewSettings>): Promise<void> {
    try {
      await runShortcut("usage.open", store.bundleId);
    } catch (error) {
      log.warn(`Shortcut usage.open failed (check Accessibility permission): ${describeError(error)}`);
      await ev.action.showAlert();
    }
  }
}

const COST_LABELS: Record<CostPeriod, string> = { day: "JOUR", week: "7 JOURS", month: "MOIS" };

const periodOf = (settings: CostSettings): CostPeriod => (isCostPeriod(settings.period) ? settings.period : "day");

@action({ UUID: "dev.leokun.t3code.usage-cost" })
export class UsageCostAction extends T3KeyAction<CostSettings> {
  protected readonly topics = ["cost"] as const;
  protected override readonly tickMs = COST_REFRESH_MS;

  constructor() {
    super();
    // A fresh connection may come up after the key appeared: fetch then.
    store.onChange((topic) => {
      if (topic === "status" && store.status === "online") this.refreshVisible(true);
    });
  }

  protected draw(settings: CostSettings): string {
    const period = periodOf(settings);
    const cost = store.costs.get(period);
    return statKey({
      label: COST_LABELS[period],
      value: cost ? formatUsd(cost.usd) : "--",
      sub: cost ? formatTokens(cost.tokens) : null,
    });
  }

  protected override onVisible(settings: CostSettings): void {
    const period = periodOf(settings);
    const cost = store.costs.get(period);
    if (!cost || Date.now() - cost.fetchedAt >= COST_REFRESH_MS) this.refresh(period);
  }

  protected override onTick(): void {
    this.refreshVisible(true);
  }

  override async onKeyDown(ev: KeyDownEvent<CostSettings>): Promise<void> {
    try {
      await store.refreshCost(periodOf(ev.payload.settings));
    } catch (error) {
      log.warn(`Usage summary failed: ${describeError(error)}`);
      await ev.action.showAlert();
    }
  }

  private refreshVisible(force: boolean): void {
    const periods = new Set([...this.settingsById.values()].map(periodOf));
    for (const period of periods) {
      const cost = store.costs.get(period);
      if (force || !cost || Date.now() - cost.fetchedAt >= COST_REFRESH_MS) this.refresh(period);
    }
  }

  private refresh(period: CostPeriod): void {
    if (store.status !== "online") return;
    store.refreshCost(period).catch((error: unknown) => log.warn(`Usage summary failed: ${describeError(error)}`));
  }
}

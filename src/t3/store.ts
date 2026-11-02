import { randomUUID } from "node:crypto";

import { discoverOrigin, toWsUrl } from "./discovery.js";
import { RpcClient, type RpcLogger } from "./rpc.js";
import { emptyConfig, reduceConfig, reduceShell, type ConfigState, type Threads } from "./state.js";
import { DEFAULT_BUNDLE_ID } from "./shortcuts.js";
import { costRange, sumBuckets, type CostPeriod, type CostSummary } from "./usage.js";

export type GlobalSettings = { token?: string; serverUrl?: string; appBundleId?: string };

export type ConnectionStatus = "no-token" | "offline" | "online";

export type StoreTopic = "status" | "threads" | "config" | "cost";

/** One shared connection to the T3 server plus the state the keys render from. */
export class T3Store {
  status: ConnectionStatus = "offline";
  threads: Threads = new Map();
  config: ConfigState = emptyConfig;
  readonly costs = new Map<CostPeriod, CostSummary>();

  private settings: GlobalSettings = {};
  private settingsLoaded = false;
  private wanted = false;
  private readonly listeners = new Set<(topic: StoreTopic) => void>();
  private readonly costInFlight = new Map<CostPeriod, Promise<void>>();
  private readonly client: RpcClient;

  constructor(private readonly log: RpcLogger) {
    this.client = new RpcClient({ logger: log, resolveEndpoint: () => this.resolveEndpoint() });
    this.client.onStatus((rpcStatus) => {
      if (!this.settings.token?.trim()) return;
      this.setStatus(rpcStatus === "open" ? "online" : "offline");
    });
    this.client.subscribe("subscribeServerConfig", {}, (event) => {
      const next = reduceConfig(this.config, event);
      if (next !== this.config) {
        this.config = next;
        this.emit("config");
      }
    });
    this.client.subscribe("orchestration.subscribeShell", {}, (item) => {
      const next = reduceShell(this.threads, item);
      if (next !== this.threads) {
        this.threads = next;
        this.emit("threads");
      }
    });
  }

  get bundleId(): string {
    return this.settings.appBundleId?.trim() || DEFAULT_BUNDLE_ID;
  }

  onChange(listener: (topic: StoreTopic) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setSettings(settings: GlobalSettings): void {
    const changed =
      settings.token?.trim() !== this.settings.token?.trim() ||
      settings.serverUrl?.trim() !== this.settings.serverUrl?.trim();
    this.settings = { ...settings };
    const firstLoad = !this.settingsLoaded;
    this.settingsLoaded = true;
    if (changed && !firstLoad) {
      this.log.info("T3 connection settings changed, reconnecting");
      this.client.stop();
      this.threads = new Map();
      this.config = emptyConfig;
      this.costs.clear();
      this.emit("threads");
      this.emit("config");
      this.emit("cost");
    }
    this.maybeStart();
  }

  /** Called by actions when they appear: the connection is opened lazily. */
  ensureStarted(): void {
    this.wanted = true;
    this.maybeStart();
  }

  dispatch(command: Record<string, unknown>): Promise<unknown> {
    return this.client.request("orchestration.dispatchCommand", command);
  }

  newCommandId(): string {
    return randomUUID();
  }

  async refreshProviders(): Promise<void> {
    const result = await this.client.request("server.refreshProviders", { fresh: true });
    const next = reduceConfig(this.config, { type: "providerStatuses", payload: result });
    if (next !== this.config) {
      this.config = next;
      this.emit("config");
    }
  }

  refreshCost(period: CostPeriod): Promise<void> {
    const existing = this.costInFlight.get(period);
    if (existing) return existing;
    const run = (async () => {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const summary = await this.client.request("server.getUsageSummary", {
        ...costRange(period, new Date()),
        timeZone,
      });
      this.costs.set(period, { ...sumBuckets(summary), fetchedAt: Date.now() });
      this.emit("cost");
    })().finally(() => this.costInFlight.delete(period));
    this.costInFlight.set(period, run);
    return run;
  }

  private maybeStart(): void {
    if (!this.wanted || !this.settingsLoaded) return;
    if (!this.settings.token?.trim()) {
      this.client.stop();
      this.setStatus("no-token");
      return;
    }
    if (this.status === "no-token") this.setStatus("offline");
    this.client.start();
  }

  private async resolveEndpoint() {
    const token = this.settings.token?.trim();
    if (!token) return null;
    const origin = await discoverOrigin(this.settings.serverUrl);
    if (!origin) return null;
    return { wsUrl: toWsUrl(origin), token };
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit("status");
  }

  private emit(topic: StoreTopic): void {
    for (const listener of this.listeners) listener(topic);
  }
}

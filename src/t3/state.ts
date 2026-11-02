// Narrow, hand-written views of the T3 wire types. Every field is read defensively.

export type PendingRuntimeRequest = {
  id: string;
  kind: string;
  createdAt: string;
  blocking?: boolean;
};

export type ThreadShell = {
  id: string;
  title: string;
  status: string;
  activityRunStatus?: string | null;
  activeRunId?: string | null;
  pendingRuntimeRequest: PendingRuntimeRequest | null;
  lineage?: { relationshipToParent?: string | null; sideChat?: boolean } | null;
};

export type UsageWindow = {
  id: string;
  kind: string;
  label: string;
  usedPercent: number;
  resetsAt?: string;
};

export type ProviderUsage = {
  instanceId: string;
  driver: string;
  displayName?: string;
  enabled: boolean;
  usageLimits?: { checkedAt?: string; windows: UsageWindow[]; unavailable?: unknown };
};

export type ConfigState = {
  environmentId: string | null;
  providers: ProviderUsage[];
  threadStop: boolean;
};

export type Threads = ReadonlyMap<string, ThreadShell>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

export function parseThread(value: unknown): ThreadShell | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  if (!id) return null;
  const pending = isRecord(value.pendingRuntimeRequest) ? value.pendingRuntimeRequest : null;
  const lineage = isRecord(value.lineage) ? value.lineage : null;
  return {
    id,
    title: str(value.title) ?? "",
    status: str(value.status) ?? "idle",
    activityRunStatus: str(value.activityRunStatus) ?? null,
    activeRunId: str(value.activeRunId) ?? null,
    pendingRuntimeRequest:
      pending && str(pending.id)
        ? {
            id: str(pending.id)!,
            kind: str(pending.kind) ?? "unknown",
            createdAt: str(pending.createdAt) ?? "",
            ...(typeof pending.blocking === "boolean" ? { blocking: pending.blocking } : {}),
          }
        : null,
    lineage: lineage
      ? {
          relationshipToParent: str(lineage.relationshipToParent) ?? null,
          ...(lineage.sideChat === true ? { sideChat: true } : {}),
        }
      : null,
  };
}

export function parseProvider(value: unknown): ProviderUsage | null {
  if (!isRecord(value)) return null;
  const instanceId = str(value.instanceId);
  const driver = str(value.driver);
  if (!instanceId || !driver) return null;
  const limits = isRecord(value.usageLimits) ? value.usageLimits : null;
  const windows: UsageWindow[] = [];
  if (limits && Array.isArray(limits.windows)) {
    for (const w of limits.windows) {
      if (!isRecord(w) || !str(w.id) || typeof w.usedPercent !== "number") continue;
      windows.push({
        id: str(w.id)!,
        kind: str(w.kind) ?? "other",
        label: str(w.label) ?? str(w.id)!,
        usedPercent: w.usedPercent,
        ...(str(w.resetsAt) ? { resetsAt: str(w.resetsAt)! } : {}),
      });
    }
  }
  return {
    instanceId,
    driver,
    ...(str(value.displayName) ? { displayName: str(value.displayName)! } : {}),
    enabled: value.enabled !== false,
    ...(limits
      ? { usageLimits: { checkedAt: str(limits.checkedAt), windows, unavailable: limits.unavailable } }
      : {}),
  };
}

const parseProviders = (value: unknown): ProviderUsage[] | null =>
  Array.isArray(value) ? value.map(parseProvider).filter((p): p is ProviderUsage => p !== null) : null;

/**
 * Applies one `orchestration.subscribeShell` item to the active thread map.
 * A snapshot that carries `resolvedRepositoryIdentityRoots` is an enrichment pass with
 * an empty thread list: it must not wipe the threads.
 */
export function reduceShell(threads: Threads, item: unknown): Threads {
  if (!isRecord(item)) return threads;
  switch (item.kind) {
    case "snapshot": {
      const snapshot = isRecord(item.snapshot) ? item.snapshot : null;
      if (!snapshot || !Array.isArray(snapshot.threads)) return threads;
      const parsed = snapshot.threads.map(parseThread).filter((t): t is ThreadShell => t !== null);
      if (item.resolvedRepositoryIdentityRoots !== undefined) {
        if (parsed.length === 0) return threads;
        const next = new Map(threads);
        for (const thread of parsed) next.set(thread.id, thread);
        return next;
      }
      return new Map(parsed.map((t) => [t.id, t]));
    }
    case "thread.updated": {
      const thread = parseThread(item.thread);
      if (!thread) return threads;
      const next = new Map(threads);
      if (item.location === "active") next.set(thread.id, thread);
      else next.delete(thread.id);
      return next;
    }
    case "thread.removed": {
      const threadId = str(item.threadId);
      if (!threadId || item.location !== "active" || !threads.has(threadId)) return threads;
      const next = new Map(threads);
      next.delete(threadId);
      return next;
    }
    default:
      return threads;
  }
}

export const emptyConfig: ConfigState = { environmentId: null, providers: [], threadStop: false };

/** Applies one `subscribeServerConfig` event. Unknown event types leave the state untouched. */
export function reduceConfig(state: ConfigState, event: unknown): ConfigState {
  if (!isRecord(event)) return state;
  if (event.type === "snapshot" && isRecord(event.config)) {
    const config = event.config;
    const environment = isRecord(config.environment) ? config.environment : {};
    const capabilities = isRecord(environment.capabilities) ? environment.capabilities : {};
    return {
      environmentId: str(environment.environmentId) ?? state.environmentId,
      providers: parseProviders(config.providers) ?? state.providers,
      threadStop: capabilities.threadStop === true,
    };
  }
  if (event.type === "providerStatuses" && isRecord(event.payload)) {
    const providers = parseProviders(event.payload.providers);
    return providers ? { ...state, providers } : state;
  }
  return state;
}

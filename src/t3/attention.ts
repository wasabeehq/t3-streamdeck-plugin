import type { ProviderUsage, ThreadShell, UsageWindow } from "./state.js";

const RUNNING = new Set(["preparing", "starting", "running", "waiting"]);

/** Top-level threads only: subagents and side chats never show on the deck. */
export function isListedThread(thread: ThreadShell): boolean {
  return thread.lineage?.relationshipToParent !== "subagent" && thread.lineage?.sideChat !== true;
}

export function isWaiting(thread: ThreadShell): boolean {
  return thread.pendingRuntimeRequest !== null && thread.pendingRuntimeRequest.kind !== "auth_refresh";
}

export function isRunning(thread: ThreadShell): boolean {
  return RUNNING.has(thread.activityRunStatus ?? thread.status);
}

const requestTime = (thread: ThreadShell): number => {
  const time = Date.parse(thread.pendingRuntimeRequest?.createdAt ?? "");
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
};

/** Threads waiting on the user (approval or input), oldest request first. */
export function waitingThreads(threads: Iterable<ThreadShell>): ThreadShell[] {
  return [...threads].filter((t) => isListedThread(t) && isWaiting(t)).sort((a, b) => requestTime(a) - requestTime(b));
}

/** Running threads that are not blocked on the user. */
export function runningThreads(threads: Iterable<ThreadShell>): ThreadShell[] {
  return [...threads].filter((t) => isListedThread(t) && !isWaiting(t) && isRunning(t));
}

/**
 * The thread the approve key targets: the oldest real approval, or failing that the
 * oldest input request (shown, but never approvable from the deck).
 */
export function approvalTarget(threads: Iterable<ThreadShell>): ThreadShell | null {
  const waiting = waitingThreads(threads);
  return waiting.find((t) => t.pendingRuntimeRequest?.kind !== "user_input") ?? waiting[0] ?? null;
}

/** Builds the accept command, or null when the request needs answers (user_input). */
export function approveCommand(thread: ThreadShell, commandId: string): Record<string, unknown> | null {
  const request = thread.pendingRuntimeRequest;
  if (!request || request.kind === "user_input" || request.kind === "auth_refresh") return null;
  return {
    type: "runtime-request.respond",
    commandId,
    threadId: thread.id,
    requestId: request.id,
    decision: "accept",
  };
}

/** Builds the stop command, falling back to run.interrupt on servers without `threadStop`. */
export function stopCommand(
  thread: ThreadShell,
  commandId: string,
  threadStopSupported: boolean,
): Record<string, unknown> | null {
  if (threadStopSupported) return { type: "thread.stop", commandId, threadId: thread.id };
  if (!thread.activeRunId) return null;
  return { type: "run.interrupt", commandId, threadId: thread.id, runId: thread.activeRunId, holdQueue: true };
}

export function deepLink(environmentId: string, threadId: string): string {
  return `t3code://threads/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
}

const norm = (value: string | undefined): string => (value ?? "").trim().toLowerCase();

/**
 * Picks a provider by instance id first, then by driver kind, then by driver prefix
 * (so "claude" finds the "claudeAgent" driver). Case-insensitive.
 */
export function pickProvider(providers: readonly ProviderUsage[], query: string): ProviderUsage | null {
  const q = norm(query);
  if (!q) return null;
  const usable = (p: ProviderUsage) => (p.usageLimits?.windows.length ?? 0) > 0;
  const best = (candidates: ProviderUsage[]) =>
    candidates.find((p) => p.enabled && usable(p)) ?? candidates.find(usable) ?? candidates[0] ?? null;
  const byInstance = providers.find((p) => norm(p.instanceId) === q);
  if (byInstance) return byInstance;
  return best(providers.filter((p) => norm(p.driver) === q)) ?? best(providers.filter((p) => norm(p.driver).startsWith(q)));
}

/** Picks a window by id, then kind, then label (case-insensitive). */
export function pickWindow(windows: readonly UsageWindow[], query: string): UsageWindow | null {
  const q = norm(query);
  return (
    windows.find((w) => norm(w.id) === q) ??
    windows.find((w) => norm(w.kind) === q) ??
    windows.find((w) => norm(w.label) === q) ??
    null
  );
}

export function pickUsageWindow(
  providers: readonly ProviderUsage[],
  providerQuery: string,
  windowQuery: string,
): { provider: ProviderUsage; window: UsageWindow | null } | null {
  const provider = pickProvider(providers, providerQuery);
  if (!provider) return null;
  return { provider, window: pickWindow(provider.usageLimits?.windows ?? [], windowQuery) };
}

export function providerLabel(provider: ProviderUsage | null | undefined, fallback: string): string {
  return provider?.displayName ?? provider?.driver ?? fallback;
}

import { describe, expect, it } from "vitest";

import {
  approvalTarget,
  approveCommand,
  pickUsageWindow,
  runningThreads,
  stopCommand,
  waitingThreads,
} from "../src/t3/attention.js";
import { emptyConfig, reduceConfig, reduceShell, type ThreadShell, type Threads } from "../src/t3/state.js";

const thread = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  status: "idle",
  pendingRuntimeRequest: null,
  ...extra,
});

const pending = (kind: string, createdAt: string, id = `req-${kind}-${createdAt}`) => ({
  pendingRuntimeRequest: { id, kind, createdAt },
});

const snapshot = (threads: unknown[], extra: Record<string, unknown> = {}) => ({
  kind: "snapshot",
  snapshot: { threads, archivedThreads: [], projects: [] },
  ...extra,
});

const load = (...items: unknown[]): Threads => items.reduce<Threads>((acc, item) => reduceShell(acc, item), new Map());

describe("reduceShell", () => {
  it("does not wipe threads on an enrichment snapshot with resolvedRepositoryIdentityRoots", () => {
    const threads = load(
      snapshot([thread("a"), thread("b")]),
      snapshot([], { resolvedRepositoryIdentityRoots: ["/repo"] }),
    );
    expect([...threads.keys()]).toEqual(["a", "b"]);
  });

  it("replaces the thread list on an authoritative snapshot", () => {
    const threads = load(snapshot([thread("a"), thread("b")]), snapshot([thread("c")]));
    expect([...threads.keys()]).toEqual(["c"]);
  });

  it("drops threads moved to the archive or removed from active", () => {
    const threads = load(
      snapshot([thread("a"), thread("b"), thread("c")]),
      { kind: "thread.updated", location: "archive", thread: thread("a") },
      { kind: "thread.removed", location: "active", threadId: "b" },
      { kind: "thread.removed", location: "archive", threadId: "c" },
      { kind: "thread.updated", location: "active", thread: thread("d") },
    );
    expect([...threads.keys()].sort()).toEqual(["c", "d"]);
  });
});

describe("attention", () => {
  const threads = load(
    snapshot([
      thread("newer-approval", pending("command", "2026-11-02T10:05:00Z")),
      thread("older-input", pending("user_input", "2026-11-02T10:00:00Z")),
      thread("auth", pending("auth_refresh", "2026-11-02T09:00:00Z")),
      thread("subagent", { ...pending("command", "2026-11-02T08:00:00Z"), lineage: { relationshipToParent: "subagent" } }),
      thread("side", { ...pending("command", "2026-11-02T08:00:00Z"), lineage: { relationshipToParent: null, sideChat: true } }),
      thread("run-activity", { status: "idle", activityRunStatus: "starting" }),
      thread("run-status", { status: "running" }),
      thread("run-subagent", { status: "running", lineage: { relationshipToParent: "subagent" } }),
      thread("done", { status: "completed" }),
    ]),
  );

  it("lists waiting threads oldest first, without auth_refresh, subagents or side chats", () => {
    expect(waitingThreads(threads.values()).map((t) => t.id)).toEqual(["older-input", "newer-approval"]);
  });

  it("counts running threads from activityRunStatus or status, excluding subagents", () => {
    expect(runningThreads(threads.values()).map((t) => t.id).sort()).toEqual(["run-activity", "run-status"]);
  });

  it("targets the oldest real approval over an older input request", () => {
    expect(approvalTarget(threads.values())?.id).toBe("newer-approval");
  });

  it("refuses to approve a user_input request", () => {
    const input = threads.get("older-input") as ThreadShell;
    expect(approveCommand(input, "cmd-1")).toBeNull();
    expect(approveCommand(threads.get("newer-approval")!, "cmd-2")).toEqual({
      type: "runtime-request.respond",
      commandId: "cmd-2",
      threadId: "newer-approval",
      requestId: "req-command-2026-11-02T10:05:00Z",
      decision: "accept",
    });
  });

  it("falls back to run.interrupt without the threadStop capability", () => {
    const t = { ...threads.get("run-status")!, activeRunId: "run-9" };
    expect(stopCommand(t, "c", true)).toEqual({ type: "thread.stop", commandId: "c", threadId: "run-status" });
    expect(stopCommand(t, "c", false)).toEqual({
      type: "run.interrupt",
      commandId: "c",
      threadId: "run-status",
      runId: "run-9",
      holdQueue: true,
    });
    expect(stopCommand({ ...t, activeRunId: null }, "c", false)).toBeNull();
  });
});

describe("pickUsageWindow", () => {
  const config = reduceConfig(emptyConfig, {
    version: 1,
    type: "snapshot",
    config: {
      environment: { environmentId: "env-1", capabilities: { threadStop: true } },
      providers: [
        { instanceId: "codex", driver: "codex", enabled: true, usageLimits: { checkedAt: "x", windows: [] } },
        {
          instanceId: "claude-work",
          driver: "claudeAgent",
          displayName: "Claude Work",
          enabled: true,
          usageLimits: {
            checkedAt: "x",
            windows: [
              { id: "five_hour", kind: "session", label: "5h", usedPercent: 42, resetsAt: "2026-11-02T12:00:00Z" },
              { id: "seven_day", kind: "weekly", label: "Week", usedPercent: 10 },
              { id: "opus", kind: "weekly", label: "Opus week", usedPercent: 70 },
            ],
          },
        },
      ],
    },
  });

  it("parses the config snapshot", () => {
    expect(config.environmentId).toBe("env-1");
    expect(config.threadStop).toBe(true);
    expect(config.providers).toHaveLength(2);
  });

  it("matches the provider by instance id or driver, case-insensitively", () => {
    expect(pickUsageWindow(config.providers, "CLAUDE-WORK", "session")?.window?.usedPercent).toBe(42);
    expect(pickUsageWindow(config.providers, "claudeagent", "session")?.provider.displayName).toBe("Claude Work");
    expect(pickUsageWindow(config.providers, "gemini", "session")).toBeNull();
  });

  it("lets the default \"claude\" query find the claudeAgent driver by prefix", () => {
    expect(pickUsageWindow(config.providers, "claude", "session")?.provider.instanceId).toBe("claude-work");
  });

  it("matches the window by id first, then kind, then label", () => {
    expect(pickUsageWindow(config.providers, "claude-work", "OPUS")?.window?.usedPercent).toBe(70);
    expect(pickUsageWindow(config.providers, "claude-work", "weekly")?.window?.id).toBe("seven_day");
    expect(pickUsageWindow(config.providers, "claude-work", "opus week")?.window?.id).toBe("opus");
    expect(pickUsageWindow(config.providers, "codex", "session")?.window).toBeNull();
  });

  it("replaces providers from providerStatuses and ignores other event types", () => {
    const next = reduceConfig(config, { type: "providerStatuses", payload: { providers: [] } });
    expect(next.providers).toEqual([]);
    expect(next.environmentId).toBe("env-1");
    expect(reduceConfig(config, { type: "keybindingsUpdated", payload: {} })).toBe(config);
  });
});

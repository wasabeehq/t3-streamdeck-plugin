import streamDeck, { action, type KeyDownEvent, type KeyUpEvent } from "@elgato/streamdeck";

import { approveKey, attentionKey, stopKey } from "../render/keys.js";
import {
  approvalTarget,
  approveCommand,
  deepLink,
  runningThreads,
  stopCommand,
  waitingThreads,
} from "../t3/attention.js";
import type { ThreadShell } from "../t3/state.js";
import { describeError, log, store, T3KeyAction } from "./shared.js";

const LONG_PRESS_MS = 600;

async function openThread(thread: ThreadShell): Promise<boolean> {
  const environmentId = store.config.environmentId;
  if (!environmentId) return false;
  await streamDeck.system.openUrl(deepLink(environmentId, thread.id));
  return true;
}

@action({ UUID: "fr.wasabee.t3code.first-waiting" })
export class FirstWaitingAction extends T3KeyAction {
  protected readonly topics = ["threads"] as const;

  protected draw(): string {
    return attentionKey({ count: waitingThreads(store.threads.values()).length });
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const oldest = waitingThreads(store.threads.values())[0];
    if (!oldest || !(await openThread(oldest))) await ev.action.showAlert();
  }
}

@action({ UUID: "fr.wasabee.t3code.approve" })
export class ApproveAction extends T3KeyAction {
  protected readonly topics = ["threads"] as const;
  private readonly downAt = new Map<string, number>();

  protected draw(): string {
    const target = approvalTarget(store.threads.values());
    return approveKey({ kind: target?.pendingRuntimeRequest?.kind ?? null });
  }

  override onKeyDown(ev: KeyDownEvent): void {
    this.downAt.set(ev.action.id, Date.now());
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    const downAt = this.downAt.get(ev.action.id);
    this.downAt.delete(ev.action.id);
    const target = approvalTarget(store.threads.values());
    if (!target) return ev.action.showAlert();
    const longPress = downAt !== undefined && Date.now() - downAt >= LONG_PRESS_MS;
    if (!longPress) {
      if (!(await openThread(target))) await ev.action.showAlert();
      return;
    }
    const command = approveCommand(target, store.newCommandId());
    if (!command) {
      log.info("Approve skipped: the oldest request needs answers, open it instead");
      return ev.action.showAlert();
    }
    try {
      await store.dispatch(command);
      await ev.action.showOk();
    } catch (error) {
      log.warn(`Approve failed: ${describeError(error)}`);
      await ev.action.showAlert();
    }
  }
}

@action({ UUID: "fr.wasabee.t3code.stop" })
export class StopAction extends T3KeyAction {
  protected readonly topics = ["threads", "config"] as const;

  protected draw(): string {
    return stopKey({ running: runningThreads(store.threads.values()).length });
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const running = runningThreads(store.threads.values());
    const only = running.length === 1 ? running[0] : undefined;
    const command = only ? stopCommand(only, store.newCommandId(), store.config.threadStop) : null;
    if (!command) return ev.action.showAlert();
    try {
      await store.dispatch(command);
      await ev.action.showOk();
    } catch (error) {
      log.warn(`Stop failed: ${describeError(error)}`);
      await ev.action.showAlert();
    }
  }
}

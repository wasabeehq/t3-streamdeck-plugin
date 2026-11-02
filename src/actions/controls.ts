import {
  action,
  SingletonAction,
  type Action,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type WillAppearEvent,
} from "@elgato/streamdeck";

import { isShortcutCommand, runShortcut, SHORTCUTS, type ShortcutCommandId } from "../t3/shortcuts.js";
import { describeError, log, store } from "./shared.js";

type ShortcutSettings = { command?: string };

const commandOf = (settings: ShortcutSettings): ShortcutCommandId =>
  isShortcutCommand(settings.command) ? settings.command : "thread.next";

async function paintIcon(target: Action<ShortcutSettings>, settings: ShortcutSettings): Promise<void> {
  if (target.isKey()) await target.setImage(`imgs/keys/${SHORTCUTS[commandOf(settings)].icon}@2x.png`);
}

@action({ UUID: "dev.leokun.t3code.shortcut" })
export class ShortcutAction extends SingletonAction<ShortcutSettings> {
  override async onWillAppear(ev: WillAppearEvent<ShortcutSettings>): Promise<void> {
    await paintIcon(ev.action, ev.payload.settings);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ShortcutSettings>): Promise<void> {
    await paintIcon(ev.action, ev.payload.settings);
  }

  override async onKeyDown(ev: KeyDownEvent<ShortcutSettings>): Promise<void> {
    const command = commandOf(ev.payload.settings);
    try {
      await runShortcut(command, store.bundleId);
    } catch (error) {
      log.warn(`Shortcut ${command} failed (check Accessibility permission): ${describeError(error)}`);
      await ev.action.showAlert();
    }
  }
}

@action({ UUID: "dev.leokun.t3code.refresh" })
export class RefreshAction extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    store.ensureStarted();
    if (ev.action.isKey()) await ev.action.setImage("imgs/keys/actualiser@2x.png");
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    try {
      await store.refreshProviders();
      await ev.action.showOk();
    } catch (error) {
      log.warn(`Provider refresh failed: ${describeError(error)}`);
      await ev.action.showAlert();
    }
  }
}

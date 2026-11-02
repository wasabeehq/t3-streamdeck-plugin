import streamDeck from "@elgato/streamdeck";

import { ApproveAction, FirstWaitingAction, StopAction } from "./actions/attention.js";
import { RefreshAction, ShortcutAction } from "./actions/controls.js";
import { store } from "./actions/shared.js";
import { UsageCostAction, UsageGaugeAction, UsageOverviewAction } from "./actions/usage.js";
import type { GlobalSettings } from "./t3/store.js";

streamDeck.logger.setLevel("info");

for (const instance of [
  new ShortcutAction(),
  new FirstWaitingAction(),
  new ApproveAction(),
  new StopAction(),
  new UsageGaugeAction(),
  new UsageOverviewAction(),
  new UsageCostAction(),
  new RefreshAction(),
]) {
  streamDeck.actions.registerAction(instance);
}

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => store.setSettings(ev.settings));

await streamDeck.connect();
store.setSettings(await streamDeck.settings.getGlobalSettings<GlobalSettings>());

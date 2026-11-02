import streamDeck, {
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { offlineKey, toDataUrl } from "../render/keys.js";
import { T3Store, type StoreTopic } from "../t3/store.js";

const logger = streamDeck.logger.createScope("t3");

export const log = {
  info: (message: string) => void logger.info(message),
  warn: (message: string) => void logger.warn(message),
};

export const store = new T3Store(log);

const MIN_PAINT_INTERVAL_MS = 1_000;

type PaintState = { last: string | null; lastAt: number; timer: ReturnType<typeof setTimeout> | null };

/** Sends key images at most once per second per key, and only when they change. */
class Painter {
  private readonly keys = new Map<string, PaintState>();

  paint(action: KeyAction<JsonObject>, image: string): void {
    const state = this.keys.get(action.id) ?? { last: null, lastAt: 0, timer: null };
    this.keys.set(action.id, state);
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
    if (image === state.last) return;
    const wait = state.lastAt + MIN_PAINT_INTERVAL_MS - Date.now();
    const send = () => {
      state.timer = null;
      state.last = image;
      state.lastAt = Date.now();
      action.setImage(image).catch((error: unknown) => log.warn(`setImage failed: ${String(error)}`));
    };
    if (wait <= 0) send();
    else state.timer = setTimeout(send, wait);
  }

  forget(id: string): void {
    const state = this.keys.get(id);
    if (state?.timer) clearTimeout(state.timer);
    this.keys.delete(id);
  }
}

/**
 * Base for keys rendered from live T3 state. Subclasses draw an SVG from their settings;
 * the base handles visibility, offline states, throttling and periodic redraws.
 */
export abstract class T3KeyAction<S extends JsonObject = JsonObject> extends SingletonAction<S> {
  protected readonly settingsById = new Map<string, S>();
  protected abstract readonly topics: readonly StoreTopic[];
  /** Redraw period while visible, for time-relative labels. */
  protected readonly tickMs: number | null = null;
  private readonly painter = new Painter();
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    store.onChange((topic) => {
      if (topic === "status" || this.topics.includes(topic)) this.renderAll();
    });
  }

  protected abstract draw(settings: S): string;

  protected onVisible(_settings: S): void {}

  override onWillAppear(ev: WillAppearEvent<S>): void {
    this.settingsById.set(ev.action.id, ev.payload.settings);
    store.ensureStarted();
    if (ev.action.isKey()) this.render(ev.action);
    if (this.tickMs !== null && !this.ticker) this.ticker = setInterval(() => this.onTick(), this.tickMs);
    this.onVisible(ev.payload.settings);
  }

  override onWillDisappear(ev: WillDisappearEvent<S>): void {
    this.settingsById.delete(ev.action.id);
    this.painter.forget(ev.action.id);
    if (this.settingsById.size === 0 && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<S>): void {
    this.settingsById.set(ev.action.id, ev.payload.settings);
    if (ev.action.isKey()) this.render(ev.action);
    this.onVisible(ev.payload.settings);
  }

  protected onTick(): void {
    this.renderAll();
  }

  protected renderAll(): void {
    this.actions.forEach((action) => {
      if (action.isKey()) this.render(action);
    });
  }

  protected render(action: KeyAction<S>): void {
    const settings = this.settingsById.get(action.id) ?? ({} as S);
    let svg: string;
    if (store.status === "no-token") svg = offlineKey({ label: "NO TOKEN" });
    else if (store.status === "offline") svg = offlineKey({ label: "T3 OFFLINE" });
    else svg = this.draw(settings);
    this.painter.paint(action as unknown as KeyAction<JsonObject>, toDataUrl(svg));
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

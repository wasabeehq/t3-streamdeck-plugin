import { execFile } from "node:child_process";

type KeySpec = { keystroke: string } | { keyCode: number };

export type ShortcutDefinition = {
  keys: KeySpec;
  modifiers: ("command" | "shift")[];
  icon: string;
};

export const SHORTCUTS = {
  "thread.previous": { keys: { keyCode: 33 }, modifiers: ["command", "shift"], icon: "sujet-precedent" },
  "thread.next": { keys: { keyCode: 30 }, modifiers: ["command", "shift"], icon: "sujet-suivant" },
  "chat.new": { keys: { keystroke: "n" }, modifiers: ["command"], icon: "nouveau-sujet" },
  "terminal.toggle": { keys: { keystroke: "j" }, modifiers: ["command"], icon: "terminal" },
  "preview.toggle": { keys: { keystroke: "j" }, modifiers: ["command", "shift"], icon: "navigateur" },
  "diff.toggle": { keys: { keystroke: "d" }, modifiers: ["command"], icon: "diff" },
  "usage.open": { keys: { keystroke: "u" }, modifiers: ["command"], icon: "ouvrir-usages" },
  "modelPicker.toggle": { keys: { keystroke: "m" }, modifiers: ["command", "shift"], icon: "modele" },
  "commandPalette.toggle": { keys: { keystroke: "k" }, modifiers: ["command"], icon: "palette" },
  "thread.steerQueuedMessage": { keys: { keyCode: 36 }, modifiers: ["command", "shift"], icon: "envoyer-file" },
  "editor.openFavorite": { keys: { keystroke: "o" }, modifiers: ["command"], icon: "editeur" },
  "sidebar.toggle": { keys: { keystroke: "b" }, modifiers: ["command"], icon: "barre-laterale" },
  "thread.settle": { keys: { keystroke: "s" }, modifiers: ["command", "shift"], icon: "clore" },
  "thread.pin": { keys: { keystroke: "p" }, modifiers: ["command", "shift"], icon: "epingler" },
  "usage.cost": { keys: { keystroke: "c" }, modifiers: [], icon: "vue-cout" },
  "usage.tokens": { keys: { keystroke: "t" }, modifiers: [], icon: "vue-tokens" },
  "usage.limits": { keys: { keystroke: "l" }, modifiers: [], icon: "vue-limites" },
} as const satisfies Record<string, ShortcutDefinition>;

export type ShortcutCommandId = keyof typeof SHORTCUTS;

export const DEFAULT_BUNDLE_ID = "com.t3tools.t3code";

export function isShortcutCommand(value: unknown): value is ShortcutCommandId {
  return typeof value === "string" && Object.hasOwn(SHORTCUTS, value);
}

const safeBundleId = (bundleId: string | undefined): string =>
  bundleId && /^[A-Za-z0-9.-]+$/.test(bundleId.trim()) ? bundleId.trim() : DEFAULT_BUNDLE_ID;

/** AppleScript lines that focus T3 Code and press the shortcut. */
export function shortcutScript(command: ShortcutCommandId, bundleId?: string): string[] {
  const def: ShortcutDefinition = SHORTCUTS[command];
  const press = "keystroke" in def.keys ? `keystroke "${def.keys.keystroke}"` : `key code ${def.keys.keyCode}`;
  const using = def.modifiers.length > 0 ? ` using {${def.modifiers.map((m) => `${m} down`).join(", ")}}` : "";
  return [
    `tell application id "${safeBundleId(bundleId)}" to activate`,
    "delay 0.15",
    `tell application "System Events" to ${press}${using}`,
  ];
}

/** Runs the shortcut; rejects when osascript fails (usually missing Accessibility permission). */
export function runShortcut(command: ShortcutCommandId, bundleId?: string): Promise<void> {
  const args = shortcutScript(command, bundleId).flatMap((line) => ["-e", line]);
  return new Promise((resolve, reject) => {
    execFile("osascript", args, { timeout: 5_000 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve();
    });
  });
}

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

async function readRuntimeOrigin(path: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown; origin?: unknown };
    if (typeof parsed.origin !== "string") return null;
    if (typeof parsed.pid === "number" && !isAlive(parsed.pid)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

async function answersAsT3(origin: string): Promise<boolean> {
  try {
    const res = await fetch(new URL("/.well-known/t3/environment", origin), { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Finds the local T3 server origin: explicit override, else the runtime files under T3 home. */
export async function discoverOrigin(serverUrl: string | undefined): Promise<string | null> {
  const explicit = serverUrl?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const home = process.env.T3CODE_HOME?.trim() || join(homedir(), ".t3");
  for (const dir of ["userdata", "dev"]) {
    const origin = await readRuntimeOrigin(join(home, dir, "server-runtime.json"));
    if (origin && (await answersAsT3(origin))) return origin.replace(/\/+$/, "");
  }
  return null;
}

export function toWsUrl(origin: string): string {
  const url = new URL("/ws", origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("orchestrationProtocol", "2");
  return url.toString();
}

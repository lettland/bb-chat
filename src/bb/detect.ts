import { DEFAULT_SERVER_URL } from "../config.ts";
import type { BbchatConfig, HealthStatus } from "../types.ts";
import { probeHealth } from "./health.ts";

/** What `bbchat init` discovered about a system-local BB install. */
export interface Detection {
  /** A reachable server URL, if one answered `/health`. */
  runningServerUrl: string | null;
  /** Path to a `bb-app` executable on PATH, if found. */
  bbAppPath: string | null;
  /** Path to a `bb` executable on PATH, if found. */
  bbPath: string | null;
}

export interface DetectDeps {
  probe: (serverUrl: string) => Promise<HealthStatus>;
  which: (name: string) => string | null;
}

const defaultDeps: DetectDeps = {
  probe: (serverUrl) => probeHealth(serverUrl, { timeoutMs: 1000 }),
  which: (name) => Bun.which(name),
};

/**
 * Detect a system-local BB. Never launches anything and never mutates state —
 * it only probes a candidate URL and looks for executables on PATH. `bbchat init`
 * turns the result into an editable config; the user stays in control.
 */
export async function detect(
  candidateUrls: readonly string[] = [DEFAULT_SERVER_URL],
  deps: Partial<DetectDeps> = {},
): Promise<Detection> {
  const d = { ...defaultDeps, ...deps };

  let runningServerUrl: string | null = null;
  for (const url of candidateUrls) {
    const health = await d.probe(url);
    if (health.ok) {
      runningServerUrl = url;
      break;
    }
  }

  return {
    runningServerUrl,
    bbAppPath: d.which("bb-app"),
    bbPath: d.which("bb"),
  };
}

/** Candidate server URLs to probe: env-provided first, then the default. */
export function candidateServerUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  const urls: string[] = [];
  const envUrl = env.BBCHAT_SERVER_URL?.trim() || env.BB_SERVER_URL?.trim();
  if (envUrl) urls.push(envUrl);
  if (!urls.includes(DEFAULT_SERVER_URL)) urls.push(DEFAULT_SERVER_URL);
  return urls;
}

/**
 * Turn a detection into a starting config. `autoStart` stays `false` even when a
 * launch command was found: detection fills in WHAT could start BB, never opts
 * the user into auto-launching it.
 */
export function detectionToConfig(
  detection: Detection,
  fallbackServerUrl: string = DEFAULT_SERVER_URL,
): BbchatConfig {
  const bbCommand = detection.bbAppPath
    ? [detection.bbAppPath]
    : detection.bbPath
      ? [detection.bbPath]
      : null;
  const startCommand = detection.bbAppPath ? [detection.bbAppPath, "start"] : null;
  return {
    serverUrl: detection.runningServerUrl ?? fallbackServerUrl,
    bbCommand,
    startCommand,
    autoStart: false,
  };
}

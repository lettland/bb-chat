import { VchError } from "../errors.ts";
import type { HealthStatus, VchConfig } from "../types.ts";
import { probeHealth } from "./health.ts";

export interface EnsureServerResult {
  serverUrl: string;
  launchId: string | null;
  /** Whether `vch` launched BB this call (vs. finding it already running). */
  started: boolean;
}

export interface EnsureServerDeps {
  probe: (serverUrl: string) => Promise<HealthStatus>;
  launch: (command: string[]) => void;
  delay: (ms: number) => Promise<void>;
  now: () => number;
}

export interface EnsureServerOptions {
  readyTimeoutMs?: number;
  pollIntervalMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Spawn a detached background process from an argv array; never blocks `vch`. */
function launchDetached(command: string[]): void {
  const [exe, ...args] = command;
  if (!exe) throw new VchError("startCommand is empty.");
  const proc = Bun.spawn([exe, ...args], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  proc.unref();
}

const defaultDeps: EnsureServerDeps = {
  probe: (serverUrl) => probeHealth(serverUrl),
  launch: launchDetached,
  delay: sleep,
  now: Date.now,
};

/**
 * Ensure a BB server is reachable at `config.serverUrl`.
 *
 * Contract (config-first; never assumes an official install):
 *  1. Probe health first — a running server is never disturbed.
 *  2. If down and `autoStart` is disabled, fail with an actionable message.
 *  3. If down, `autoStart` is on, and a `startCommand` is set, launch THAT exact
 *     command detached and poll until healthy or timeout.
 *  4. If down with no `startCommand`, fail — no silent fallback to a discovered binary.
 */
export async function ensureServer(
  config: VchConfig,
  options: EnsureServerOptions = {},
  deps: Partial<EnsureServerDeps> = {},
): Promise<EnsureServerResult> {
  const d = { ...defaultDeps, ...deps };
  const readyTimeoutMs = options.readyTimeoutMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 500;

  const initial = await d.probe(config.serverUrl);
  if (initial.ok) {
    return { serverUrl: config.serverUrl, launchId: initial.launchId, started: false };
  }

  if (!config.autoStart) {
    throw new VchError(
      `BB is not reachable at ${config.serverUrl}.`,
      "Start BB yourself, set VCH_SERVER_URL, or run 'vch init' to configure autoStart and startCommand.",
    );
  }
  if (!config.startCommand || config.startCommand.length === 0) {
    throw new VchError(
      "autoStart is enabled but no startCommand is configured.",
      "Run 'vch init' to detect a launch command, or set VCH_START_COMMAND.",
    );
  }

  d.launch(config.startCommand);

  const deadline = d.now() + readyTimeoutMs;
  while (d.now() < deadline) {
    await d.delay(pollIntervalMs);
    const health = await d.probe(config.serverUrl);
    if (health.ok) {
      return { serverUrl: config.serverUrl, launchId: health.launchId, started: true };
    }
  }

  throw new VchError(
    `BB did not become healthy at ${config.serverUrl} within ${Math.round(readyTimeoutMs / 1000)}s.`,
    "Check the startCommand, or start BB manually and re-run 'vch'.",
  );
}

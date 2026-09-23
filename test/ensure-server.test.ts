import { describe, expect, test } from "bun:test";
import { ensureServer } from "../src/bb/ensure-server.ts";
import { isBbchatError } from "../src/errors.ts";
import type { BbchatConfig } from "../src/types.ts";

const baseConfig = (overrides: Partial<BbchatConfig> = {}): BbchatConfig => ({
  serverUrl: "http://bb",
  bbCommand: null,
  startCommand: null,
  autoStart: false,
  ...overrides,
});

const noopDeps = {
  launch: () => {},
  delay: async () => {},
  now: () => 0,
};

describe("ensureServer", () => {
  test("returns immediately when already healthy", async () => {
    const result = await ensureServer(
      baseConfig(),
      {},
      {
        ...noopDeps,
        probe: async () => ({ ok: true, launchId: "L" }),
      },
    );
    expect(result).toEqual({ serverUrl: "http://bb", launchId: "L", started: false });
  });

  test("errors when down and autoStart is disabled", async () => {
    try {
      await ensureServer(
        baseConfig(),
        {},
        { ...noopDeps, probe: async () => ({ ok: false, launchId: null }) },
      );
      throw new Error("expected throw");
    } catch (error) {
      expect(isBbchatError(error)).toBe(true);
      expect((error as Error).message).toContain("not reachable");
    }
  });

  test("errors when autoStart is on but no startCommand", async () => {
    try {
      await ensureServer(
        baseConfig({ autoStart: true }),
        {},
        {
          ...noopDeps,
          probe: async () => ({ ok: false, launchId: null }),
        },
      );
      throw new Error("expected throw");
    } catch (error) {
      expect(isBbchatError(error)).toBe(true);
      expect((error as Error).message).toContain("no startCommand");
    }
  });

  test("launches then succeeds once healthy", async () => {
    let launched = false;
    let calls = 0;
    const result = await ensureServer(
      baseConfig({ autoStart: true, startCommand: ["bb", "start"] }),
      { pollIntervalMs: 1, readyTimeoutMs: 1000 },
      {
        ...noopDeps,
        now: () => calls * 10,
        launch: () => {
          launched = true;
        },
        probe: async () => {
          calls++;
          return { ok: calls >= 3, launchId: calls >= 3 ? "L2" : null };
        },
      },
    );
    expect(launched).toBe(true);
    expect(result).toEqual({ serverUrl: "http://bb", launchId: "L2", started: true });
  });

  test("times out if never healthy", async () => {
    let clock = 0;
    try {
      await ensureServer(
        baseConfig({ autoStart: true, startCommand: ["bb", "start"] }),
        { pollIntervalMs: 1, readyTimeoutMs: 5 },
        {
          ...noopDeps,
          now: () => {
            clock += 10;
            return clock;
          },
          probe: async () => ({ ok: false, launchId: null }),
        },
      );
      throw new Error("expected throw");
    } catch (error) {
      expect(isBbchatError(error)).toBe(true);
      expect((error as Error).message).toContain("did not become healthy");
    }
  });

  test("the default launcher spawns the start command detached", async () => {
    // `true` exits immediately; this pins that the real spawn path accepts an argv.
    let probes = 0;
    const result = await ensureServer(
      baseConfig({ autoStart: true, startCommand: ["true"] }),
      { pollIntervalMs: 1 },
      {
        delay: async () => {},
        probe: async () => ({ ok: probes++ > 0, launchId: probes > 1 ? "L3" : null }),
      },
    );
    expect(result).toEqual({ serverUrl: "http://bb", launchId: "L3", started: true });
  });

  test("the default launcher refuses an empty executable", async () => {
    const error = await ensureServer(
      baseConfig({ autoStart: true, startCommand: [""] }),
      {},
      { probe: async () => ({ ok: false, launchId: null }) },
    ).catch((e: unknown) => e);
    expect(isBbchatError(error)).toBe(true);
    expect((error as Error).message).toContain("startCommand is empty");
  });
});

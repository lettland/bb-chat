import { describe, expect, test } from "bun:test";
import { healthUrl, parseHealth, probeHealth } from "../src/bb/health.ts";

describe("healthUrl", () => {
  test("appends /health to the base", () => {
    expect(healthUrl("http://127.0.0.1:38886")).toBe("http://127.0.0.1:38886/health");
    expect(healthUrl("http://127.0.0.1:38886/")).toBe("http://127.0.0.1:38886/health");
  });
});

describe("parseHealth", () => {
  test("reads ok and launchId", () => {
    expect(parseHealth({ ok: true, launchId: "abc" })).toEqual({ ok: true, launchId: "abc" });
  });

  test("defaults defensively", () => {
    expect(parseHealth({ ok: "yes" })).toEqual({ ok: false, launchId: null });
    expect(parseHealth(null)).toEqual({ ok: false, launchId: null });
    expect(parseHealth({ ok: true })).toEqual({ ok: true, launchId: null });
  });
});

describe("probeHealth", () => {
  test("returns parsed body on 200", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ok: true, launchId: "L1" }), {
        status: 200,
      })) as unknown as typeof fetch;
    expect(await probeHealth("http://x", { fetchImpl })).toEqual({ ok: true, launchId: "L1" });
  });

  test("returns not-ok on non-2xx", async () => {
    const fetchImpl = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    expect(await probeHealth("http://x", { fetchImpl })).toEqual({ ok: false, launchId: null });
  });

  test("swallows network errors", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await probeHealth("http://x", { fetchImpl })).toEqual({ ok: false, launchId: null });
  });
});

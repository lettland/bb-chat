import { describe, expect, test } from "bun:test";
import { candidateServerUrls, detect, detectionToConfig } from "../src/bb/detect.ts";
import { DEFAULT_SERVER_URL } from "../src/config.ts";

describe("candidateServerUrls", () => {
  test("env url first, default appended once", () => {
    expect(candidateServerUrls({ VCH_SERVER_URL: "http://env" })).toEqual([
      "http://env",
      DEFAULT_SERVER_URL,
    ]);
    expect(candidateServerUrls({})).toEqual([DEFAULT_SERVER_URL]);
  });

  test("does not duplicate the default", () => {
    expect(candidateServerUrls({ VCH_SERVER_URL: DEFAULT_SERVER_URL })).toEqual([
      DEFAULT_SERVER_URL,
    ]);
  });
});

describe("detect", () => {
  test("captures the first reachable url and PATH executables", async () => {
    const detection = await detect(["http://a", "http://b"], {
      probe: async (url) => ({ ok: url === "http://b", launchId: null }),
      which: (name) => (name === "bb-app" ? "/usr/local/bin/bb-app" : null),
    });
    expect(detection).toEqual({
      runningServerUrl: "http://b",
      bbAppPath: "/usr/local/bin/bb-app",
      bbPath: null,
    });
  });

  test("reports nothing when unreachable and not on PATH", async () => {
    const detection = await detect(["http://a"], {
      probe: async () => ({ ok: false, launchId: null }),
      which: () => null,
    });
    expect(detection).toEqual({ runningServerUrl: null, bbAppPath: null, bbPath: null });
  });
});

describe("detectionToConfig", () => {
  test("prefers bb-app for startCommand, keeps autoStart false", () => {
    expect(
      detectionToConfig({
        runningServerUrl: "http://live",
        bbAppPath: "/bin/bb-app",
        bbPath: "/bin/bb",
      }),
    ).toEqual({
      serverUrl: "http://live",
      bbCommand: ["/bin/bb-app"],
      startCommand: ["/bin/bb-app", "start"],
      autoStart: false,
    });
  });

  test("falls back to bb for bbCommand, no startCommand without bb-app", () => {
    expect(
      detectionToConfig({ runningServerUrl: null, bbAppPath: null, bbPath: "/bin/bb" }),
    ).toEqual({
      serverUrl: DEFAULT_SERVER_URL,
      bbCommand: ["/bin/bb"],
      startCommand: null,
      autoStart: false,
    });
  });
});

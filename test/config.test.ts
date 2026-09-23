import { describe, expect, test } from "bun:test";
import {
  configPath,
  defaultConfig,
  envOverrides,
  mergeConfig,
  normalizeConfig,
  parseCommand,
} from "../src/config.ts";

describe("parseCommand", () => {
  test("returns null for empty/whitespace", () => {
    expect(parseCommand(undefined)).toBeNull();
    expect(parseCommand("")).toBeNull();
    expect(parseCommand("   ")).toBeNull();
  });

  test("splits a plain string on whitespace", () => {
    expect(parseCommand("bb start")).toEqual(["bb", "start"]);
    expect(parseCommand("  /path/bb   start ")).toEqual(["/path/bb", "start"]);
  });

  test("parses a JSON array", () => {
    expect(parseCommand('["/custom/bb", "start"]')).toEqual(["/custom/bb", "start"]);
  });

  test("falls back to splitting when JSON is malformed", () => {
    expect(parseCommand("[not json")).toEqual(["[not", "json"]);
  });
});

describe("envOverrides", () => {
  test("BBCHAT_SERVER_URL wins over BB_SERVER_URL", () => {
    expect(envOverrides({ BBCHAT_SERVER_URL: "http://a", BB_SERVER_URL: "http://b" })).toEqual({
      serverUrl: "http://a",
    });
    expect(envOverrides({ BB_SERVER_URL: "http://b" })).toEqual({ serverUrl: "http://b" });
  });

  test("parses commands and autoStart", () => {
    expect(envOverrides({ BBCHAT_START_COMMAND: "bb start", BBCHAT_AUTO_START: "true" })).toEqual({
      startCommand: ["bb", "start"],
      autoStart: true,
    });
  });

  test("ignores unrecognized autoStart values", () => {
    expect(envOverrides({ BBCHAT_AUTO_START: "maybe" })).toEqual({});
  });

  test("empty env yields empty overrides", () => {
    expect(envOverrides({})).toEqual({});
  });
});

describe("normalizeConfig", () => {
  test("keeps only known, valid fields", () => {
    const raw = {
      serverUrl: "http://x",
      bbCommand: ["bb"],
      startCommand: [""],
      autoStart: true,
      bogus: 1,
    };
    expect(normalizeConfig(raw)).toEqual({
      serverUrl: "http://x",
      bbCommand: ["bb"],
      autoStart: true,
    });
  });

  test("non-object input yields empty", () => {
    expect(normalizeConfig(null)).toEqual({});
    expect(normalizeConfig("nope")).toEqual({});
  });
});

describe("mergeConfig", () => {
  test("later layers override earlier ones over the defaults", () => {
    const merged = mergeConfig({ serverUrl: "http://file" }, { autoStart: true });
    expect(merged).toEqual({
      ...defaultConfig(),
      serverUrl: "http://file",
      autoStart: true,
    });
  });
});

describe("configPath", () => {
  test("honors XDG_CONFIG_HOME", () => {
    expect(configPath({ XDG_CONFIG_HOME: "/tmp/cfg" })).toBe("/tmp/cfg/bbchat/config.json");
  });

  test("falls back to ~/.config", () => {
    expect(configPath({ HOME: "/home/u" })).toContain("/.config/bbchat/config.json");
  });
});

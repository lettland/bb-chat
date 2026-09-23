import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configPath,
  defaultConfig,
  envOverrides,
  loadConfigFile,
  mergeConfig,
  normalizeConfig,
  parseCommand,
  resolveConfig,
  writeConfigFile,
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

describe("config file I/O", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const tempEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
    const dir = mkdtempSync(join(tmpdir(), "bbchat-config-"));
    dirs.push(dir);
    return { XDG_CONFIG_HOME: dir, ...extra };
  };

  test("a missing file loads as empty", async () => {
    expect(await loadConfigFile(configPath(tempEnv()))).toEqual({});
  });

  test("an unparseable file loads as empty", async () => {
    const env = tempEnv();
    await Bun.write(configPath(env), "{ not json");
    expect(await loadConfigFile(configPath(env))).toEqual({});
  });

  test("writeConfigFile round-trips through resolveConfig", async () => {
    const env = tempEnv();
    const config = { ...defaultConfig(), serverUrl: "http://file:1", autoStart: true };
    expect(await writeConfigFile(config, env)).toBe(configPath(env));
    expect(await resolveConfig(env)).toEqual(config);
  });

  test("environment overrides win over the file", async () => {
    const env = tempEnv({
      BBCHAT_SERVER_URL: "http://env:2",
      BBCHAT_BB_COMMAND: '["/opt/bb"]',
      BBCHAT_AUTO_START: "off",
    });
    await writeConfigFile({ ...defaultConfig(), serverUrl: "http://file:1", autoStart: true }, env);
    const resolved = await resolveConfig(env);
    expect(resolved.serverUrl).toBe("http://env:2");
    expect(resolved.bbCommand).toEqual(["/opt/bb"]);
    expect(resolved.autoStart).toBe(false);
  });
});

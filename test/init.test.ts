import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Detection } from "../src/bb/detect.ts";
import { type InitDeps, type InitPrompter, promptConfig, runInit } from "../src/cli/init.ts";
import { configPath, defaultConfig, loadConfigFile, writeConfigFile } from "../src/config.ts";

/** Scripted prompter: answers text/yesNo from queues, falling back to defaults. */
function scripted(texts: Record<string, string>, yesNos: Record<string, boolean>): InitPrompter {
  return {
    text: (q, def) => texts[q] ?? def,
    yesNo: (q, def) => yesNos[q] ?? def,
  };
}

describe("promptConfig", () => {
  test("accepting defaults leaves config unchanged", () => {
    const base = { ...defaultConfig(), serverUrl: "http://host:1" };
    const out = promptConfig(base, scripted({}, {}));
    expect(out).toEqual(base);
  });

  test("edits serverUrl and sets a start command + autoStart", () => {
    const out = promptConfig(defaultConfig(), {
      text: (q, def) => {
        if (q.startsWith("BB server URL")) return "http://other:9";
        if (q.startsWith("Start command")) return "bb-app start";
        return def;
      },
      yesNo: () => true,
    });
    expect(out.serverUrl).toBe("http://other:9");
    expect(out.startCommand).toEqual(["bb-app", "start"]);
    expect(out.autoStart).toBe(true);
  });

  test("autoStart forced false when no start command is given", () => {
    const out = promptConfig(
      { ...defaultConfig(), autoStart: true },
      scripted({}, { "Auto-start BB with that command when it is unreachable?": true }),
    );
    expect(out.startCommand).toBeNull();
    expect(out.autoStart).toBe(false);
  });

  test("blank serverUrl answer keeps the default", () => {
    const base = { ...defaultConfig(), serverUrl: "http://keep:1" };
    const out = promptConfig(base, scripted({ "BB server URL": "" }, {}));
    expect(out.serverUrl).toBe("http://keep:1");
  });
});

describe("runInit", () => {
  const DEFAULT_URL = defaultConfig().serverUrl;
  let dir = "";
  let env: NodeJS.ProcessEnv = {};
  let out = "";
  let writeSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bbchat-init-"));
    env = { XDG_CONFIG_HOME: dir };
    out = "";
    writeSpy = spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
  });
  afterEach(() => {
    writeSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  const detection = (overrides: Partial<Detection> = {}): Detection => ({
    runningServerUrl: DEFAULT_URL,
    bbAppPath: null,
    bbPath: null,
    ...overrides,
  });

  /** Hermetic collaborators: a fixed detection, a canned server banner, a chosen TTY-ness. */
  const deps = (o: { detection?: Detection; tty?: boolean } = {}): Partial<InitDeps> => ({
    detect: async () => o.detection ?? detection(),
    serverInfo: async () => "BB 1.2.3 (npm)",
    isTTY: () => o.tty ?? false,
  });

  const opts = (o: Partial<{ yes: boolean; force: boolean; print: boolean }> = {}) => ({
    yes: false,
    force: false,
    print: false,
    ...o,
  });
  const refuse: InitPrompter = scripted({}, {});

  test("--print writes the detected config to stdout and nothing to disk", async () => {
    const code = await runInit(opts({ print: true }), env, refuse, deps());
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ serverUrl: DEFAULT_URL, autoStart: false });
    expect(await Bun.file(configPath(env)).exists()).toBe(false);
  });

  test("non-interactive: writes the detected config with the server banner", async () => {
    const found = detection({ bbAppPath: "/usr/bin/bb-app" });
    await runInit(opts({ yes: true }), env, refuse, deps({ detection: found }));
    expect(await loadConfigFile(configPath(env))).toEqual({
      serverUrl: DEFAULT_URL,
      bbCommand: ["/usr/bin/bb-app"],
      startCommand: ["/usr/bin/bb-app", "start"],
      autoStart: false,
    });
    expect(out).toContain(`Wrote ${configPath(env)}`);
    expect(out).toContain("BB 1.2.3 (npm)");
    expect(out).toContain("(reachable)");
    expect(out).not.toContain("No start command"); // a start command was detected
  });

  test("reachable with no start command explains it is not needed", async () => {
    await runInit(opts({ yes: true }), env, refuse, deps());
    expect(out).toContain("not needed while BB is reachable");
  });

  test("unreachable with no start command says how to launch BB", async () => {
    const down = detection({ runningServerUrl: null });
    await runInit(opts({ yes: true }), env, refuse, deps({ detection: down }));
    expect(out).toContain("BB was not reachable");
    expect(out).not.toContain("(reachable)");
  });

  test("an explicit server URL wins over whatever answered detection", async () => {
    const withUrl = { ...env, BBCHAT_SERVER_URL: "http://explicit:1" };
    await runInit(opts({ yes: true }), withUrl, refuse, deps());
    expect((await loadConfigFile(configPath(withUrl))).serverUrl).toBe("http://explicit:1");
    expect(out).not.toContain("(reachable)"); // the detected server is not the configured one
  });

  test("non-interactive never overwrites an existing config without --force", async () => {
    await writeConfigFile({ ...defaultConfig(), serverUrl: "http://mine:1" }, env);
    await runInit(opts({ yes: true }), env, refuse, deps());
    expect(out).toContain("Config already exists");
    expect((await loadConfigFile(configPath(env))).serverUrl).toBe("http://mine:1");

    await runInit(opts({ yes: true, force: true }), env, refuse, deps());
    expect((await loadConfigFile(configPath(env))).serverUrl).toBe(DEFAULT_URL);
  });

  test("interactive: declining the overwrite keeps the existing config", async () => {
    await writeConfigFile({ ...defaultConfig(), serverUrl: "http://mine:1" }, env);
    await runInit(opts(), env, refuse, deps({ tty: true }));
    expect(out).toContain(`Detected BB 1.2.3 (npm) at ${DEFAULT_URL}`);
    expect(out).toContain("Keeping the existing config.");
    expect((await loadConfigFile(configPath(env))).serverUrl).toBe("http://mine:1");
  });

  test("interactive: accepted overwrite writes the edited answers", async () => {
    await writeConfigFile(defaultConfig(), env);
    const prompter: InitPrompter = {
      text: (q, def) => (q.startsWith("Start command") ? "bb-app start" : def),
      yesNo: () => true,
    };
    await runInit(opts(), env, prompter, deps({ tty: true }));
    expect(await loadConfigFile(configPath(env))).toMatchObject({
      startCommand: ["bb-app", "start"],
      autoStart: true,
    });
  });

  test("the default prompter reads answers through the global prompt()", async () => {
    // Answers in prompt order: overwrite?, server URL, start command, auto-start?
    const answers = ["yes", "http://typed:7", "bb-app start", "Y"];
    const original = globalThis.prompt;
    globalThis.prompt = () => answers.shift() ?? null;
    try {
      await writeConfigFile(defaultConfig(), env);
      await runInit(opts(), env, undefined, deps({ tty: true }));
    } finally {
      globalThis.prompt = original;
    }
    expect(await loadConfigFile(configPath(env))).toEqual({
      serverUrl: "http://typed:7",
      startCommand: ["bb-app", "start"],
      autoStart: true,
    });
  });

  test("the default prompter falls back to defaults on blank or cancelled input", async () => {
    // Overwrite? yes; URL cancelled; start command blank (so auto-start is never asked).
    const answers: (string | null)[] = ["y", null, "   "];
    const original = globalThis.prompt;
    globalThis.prompt = () => answers.shift() ?? null;
    try {
      await writeConfigFile({ ...defaultConfig(), serverUrl: "http://keep:1" }, env);
      await runInit(opts(), env, undefined, deps({ tty: true }));
    } finally {
      globalThis.prompt = original;
    }
    // Cancelled URL keeps the detected default; a blank start command means none.
    expect(await loadConfigFile(configPath(env))).toEqual({
      serverUrl: DEFAULT_URL,
      autoStart: false,
    });
  });
});

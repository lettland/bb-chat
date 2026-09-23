import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/cli/args.ts";

describe("parseArgs", () => {
  test("bare invocation is chat, no global, no thread", () => {
    expect(parseArgs([])).toEqual({
      kind: "chat",
      global: false,
      threadId: null,
      spawnTokens: null,
    });
  });

  test("global flags", () => {
    expect(parseArgs(["-g"])).toEqual({
      kind: "chat",
      global: true,
      threadId: null,
      spawnTokens: null,
    });
    expect(parseArgs(["--global"])).toEqual({
      kind: "chat",
      global: true,
      threadId: null,
      spawnTokens: null,
    });
  });

  test("bare thread id opens that thread (not a shorthand)", () => {
    expect(parseArgs(["thr_abc123"])).toEqual({
      kind: "chat",
      global: false,
      threadId: "thr_abc123",
      spawnTokens: null,
    });
  });

  test("a bare provider-ish first token is a spawn shorthand", () => {
    expect(parseArgs(["codex", "5.6-sol", "high"])).toEqual({
      kind: "chat",
      global: false,
      threadId: null,
      spawnTokens: ["codex", "5.6-sol", "high"],
    });
  });

  test("shorthand filters out flags (so -g never reaches option resolution)", () => {
    expect(parseArgs(["codex", "-g"])).toEqual({
      kind: "chat",
      global: true,
      threadId: null,
      spawnTokens: ["codex"],
    });
  });

  test("help and version", () => {
    expect(parseArgs(["help"])).toEqual({ kind: "help" });
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseArgs(["-v"])).toEqual({ kind: "version" });
  });

  test("doctor", () => {
    expect(parseArgs(["doctor"])).toEqual({ kind: "doctor" });
  });

  test("selfcheck", () => {
    expect(parseArgs(["selfcheck"])).toEqual({ kind: "selfcheck" });
  });

  test("init flags", () => {
    expect(parseArgs(["init"])).toEqual({ kind: "init", yes: false, force: false, print: false });
    expect(parseArgs(["init", "--yes", "--force", "--print"])).toEqual({
      kind: "init",
      yes: true,
      force: true,
      print: true,
    });
  });

  test("new with flags and prompt", () => {
    expect(
      parseArgs([
        "new",
        "--provider",
        "codex",
        "--model",
        "gpt",
        "--mode",
        "auto",
        "--reasoning",
        "high",
        "do it",
      ]),
    ).toEqual({
      kind: "new",
      provider: "codex",
      model: "gpt",
      mode: "auto",
      reasoning: "high",
      prompt: "do it",
      force: false,
    });
  });

  test("new --force sets the flag", () => {
    const cmd = parseArgs(["new", "--force", "do a thing"]);
    expect(cmd).toMatchObject({ kind: "new", force: true, prompt: "do a thing" });
  });

  test("new flag missing value throws", () => {
    expect(() => parseArgs(["new", "--provider"])).toThrow();
  });

  test("providers", () => {
    expect(parseArgs(["providers"])).toEqual({ kind: "providers" });
  });

  test("threads", () => {
    expect(parseArgs(["threads"])).toEqual({ kind: "threads" });
  });
});

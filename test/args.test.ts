import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/cli/args.ts";

describe("parseArgs", () => {
  test("bare invocation is chat, no global, no thread", () => {
    expect(parseArgs([])).toEqual({ kind: "chat", global: false, threadId: null });
  });

  test("global flags", () => {
    expect(parseArgs(["-g"])).toEqual({ kind: "chat", global: true, threadId: null });
    expect(parseArgs(["--global"])).toEqual({ kind: "chat", global: true, threadId: null });
  });

  test("bare thread id opens that thread", () => {
    expect(parseArgs(["thr_abc123"])).toEqual({
      kind: "chat",
      global: false,
      threadId: "thr_abc123",
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
      parseArgs(["new", "--provider", "codex", "--model", "gpt", "--mode", "auto", "do it"]),
    ).toEqual({
      kind: "new",
      provider: "codex",
      model: "gpt",
      mode: "auto",
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

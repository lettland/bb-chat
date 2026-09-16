import { describe, expect, test } from "bun:test";
import { assessPrompt } from "../src/cli/prompt-guard.ts";

describe("assessPrompt", () => {
  test("flags empty / whitespace", () => {
    expect(assessPrompt("").lowValue).toBe(true);
    expect(assessPrompt("   ").lowValue).toBe(true);
  });

  test("flags greetings and filler (case/punctuation-insensitive)", () => {
    for (const p of ["hi", "Hello", "hey!", "  yo ", "test", "ok", "thanks", "help", "hmm?"]) {
      expect(assessPrompt(p).lowValue).toBe(true);
    }
  });

  test("flags ultra-short single tokens", () => {
    expect(assessPrompt("go").lowValue).toBe(true);
    expect(assessPrompt("run").lowValue).toBe(true);
  });

  test("passes real tasks", () => {
    for (const p of [
      "fix the flaky auth test",
      "fix bug",
      "add a /threads command",
      "why did the pipeline fail?",
      "refactor the parser to use a state machine",
    ]) {
      expect(assessPrompt(p)).toEqual({ lowValue: false, reason: null });
    }
  });

  test("provides a reason when flagged", () => {
    expect(assessPrompt("hi").reason).toMatch(/greeting|filler/);
    expect(assessPrompt("").reason).toMatch(/empty/);
    expect(assessPrompt("go").reason).toMatch(/short/);
  });
});

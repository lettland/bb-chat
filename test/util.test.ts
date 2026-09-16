import { describe, expect, test } from "bun:test";
import { clamp, parseSlashCommand } from "../src/tui/util.ts";

describe("parseSlashCommand", () => {
  test("non-slash input is a message (null)", () => {
    expect(parseSlashCommand("hello")).toBeNull();
    expect(parseSlashCommand("  hi /not-a-command")).toBeNull();
  });

  test("parses name and lowercases it", () => {
    expect(parseSlashCommand("/exit")).toEqual({ name: "exit", args: "" });
    expect(parseSlashCommand("  /QUIT  ")).toEqual({ name: "quit", args: "" });
  });

  test("splits name from args", () => {
    expect(parseSlashCommand("/model gpt-6 astra")).toEqual({ name: "model", args: "gpt-6 astra" });
  });

  test("bare slash yields empty name", () => {
    expect(parseSlashCommand("/")).toEqual({ name: "", args: "" });
  });

  test("an absolute path is not a known command shape but still parses (caller decides)", () => {
    // The caller only intercepts KNOWN names, so this parses but is sent as a message.
    expect(parseSlashCommand("/Users/me/file.ts")).toEqual({
      name: "users/me/file.ts",
      args: "",
    });
  });
});

describe("clamp", () => {
  test("bounds to range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

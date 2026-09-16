import { describe, expect, test } from "bun:test";
import { clamp, parseSlashCommand, scrollWindow, wrapText } from "../src/tui/util.ts";

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
});

describe("clamp", () => {
  test("bounds to range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("wrapText", () => {
  test("short text returns a single row", () => {
    expect(wrapText("hello", 10)).toEqual(["hello"]);
    expect(wrapText("", 10)).toEqual([""]);
  });

  test("word-wraps at the width boundary", () => {
    expect(wrapText("hello world foo", 9)).toEqual(["hello", "world foo"]);
  });

  test("hard-splits words longer than the width", () => {
    expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapText("hi superlongword", 5)).toEqual(["hi", "super", "longw", "ord"]);
  });

  test("no produced row exceeds the width", () => {
    const width = 12;
    const rows = wrapText(
      "the quick brown fox jumps over the lazy dog supercalifragilistic",
      width,
    );
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(width);
    expect(rows.join(" ")).toContain("quick");
  });
});

describe("scrollWindow", () => {
  const items = ["a", "b", "c", "d", "e"]; // 5 items

  test("offset 0 pins to the bottom (latest)", () => {
    const w = scrollWindow(items, 3, 0);
    expect(w.shown).toEqual(["c", "d", "e"]);
    expect(w).toMatchObject({ atBottom: true, above: 2, below: 0, offset: 0 });
  });

  test("scrolling up reveals older, tracks hidden counts", () => {
    const w = scrollWindow(items, 3, 2);
    expect(w.shown).toEqual(["a", "b", "c"]);
    expect(w).toMatchObject({ atBottom: false, above: 0, below: 2, offset: 2 });
  });

  test("offset clamps to the top", () => {
    const w = scrollWindow(items, 3, 999);
    expect(w.shown).toEqual(["a", "b", "c"]);
    expect(w.offset).toBe(2); // maxOffset = 5 - 3
  });

  test("everything fits: single full window", () => {
    const w = scrollWindow(items, 10, 0);
    expect(w.shown).toEqual(items);
    expect(w).toMatchObject({ above: 0, below: 0, atBottom: true });
  });

  test("negative offset is treated as bottom", () => {
    expect(scrollWindow(items, 3, -5).shown).toEqual(["c", "d", "e"]);
  });
});

import { describe, expect, test } from "bun:test";
import { clamp, wrapText } from "../src/tui/util.ts";

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

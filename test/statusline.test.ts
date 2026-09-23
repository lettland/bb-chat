import { describe, expect, test } from "bun:test";
import { fitStatusLine } from "../src/tui/statusline.ts";

const SEGMENTS = ["claude", "opus-5", "active", "feat/reskin"];
const HINTS = ["tab select", "ctrl+e expand", "esc back"];

function width(f: { left: string; right: string; gap: number }): number {
  return f.left.length + f.gap + f.right.length;
}

describe("fitStatusLine", () => {
  test("keeps everything when the terminal is wide", () => {
    const f = fitStatusLine(SEGMENTS, HINTS, 120);
    expect(f.left).toBe("claude · opus-5 · active · feat/reskin");
    expect(f.right).toBe("tab select · ctrl+e expand · esc back");
    expect(width(f)).toBe(120);
  });

  test("drops hints one at a time, least important first", () => {
    // context is 38 wide; +2 gap leaves 30 for hints → "tab select · ctrl+e expand" (26).
    const f = fitStatusLine(SEGMENTS, HINTS, 70);
    expect(f.left).toBe("claude · opus-5 · active · feat/reskin");
    expect(f.right).toBe("tab select · ctrl+e expand");
    expect(width(f)).toBe(70);
  });

  test("then sheds context from the least-important end once no hint fits", () => {
    const f = fitStatusLine(SEGMENTS, HINTS, 26);
    expect(f.right).toBe("");
    expect(f.left).toBe("claude · opus-5 · active");
    const g = fitStatusLine(SEGMENTS, HINTS, 16);
    expect(g.left).toBe("claude · opus-5");
  });

  test("truncates the last remaining segment with an ellipsis, never exceeding width", () => {
    const f = fitStatusLine(["a-very-long-provider-name"], HINTS, 10);
    expect(f.left).toBe("a-very-lo…");
    expect(width(f)).toBe(10);
  });

  test("hints alone (no context) still fit and drop", () => {
    const f = fitStatusLine([], HINTS, 12);
    expect(f.right).toBe("tab select");
  });

  test("ignores empty entries and never overflows at any width", () => {
    for (let w = 0; w <= 80; w++) {
      const f = fitStatusLine(["claude", "", "idle"], ["", ...HINTS], w);
      expect(width(f)).toBeLessThanOrEqual(Math.max(0, w));
      expect(f.left.includes(" ·  · ")).toBe(false);
      expect(f.right.startsWith(" · ")).toBe(false);
    }
  });
});

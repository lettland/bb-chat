import { describe, expect, test } from "bun:test";
import type { DiffTone } from "../src/tui/diff-render.ts";
import {
  accentColor,
  amberColor,
  diffColor,
  getThemeMode,
  glyph,
  palette,
  setThemeMode,
  type ThemeMode,
  toneColor,
} from "../src/tui/theme.ts";
import type { LineTone } from "../src/tui/timeline-render.ts";

const TONES: LineTone[] = [
  "user",
  "assistant",
  "toolcall",
  "agent",
  "edit",
  "output",
  "attention",
  "error",
  "system",
  "meta",
];
const DIFF_TONES: DiffTone[] = ["meta", "add", "del", "hunk", "file", "context"];
const MODES: ThemeMode[] = ["dark", "light"];

const isHex = (c: string) => /^#[0-9A-Fa-f]{6}$/.test(c);

describe("theme palette completeness", () => {
  for (const mode of MODES) {
    test(`${mode}: every tone and diff tone resolves to a hex color`, () => {
      const p = palette(mode);
      for (const tone of TONES) expect(isHex(p.tone[tone])).toBe(true);
      for (const tone of DIFF_TONES) expect(isHex(p.diff[tone])).toBe(true);
      expect(isHex(p.accent)).toBe(true);
      expect(isHex(p.amber)).toBe(true);
      expect(isHex(p.surface.code)).toBe(true);
      expect(isHex(p.surface.selection)).toBe(true);
      expect(isHex(p.surface.statusbar)).toBe(true);
      expect(isHex(p.border.default)).toBe(true);
      expect(isHex(p.border.focus)).toBe(true);
    });
  }
});

describe("active-mode resolvers", () => {
  test("default mode is dark and matches the legacy transcript hexes", () => {
    setThemeMode("dark");
    expect(getThemeMode()).toBe("dark");
    // Contract preserved from the pre-theme TONE_COLOR table.
    expect(toneColor("user")).toBe("#4EC9B0");
    expect(toneColor("assistant")).toBe("#E6E6E6");
    expect(toneColor("meta")).toBe("#4B5263");
    expect(accentColor()).toBe("#4EC9B0");
    expect(amberColor()).toBe("#E5C07B");
  });

  test("setThemeMode swaps the active palette", () => {
    setThemeMode("light");
    expect(toneColor("user")).toBe(palette("light").tone.user);
    expect(diffColor("add")).toBe(palette("light").diff.add);
    setThemeMode("dark"); // restore for other suites
  });
});

describe("glyphs", () => {
  test("core glyphs are single, non-empty strings", () => {
    for (const value of Object.values(glyph)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});

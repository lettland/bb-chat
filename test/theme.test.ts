import { describe, expect, test } from "bun:test";
import type { DiffTone } from "../src/tui/diff-render.ts";
import {
  accentColor,
  amberColor,
  diffColor,
  getThemeMode,
  glyph,
  palette,
  resolveThemeMode,
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
  test("default dark mode keeps distinct transcript role colors", () => {
    setThemeMode("dark");
    expect(getThemeMode()).toBe("dark");
    expect(toneColor("user")).toBe("#4EC9B0");
    expect(toneColor("assistant")).toBe("#C586C0");
    expect(toneColor("toolcall")).toBe("#7AA8F5");
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

describe("resolveThemeMode", () => {
  const reporting = (mode: "light" | "dark" | null) => ({
    waitForThemeMode: async () => mode,
  });

  test("an explicit BBCHAT_THEME wins over the terminal", async () => {
    expect(await resolveThemeMode(reporting("dark"), "light")).toBe("light");
    expect(await resolveThemeMode(reporting("light"), "dark")).toBe("dark");
  });

  test("follows the terminal when not forced (invalid values are ignored)", async () => {
    expect(await resolveThemeMode(reporting("light"), undefined)).toBe("light");
    expect(await resolveThemeMode(reporting("light"), "solarized")).toBe("light");
  });

  test("falls back to dark when the terminal is silent or the query fails", async () => {
    expect(await resolveThemeMode(reporting(null), undefined)).toBe("dark");
    const failing = { waitForThemeMode: async () => Promise.reject(new Error("no tty")) };
    expect(await resolveThemeMode(failing, undefined)).toBe("dark");
  });
});

import { describe, expect, test } from "bun:test";
import {
  formatPluginRow,
  formatSkillRow,
  toPluginRows,
  toSkillRows,
} from "../src/tui/extension-render.ts";

describe("toPluginRows", () => {
  test("maps and sorts by name, name falls back to id", () => {
    const rows = toPluginRows({
      plugins: [
        { id: "z-plugin", name: "Zebra", enabled: true },
        { id: "a-plugin", enabled: false },
        { enabled: true },
      ],
    });
    expect(rows).toEqual([
      { id: "a-plugin", name: "a-plugin", enabled: false },
      { id: "z-plugin", name: "Zebra", enabled: true },
    ]);
  });

  test("non-list yields empty", () => {
    expect(toPluginRows(null)).toEqual([]);
  });
});

describe("toSkillRows", () => {
  test("maps id fallbacks and description", () => {
    const rows = toSkillRows({
      skills: [
        { id: "s1", name: "Commit", description: "make commits" },
        { skillId: "s2", name: "Deploy" },
      ],
    });
    expect(rows[0]).toEqual({ id: "s1", name: "Commit", description: "make commits" });
    expect(rows[1]).toEqual({ id: "s2", name: "Deploy", description: "" });
  });
});

describe("formatting", () => {
  test("plugin enabled marker", () => {
    expect(formatPluginRow({ id: "p", name: "P", enabled: true }).startsWith("●")).toBe(true);
    expect(formatPluginRow({ id: "p", name: "P", enabled: false }).startsWith("○")).toBe(true);
  });

  test("skill shows description when present", () => {
    expect(formatSkillRow({ id: "s", name: "S", description: "d" })).toBe("S — d");
    expect(formatSkillRow({ id: "s", name: "S", description: "" })).toBe("S");
  });
});

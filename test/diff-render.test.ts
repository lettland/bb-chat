import { describe, expect, test } from "bun:test";
import { type DiffLine, renderDiffFiles } from "../src/tui/diff-render.ts";

const text = (lines: DiffLine[]): string => lines.map((l) => l.text).join("\n");

describe("renderDiffFiles", () => {
  test("unavailable outcome yields a message", () => {
    expect(renderDiffFiles({ outcome: "unavailable", reason: "no env" })).toEqual([
      { text: "diff unavailable: no env", tone: "meta" },
    ]);
    expect(renderDiffFiles(null)[0]?.text).toBe("no diff available");
  });

  test("available with no files reports no changes", () => {
    const lines = renderDiffFiles({ outcome: "available", files: [], initialPatches: [] });
    expect(text(lines)).toContain("no changes");
  });

  test("renders file summaries with change glyph and stats", () => {
    const lines = renderDiffFiles({
      outcome: "available",
      shortstat: "2 files changed",
      files: [
        { path: "src/a.ts", changeKind: "modified", additions: 3, deletions: 1, binary: false },
        { path: "img.png", changeKind: "added", additions: 0, deletions: 0, binary: true },
      ],
      initialPatches: [],
    });
    const out = text(lines);
    expect(out).toContain("2 files changed");
    expect(out).toContain("M src/a.ts  +3 -1");
    expect(out).toContain("A img.png  binary");
  });

  test("tones patch lines by prefix", () => {
    const lines = renderDiffFiles({
      outcome: "available",
      files: [{ path: "a.ts", changeKind: "modified", additions: 1, deletions: 1, binary: false }],
      initialPatches: [{ path: "a.ts", patch: "@@ -1 +1 @@\n-old\n+new\n ctx", truncated: false }],
    });
    const byText = new Map(lines.map((l) => [l.text, l.tone]));
    expect(byText.get("@@ -1 +1 @@")).toBe("hunk");
    expect(byText.get("-old")).toBe("del");
    expect(byText.get("+new")).toBe("add");
    expect(byText.get(" ctx")).toBe("context");
  });

  test("marks truncated patches", () => {
    const lines = renderDiffFiles({
      outcome: "available",
      files: [{ path: "a.ts", changeKind: "modified", additions: 1, deletions: 0, binary: false }],
      initialPatches: [{ path: "a.ts", patch: "+x", truncated: true }],
    });
    expect(text(lines)).toContain("patch truncated");
  });
});

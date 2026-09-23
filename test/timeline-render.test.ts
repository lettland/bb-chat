import { describe, expect, test } from "bun:test";
import { outputBody, statusGlyph, workId, workTitle } from "../src/tui/timeline-render.ts";
import { helpLegend } from "../src/tui/transcript-style.ts";

describe("statusGlyph", () => {
  test("groups statuses into pending, failed, done, and other", () => {
    expect(["running", "in_progress", "pending"].map(statusGlyph)).toEqual(["…", "…", "…"]);
    expect(["error", "failed", "denied"].map(statusGlyph)).toEqual(["✗", "✗", "✗"]);
    expect(["success", "done", "completed", "approved"].map(statusGlyph)).toEqual([
      "✓",
      "✓",
      "✓",
      "✓",
    ]);
    expect(statusGlyph("mystery")).toBe("•");
  });
});

describe("workTitle", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["command", { commandLine: "ls -la" }, "$ ls -la"],
    ["command", {}, "$ command"],
    ["tool", { name: "grep" }, "tool grep"],
    ["tool", {}, "tool call"],
    ["file-change", { movePath: "b.ts" }, "edit b.ts"],
    ["file-change", {}, "edit file"],
    ["file-read", { path: "a.ts" }, "read a.ts"],
    ["file-read", {}, "read file"],
    ["search", { pattern: "TODO" }, "search TODO"],
    ["search", {}, "search"],
    ["web-search", { query: "bun test" }, "web search bun test"],
    ["web-fetch", { url: "https://x.dev" }, "web fetch https://x.dev"],
    ["approval", { description: "run rm" }, "approval needed: run rm"],
    ["question", { prompt: "which one?" }, "question: which one?"],
    ["delegation", { name: "explorer" }, "delegate explorer"],
    ["workflow", { workflowName: "review" }, "workflow review"],
    ["plan-steps", { title: "ignored" }, "plan updated"],
    ["custom-kind", { title: "thing" }, "custom-kind thing"],
    ["", {}, "work"],
  ];
  for (const [kind, rec, expected] of cases) {
    test(`${kind || "(empty)"} → ${expected}`, () => {
      expect(workTitle(rec, kind)).toBe(expected);
    });
  }
});

describe("workId / outputBody", () => {
  test("workId prefers id over callId", () => {
    expect(workId({ id: "w1", callId: "c1" })).toBe("w1");
    expect(workId({ callId: "c1" })).toBe("c1");
    expect(workId({})).toBe("");
  });

  test("outputBody trims trailing whitespace and surrounding blank lines", () => {
    expect(outputBody({ output: "\n\n  a  \nb\t\n\n" })).toEqual(["  a", "b"]);
    expect(outputBody({})).toEqual([]);
  });
});

describe("helpLegend", () => {
  test("lists every tone swatch and the key hints", () => {
    const text = helpLegend()
      .chunks.map((c) => c.text)
      .join("");
    for (const label of ["you", "assistant", "tool", "output", "edit", "agent", "question"]) {
      expect(text).toContain(label);
    }
    expect(text).toContain("Ctrl+E expand");
  });
});

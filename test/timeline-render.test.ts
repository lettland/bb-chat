import { describe, expect, test } from "bun:test";
import { renderTimelineRows, renderTimelineText } from "../src/tui/timeline-render.ts";

describe("renderTimelineRows", () => {
  test("conversation rows get a gutter header and role tone, blank line between", () => {
    const lines = renderTimelineRows([
      { kind: "conversation", role: "user", text: "hello" },
      { kind: "conversation", role: "assistant", text: "hi there" },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["▌ you", "hello", "", "▌ assistant", "hi there"]);
    expect(lines[0]?.tone).toBe("user");
    expect(lines[1]?.tone).toBe("user");
    expect(lines[3]?.tone).toBe("assistant");
  });

  test("multiline conversation text keeps body lines at column 0 (wrap-safe)", () => {
    const lines = renderTimelineRows([{ kind: "conversation", role: "user", text: "a\nb" }]);
    expect(lines.map((l) => l.text)).toEqual(["▌ you", "a", "b"]);
  });

  test("a horizontal rule separates successive exchanges", () => {
    const lines = renderTimelineRows(
      [
        { kind: "conversation", role: "user", text: "A" },
        { kind: "conversation", role: "assistant", text: "a" },
        { kind: "conversation", role: "user", text: "B" },
      ],
      { ruleWidth: 10 },
    );
    expect(lines.map((l) => l.text)).toEqual([
      "▌ you",
      "A",
      "",
      "▌ assistant",
      "a",
      "",
      "─".repeat(10),
      "",
      "▌ you",
      "B",
    ]);
    expect(lines.find((l) => l.text.startsWith("─"))?.tone).toBe("meta");
  });

  test("work rows render a title per work kind", () => {
    const text = renderTimelineText([
      { kind: "work", workKind: "command", status: "success", command: "ls -la" },
      { kind: "work", workKind: "tool", status: "running", toolName: "grep" },
      { kind: "work", workKind: "file-change", status: "success", path: "src/a.ts" },
    ]);
    expect(text).toContain("$ ls -la");
    expect(text).toContain("tool grep");
    expect(text).toContain("edit src/a.ts");
  });

  test("approval and question are attention-toned", () => {
    const lines = renderTimelineRows([
      { kind: "work", workKind: "approval", status: "pending", title: "run rm" },
      { kind: "work", workKind: "question", status: "pending", question: "proceed?" },
    ]);
    expect(lines[0]?.tone).toBe("attention");
    expect(lines[0]?.text).toContain("approval needed");
    expect(lines[1]?.tone).toBe("attention");
    expect(lines[1]?.text).toContain("proceed?");
  });

  test("turn rows flatten their children", () => {
    const lines = renderTimelineRows([
      {
        kind: "turn",
        children: [
          { kind: "conversation", role: "assistant", text: "working" },
          { kind: "work", workKind: "command", status: "success", command: "go test" },
        ],
      },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["▌ assistant", "working", "  ✓ $ go test"]);
  });

  test("unknown kinds and non-objects are skipped", () => {
    expect(renderTimelineRows([{ kind: "mystery" }, null, 42, "x"])).toEqual([]);
  });

  test("unknown work kind falls back gracefully", () => {
    const text = renderTimelineText([{ kind: "work", workKind: "telepathy", status: "success" }]);
    expect(text).toContain("telepathy");
  });
});

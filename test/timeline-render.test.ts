import { describe, expect, test } from "bun:test";
import {
  renderTimelineRows,
  renderTimelineText,
  renderTranscript,
} from "../src/tui/timeline-render.ts";

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

  test("work tones distinguish calls, edits, agents, and errors", () => {
    const lines = renderTimelineRows([
      { kind: "work", workKind: "command", status: "success", command: "ls" },
      { kind: "work", workKind: "file-change", status: "success", path: "a.ts" },
      { kind: "work", workKind: "delegation", status: "running", description: "sub" },
      { kind: "work", workKind: "command", status: "error", command: "boom" },
    ]);
    const byText = (needle: string) => lines.find((l) => l.text.includes(needle));
    expect(byText("$ ls")?.tone).toBe("toolcall");
    expect(byText("edit a.ts")?.tone).toBe("edit");
    expect(byText("delegate sub")?.tone).toBe("agent");
    expect(byText("$ boom")?.tone).toBe("error");
  });

  test("tool output collapses to a dim preview with an affordance", () => {
    const lines = renderTimelineRows([
      {
        kind: "work",
        workKind: "command",
        id: "c1",
        status: "success",
        command: "ls",
        output: "a\nb\nc",
      },
    ]);
    // call line advertises hidden lines; preview shows the first line, indented + dim.
    expect(lines[0]?.text).toContain("▸ +3 lines");
    expect(lines[1]?.text).toBe("      a");
    expect(lines[1]?.tone).toBe("output");
  });

  test("expanding a tool shows its full output and records an anchor", () => {
    const rows = [
      {
        kind: "work",
        workKind: "command",
        id: "c1",
        status: "success",
        command: "ls",
        output: "a\nb\nc",
      },
    ];
    const collapsed = renderTranscript(rows);
    expect(collapsed.anchors).toEqual([{ id: "c1", line: 0 }]);

    const expanded = renderTranscript(rows, { expanded: new Set(["c1"]), selectedId: "c1" });
    expect(expanded.lines[0]?.text.startsWith("❯")).toBe(true); // selection cursor
    expect(expanded.lines[0]?.text).toContain("▾");
    expect(expanded.lines.slice(1, 4).map((l) => l.text)).toEqual([
      "      a",
      "      b",
      "      c",
    ]);
  });

  test("errored tool output is error-toned", () => {
    const t = renderTranscript([
      {
        kind: "work",
        workKind: "command",
        id: "x",
        status: "error",
        command: "boom",
        output: "stack\ntrace",
      },
    ]);
    expect(t.lines[0]?.tone).toBe("error");
    expect(t.lines[1]?.tone).toBe("error");
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

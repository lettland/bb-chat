import { describe, expect, test } from "bun:test";
import { renderTimelineRows, renderTimelineText } from "../src/tui/timeline-render.ts";

describe("renderTimelineRows", () => {
  test("conversation rows carry role tone and label", () => {
    const lines = renderTimelineRows([
      { kind: "conversation", role: "user", text: "hello" },
      { kind: "conversation", role: "assistant", text: "hi there" },
    ]);
    expect(lines[0]).toEqual({ text: "you: hello", tone: "user" });
    expect(lines[1]).toEqual({ text: "assistant: hi there", tone: "assistant" });
  });

  test("multiline conversation text indents continuation lines under the text", () => {
    const lines = renderTimelineRows([{ kind: "conversation", role: "user", text: "a\nb" }]);
    // "you: " is 5 columns, so "b" aligns under "a".
    expect(lines.map((l) => l.text)).toEqual(["you: a", "     b"]);
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
    expect(lines.map((l) => l.text)).toEqual(["assistant: working", "✓ $ go test"]);
  });

  test("unknown kinds and non-objects are skipped", () => {
    expect(renderTimelineRows([{ kind: "mystery" }, null, 42, "x"])).toEqual([]);
  });

  test("unknown work kind falls back gracefully", () => {
    const text = renderTimelineText([{ kind: "work", workKind: "telepathy", status: "success" }]);
    expect(text).toContain("telepathy");
  });
});

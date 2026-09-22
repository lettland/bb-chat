import { describe, expect, test } from "bun:test";
import {
  affordanceLabel,
  type Block,
  buildBlocks,
  changeKindLabel,
  isTimelineActive,
  selectableIds,
} from "../src/tui/timeline-model.ts";

const ESC = String.fromCharCode(0x1b);

function kinds(blocks: Block[]): string[] {
  return blocks.map((b) => b.kind);
}

/** Index into an array, narrowing away `undefined` (noUncheckedIndexedAccess). */
function at<T>(arr: readonly T[], i = 0): T {
  const value = arr[i];
  if (value === undefined) throw new Error(`no element at index ${i} (length ${arr.length})`);
  return value;
}

type MessageBlock = Extract<Block, { kind: "message" }>;
type WorkBlock = Extract<Block, { kind: "work" }>;
type DiffBlock = Extract<Block, { kind: "diff" }>;

describe("buildBlocks — conversation", () => {
  test("maps user/assistant rows to message blocks with a new-exchange boundary", () => {
    const blocks = buildBlocks([
      { kind: "conversation", role: "user", text: "A" },
      { kind: "conversation", role: "assistant", text: "a" },
      { kind: "conversation", role: "user", text: "B" },
    ]);
    expect(kinds(blocks)).toEqual(["message", "message", "message"]);
    const msgs = blocks as MessageBlock[];
    expect(at(msgs, 0).role).toBe("user");
    expect(at(msgs, 0).newExchange).toBe(false); // first block never opens a new exchange
    expect(at(msgs, 1).role).toBe("assistant");
    expect(at(msgs, 1).newExchange).toBe(false);
    expect(at(msgs, 2).role).toBe("user");
    expect(at(msgs, 2).newExchange).toBe(true); // a later user turn is a new exchange
  });

  test("sanitizes assistant prose (ANSI stripped) before it reaches a renderable", () => {
    const block = at(
      buildBlocks([
        { kind: "conversation", role: "assistant", text: `${ESC}[31mhi${ESC}[0m there` },
      ]) as MessageBlock[],
    );
    expect(block.text).toBe("hi there");
  });
});

describe("buildBlocks — work", () => {
  test("command row becomes a work block with glyph, tone, title, output", () => {
    const block = at(
      buildBlocks([
        {
          kind: "work",
          workKind: "command",
          status: "success",
          id: "w1",
          command: "go test ./...",
          output: "ok\nPASS",
        },
      ]) as WorkBlock[],
    );
    expect(block.glyph).toBe("✓");
    expect(block.tone).toBe("toolcall");
    expect(block.title).toBe("$ go test ./...");
    expect(block.output).toEqual(["ok", "PASS"]);
    expect(block.expandable).toBe(true);
    expect(block.errored).toBe(false);
  });

  test("errored work row is toned error with a fail glyph", () => {
    const block = at(
      buildBlocks([
        {
          kind: "work",
          workKind: "tool",
          status: "failed",
          id: "w2",
          toolName: "grep",
          output: "boom",
        },
      ]) as WorkBlock[],
    );
    expect(block.tone).toBe("error");
    expect(block.glyph).toBe("✗");
  });

  test("approval/question rows are attention-toned with a bang glyph", () => {
    const block = at(
      buildBlocks([
        { kind: "work", workKind: "approval", status: "pending", id: "w3", title: "run rm" },
      ]) as WorkBlock[],
    );
    expect(block.tone).toBe("attention");
    expect(block.glyph).toBe("!");
  });
});

describe("buildBlocks — file-change diffs", () => {
  test("reads the nested change object into a diff block", () => {
    const block = at(
      buildBlocks([
        {
          kind: "work",
          workKind: "file-change",
          callId: "c1",
          change: {
            path: "src/a.ts",
            kind: "modified",
            movePath: null,
            diff: "@@ -1 +1 @@\n-old\n+new",
            diffStats: { added: 1, removed: 1 },
          },
        },
      ]) as DiffBlock[],
    );
    expect(block.kind).toBe("diff");
    expect(block.path).toBe("src/a.ts");
    expect(block.changeKind).toBe("modified");
    expect(block.added).toBe(1);
    expect(block.removed).toBe(1);
    expect(block.patch).toContain("+new");
    expect(block.expandable).toBe(true);
  });

  test("null diff (binary/rename) yields a non-expandable stat-only diff block", () => {
    const block = at(
      buildBlocks([
        {
          kind: "work",
          workKind: "file-change",
          callId: "c2",
          change: {
            path: "logo.png",
            kind: "added",
            movePath: null,
            diff: null,
            diffStats: { added: 0, removed: 0 },
          },
        },
      ]) as DiffBlock[],
    );
    expect(block.patch).toBeNull();
    expect(block.expandable).toBe(false);
    expect(block.changeKind).toBe("added");
  });

  test("file-change without a change object falls back to a work block", () => {
    const block = at(
      buildBlocks([
        { kind: "work", workKind: "file-change", status: "success", id: "w4", path: "src/a.ts" },
      ]),
    );
    expect(block.kind).toBe("work");
    expect((block as WorkBlock).title).toBe("edit src/a.ts");
  });
});

describe("buildBlocks — system, turns, empty", () => {
  test("system row becomes a system block", () => {
    const block = at(buildBlocks([{ kind: "system", text: "context compacted" }]));
    expect(block.kind).toBe("system");
    expect((block as Extract<Block, { kind: "system" }>).text).toBe("context compacted");
  });

  test("recurses into turn children", () => {
    const blocks = buildBlocks([
      {
        kind: "turn",
        children: [
          { kind: "conversation", role: "user", text: "hi" },
          { kind: "work", workKind: "command", status: "success", id: "t1", command: "ls" },
        ],
      },
    ]);
    expect(kinds(blocks)).toEqual(["message", "work"]);
  });

  test("empty input yields a single empty block", () => {
    expect(buildBlocks([])).toEqual([{ kind: "empty", id: "empty" }]);
  });
});

describe("buildBlocks — ids, streaming, size cap, selection", () => {
  test("assigns unique ids even when rows lack or share ids", () => {
    const blocks = buildBlocks([
      { kind: "conversation", role: "user", text: "a" },
      { kind: "conversation", role: "assistant", text: "b" },
      { kind: "work", workKind: "command", status: "success", command: "ls" }, // no id
      { kind: "work", workKind: "command", status: "success", command: "pwd" }, // no id
    ]);
    const ids = blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("marks only a trailing assistant message as streaming", () => {
    const streamed = buildBlocks(
      [
        { kind: "conversation", role: "user", text: "q" },
        { kind: "conversation", role: "assistant", text: "partial" },
      ],
      { streaming: true },
    ) as MessageBlock[];
    expect(at(streamed, 1).streaming).toBe(true);
    expect(at(streamed, 0).streaming).toBe(false);

    const trailingUser = buildBlocks([{ kind: "conversation", role: "user", text: "q" }], {
      streaming: true,
    }) as MessageBlock[];
    expect(at(trailingUser, 0).streaming).toBe(false); // user turn is never "streaming"
  });

  test("caps oversized message text with a truncation notice", () => {
    const big = "x".repeat(50);
    const block = at(
      buildBlocks([{ kind: "conversation", role: "assistant", text: big }], {
        maxMessageChars: 10,
      }) as MessageBlock[],
    );
    expect(block.truncated).toBe(true);
    expect(block.text).toContain("… (message truncated)");
    expect(block.text.startsWith("xxxxxxxxxx")).toBe(true);
  });

  test("selectableIds returns expandable work and diff ids only", () => {
    const blocks = buildBlocks([
      { kind: "conversation", role: "user", text: "a" },
      {
        kind: "work",
        workKind: "command",
        status: "success",
        id: "w1",
        command: "ls",
        output: "x\ny",
      },
      { kind: "work", workKind: "command", status: "success", id: "w2", command: "noop" }, // no output
      {
        kind: "work",
        workKind: "file-change",
        callId: "d1",
        change: {
          path: "a",
          kind: "modified",
          movePath: null,
          diff: "@@\n+a",
          diffStats: { added: 1, removed: 0 },
        },
      },
    ]);
    expect(selectableIds(blocks)).toEqual(["w1", "d1"]);
  });

  test("disambiguates two rows that share an explicit id", () => {
    const blocks = buildBlocks([
      { kind: "work", workKind: "command", status: "success", id: "dup", command: "ls" },
      { kind: "work", workKind: "command", status: "success", id: "dup", command: "pwd" },
    ]);
    const ids = blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe("dup");
    expect(ids[1]).not.toBe("dup");
  });

  test("caps message text exactly at the boundary without truncating", () => {
    const [block] = buildBlocks([{ kind: "conversation", role: "assistant", text: "xxxxx" }], {
      maxMessageChars: 5,
    }) as MessageBlock[];
    expect(block?.truncated).toBe(false);
    expect(block?.text).toBe("xxxxx");
  });
});

describe("isTimelineActive", () => {
  test("true when a top-level work row is running", () => {
    expect(
      isTimelineActive([{ kind: "work", workKind: "command", status: "running", command: "x" }]),
    ).toBe(true);
  });

  test("true when a pending work row is nested in a turn", () => {
    expect(
      isTimelineActive([
        {
          kind: "turn",
          children: [{ kind: "work", workKind: "tool", status: "pending", toolName: "t" }],
        },
      ]),
    ).toBe(true);
  });

  test("false when nothing is running", () => {
    expect(
      isTimelineActive([
        { kind: "conversation", role: "assistant", text: "done" },
        { kind: "work", workKind: "command", status: "success", command: "x" },
      ]),
    ).toBe(false);
  });
});

describe("affordanceLabel / changeKindLabel", () => {
  test("affordanceLabel reflects reveal count, not '+additional'", () => {
    expect(affordanceLabel(false, false, 3)).toBe("");
    expect(affordanceLabel(true, false, 3)).toBe("  ▸ 3 lines");
    expect(affordanceLabel(true, true, 3)).toBe("  ▾");
  });

  test("changeKindLabel humanizes SDK change kinds and never says 'no changes'", () => {
    expect(changeKindLabel("type_changed")).toBe("type changed");
    expect(changeKindLabel("modified")).toBe("modified");
    expect(changeKindLabel(null)).toBe("changed");
  });
});

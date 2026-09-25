import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BoxRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { getThemeMode, setThemeMode, toneColor } from "../src/tui/theme.ts";
import { type Block, buildBlocks } from "../src/tui/timeline-model.ts";
import {
  type BlockOpts,
  type MountedBlock,
  mountBlock,
  reconcileBlocks,
} from "../src/tui/views/blocks.ts";

// Each headless renderer registers console listeners; destroy them so they don't pile up.
const live: Awaited<ReturnType<typeof createTestRenderer>>[] = [];
afterEach(() => {
  for (const t of live.splice(0)) t.renderer.destroy();
});

async function setup() {
  const t = await createTestRenderer({ width: 80, height: 24 });
  live.push(t);
  const container = new BoxRenderable(t.renderer, { flexDirection: "column" });
  t.renderer.root.add(container);
  return { t, container };
}

const noSelection = (_block: Block): BlockOpts => ({
  selected: false,
  expanded: false,
  maxLines: 50,
});

const SAMPLE: unknown[] = [
  { kind: "conversation", role: "user", text: "run the tests" },
  { kind: "conversation", role: "assistant", text: "Sure — running now.\n\n`inline`" },
  {
    kind: "work",
    workKind: "command",
    status: "success",
    id: "w1",
    command: "go test ./...",
    output: "ok\nPASS",
  },
  {
    kind: "work",
    workKind: "file-change",
    callId: "d1",
    change: {
      path: "src/a.ts",
      kind: "modified",
      movePath: null,
      diff: "@@ -1 +1 @@\n-old\n+new",
      diffStats: { added: 1, removed: 1 },
    },
  },
];

describe("mountBlock / reconcileBlocks", () => {
  let frameOf: (blocks: Block[], opts?: (b: Block) => BlockOpts) => Promise<string>;
  let mounted: Map<string, MountedBlock>;
  let containerRef: BoxRenderable;
  let rendererRef: Awaited<ReturnType<typeof createTestRenderer>>["renderer"];

  beforeEach(async () => {
    const { t, container } = await setup();
    containerRef = container;
    rendererRef = t.renderer;
    mounted = new Map();
    frameOf = async (blocks, opts = noSelection) => {
      mounted = reconcileBlocks(t.renderer, container, mounted, blocks, opts);
      await t.renderOnce();
      return t.captureCharFrame();
    };
  });

  test("renders role headers, a tool call, and a diff path into the frame", async () => {
    const frame = await frameOf(buildBlocks(SAMPLE));
    expect(frame).toContain("you");
    expect(frame).toContain("assistant");
    expect(frame).toContain("go test");
    expect(frame).toContain("src/a.ts");
  });

  test("paints user, assistant, and tool content in distinct colors in both themes", async () => {
    const previousMode = getThemeMode();
    const rgb = (hex: string) =>
      [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
    try {
      for (const mode of ["dark", "light"] as const) {
        setThemeMode(mode);
        const { t, container } = await setup();
        const blocks = buildBlocks([
          { kind: "conversation", role: "user", text: "USER_COLOR", id: "user" },
          { kind: "conversation", role: "assistant", text: "ASSISTANT_COLOR", id: "assistant" },
          { kind: "work", workKind: "tool", toolName: "TOOL_COLOR", id: "tool" },
        ]);
        reconcileBlocks(t.renderer, container, new Map(), blocks, noSelection);

        // MarkdownRenderable parses asynchronously; wait for its body before reading cells.
        const deadline = Date.now() + 2000;
        do {
          await t.renderOnce();
          if (t.captureCharFrame().includes("ASSISTANT_COLOR")) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        } while (Date.now() < deadline);

        const colorOf = (marker: string) => {
          const span = t
            .captureSpans()
            .lines.flatMap((line) => line.spans)
            .find((s) => s.text.includes(marker));
          expect(span).toBeDefined();
          return span?.fg.toInts().slice(0, 3);
        };
        expect(colorOf("USER_COLOR")).toEqual(rgb(toneColor("user")));
        expect(colorOf("ASSISTANT_COLOR")).toEqual(rgb(toneColor("assistant")));
        expect(colorOf("TOOL_COLOR")).toEqual(rgb(toneColor("toolcall")));
        expect(
          new Set([toneColor("user"), toneColor("assistant"), toneColor("toolcall")]).size,
        ).toBe(3);
      }
    } finally {
      setThemeMode(previousMode);
    }
  });

  test("mountBlock sets the block id on its root renderable (for scroll-into-view)", () => {
    const [block] = buildBlocks([{ kind: "conversation", role: "user", text: "hi" }]);
    if (!block) throw new Error("no block");
    const m = mountBlock(rendererRef, block, noSelection(block));
    expect(m.id).toBe(block.id);
    expect(m.root.id).toBe(block.id);
  });

  test("reconcile reuses the same renderable instance when id and kind are unchanged", async () => {
    await frameOf(buildBlocks(SAMPLE));
    const before = mounted.get("w1");
    expect(before).toBeDefined();

    // Rebuild with the assistant text extended (a mid-turn refresh); w1 is unchanged.
    const extended = [...SAMPLE];
    extended[1] = { kind: "conversation", role: "assistant", text: "Sure — running now.\n\nmore" };
    await frameOf(buildBlocks(extended));
    const after = mounted.get("w1");
    expect(after).toBe(before); // same MountedBlock, no destroy/recreate
    expect(after?.root).toBe(before?.root);
  });

  test("removed rows are dropped from the mounted map", async () => {
    await frameOf(buildBlocks(SAMPLE));
    expect(mounted.has("w1")).toBe(true);
    await frameOf(buildBlocks([{ kind: "conversation", role: "user", text: "only me" }]));
    expect(mounted.has("w1")).toBe(false);
  });

  test("selection draws the cursor glyph on the selected row", async () => {
    const selectW1 = (b: Block): BlockOpts => ({
      selected: b.id === "w1",
      expanded: false,
      maxLines: 50,
    });
    const frame = await frameOf(buildBlocks(SAMPLE), selectW1);
    expect(frame).toContain("❯");
  });

  test("expanding a diff shows patch lines", async () => {
    const expandD1 = (b: Block): BlockOpts => ({
      selected: false,
      expanded: b.id === "d1",
      maxLines: 50,
    });
    const frame = await frameOf(buildBlocks(SAMPLE), expandD1);
    expect(frame).toContain("+new");
  });

  test("empty transcript renders the placeholder", async () => {
    const frame = await frameOf(buildBlocks([]));
    expect(frame).toContain("no messages yet");
  });

  test("does not leak: container child count matches block count", async () => {
    await frameOf(buildBlocks(SAMPLE));
    expect(containerRef.getChildren().length).toBe(4);
    await frameOf(buildBlocks(SAMPLE.slice(0, 2)));
    expect(containerRef.getChildren().length).toBe(2);
  });

  test("a same-id row that changes kind (work → diff) is remounted, not updated", async () => {
    // Same callId "x1"; first a file-change without a change payload (work fallback),
    // then with one (diff) — the block id is stable but the kind flips.
    const asWork = [
      { kind: "work", workKind: "file-change", status: "success", callId: "x1", path: "a.ts" },
    ];
    const asDiff = [
      {
        kind: "work",
        workKind: "file-change",
        callId: "x1",
        change: {
          path: "a.ts",
          kind: "modified",
          movePath: null,
          diff: "@@\n+x",
          diffStats: { added: 1, removed: 0 },
        },
      },
    ];
    await frameOf(buildBlocks(asWork));
    const before = mounted.get("x1");
    expect(before?.kind).toBe("work");
    await frameOf(buildBlocks(asDiff));
    const after = mounted.get("x1");
    expect(after?.kind).toBe("diff");
    expect(after).not.toBe(before); // destroyed + remounted, not applied
    expect(after?.root).not.toBe(before?.root);
  });

  test("an assistant message with a blocked-scheme link renders verbatim, with a note", async () => {
    const frame = await frameOf(
      buildBlocks([
        {
          kind: "conversation",
          role: "assistant",
          id: "m1",
          text: "see [docs](javascript:evil())",
        },
      ]),
    );
    expect(frame).toContain("[docs](javascript:evil())"); // the real target stays visible
    expect(frame).toContain("blocked scheme");
  });

  test("a message that gains a blocked link mid-stream is remounted as plain text", async () => {
    await frameOf(
      buildBlocks([{ kind: "conversation", role: "assistant", id: "m1", text: "see [docs]" }]),
    );
    const before = mounted.get("m1");
    expect(before?.variant).toBe("assistant-markdown");
    await frameOf(
      buildBlocks([
        { kind: "conversation", role: "assistant", id: "m1", text: "see [docs](file:///etc)" },
      ]),
    );
    const after = mounted.get("m1");
    expect(after?.variant).toBe("assistant-plain");
    expect(after?.root).not.toBe(before?.root);
  });

  test("flipping the streaming flag reuses the same assistant renderable (no re-parse)", async () => {
    const rows: unknown[] = [
      { kind: "conversation", role: "assistant", text: "partial", id: "m1" },
      { kind: "work", workKind: "command", status: "running", id: "w9", command: "sleep" },
    ];
    await frameOf(buildBlocks(rows, { streaming: true })); // trailing assistant? no — work is last
    // Put the assistant last so it is the streaming target.
    const streaming: unknown[] = [
      { kind: "conversation", role: "assistant", text: "partial", id: "m1" },
    ];
    await frameOf(buildBlocks(streaming, { streaming: true }));
    const before = mounted.get("m1");
    expect(before?.kind).toBe("message");
    await frameOf(buildBlocks(streaming, { streaming: false }));
    const after = mounted.get("m1");
    expect(after).toBe(before); // same instance across the streaming flip
    expect(after?.root).toBe(before?.root);
  });

  test("user messages and system notes update in place when their text changes", async () => {
    const rows = (user: string, note: string): unknown[] => [
      { kind: "conversation", role: "user", text: user, id: "u1" },
      { kind: "system", text: note, id: "s1" },
    ];
    await frameOf(buildBlocks(rows("first draft", "context compacted")));
    const user = mounted.get("u1");
    const note = mounted.get("s1");
    const frame = await frameOf(buildBlocks(rows("second draft", "turn cancelled")));
    expect(frame).toContain("second draft");
    expect(frame).toContain("turn cancelled");
    expect(frame).not.toContain("first draft");
    expect(mounted.get("u1")).toBe(user);
    expect(mounted.get("s1")).toBe(note);
  });

  test("expanded output past maxLines is capped with a count of the hidden lines", async () => {
    const rows: unknown[] = [
      {
        kind: "work",
        workKind: "command",
        status: "success",
        id: "w1",
        command: "seq 3",
        output: "1\n2\n3",
      },
      {
        kind: "work",
        workKind: "file-change",
        callId: "d1",
        change: {
          path: "src/a.ts",
          kind: "modified",
          movePath: null,
          diff: "@@ -1 +1 @@\n-old\n+new",
          diffStats: { added: 1, removed: 1 },
        },
      },
    ];
    const expandAll = (_b: Block): BlockOpts => ({ selected: false, expanded: true, maxLines: 1 });
    const frame = await frameOf(buildBlocks(rows), expandAll);
    // Both the command output and the patch show 1 of 3 lines.
    expect(frame.match(/… \+2 more lines/g)).toHaveLength(2);
    expect(frame).not.toContain("+new");
  });
});

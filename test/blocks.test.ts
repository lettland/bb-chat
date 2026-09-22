import { beforeEach, describe, expect, test } from "bun:test";
import { BoxRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { type Block, buildBlocks } from "../src/tui/timeline-model.ts";
import {
  type BlockOpts,
  type MountedBlock,
  mountBlock,
  reconcileBlocks,
} from "../src/tui/views/blocks.ts";

async function setup() {
  const t = await createTestRenderer({ width: 80, height: 24 });
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
});

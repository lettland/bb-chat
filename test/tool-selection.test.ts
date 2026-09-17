import { describe, expect, test } from "bun:test";
import type { ToolAnchor } from "../src/tui/timeline-render.ts";
import { ToolSelection } from "../src/tui/tool-selection.ts";

const anchors = (...ids: string[]): ToolAnchor[] => ids.map((id, i) => ({ id, line: i * 10 }));

describe("ToolSelection", () => {
  test("first Tab selects the last tool, Shift+Tab the first", () => {
    const sel = new ToolSelection();
    sel.sync(anchors("a", "b", "c"));
    sel.move(1);
    expect(sel.selected).toBe("c");

    const back = new ToolSelection();
    back.sync(anchors("a", "b", "c"));
    back.move(-1);
    expect(back.selected).toBe("a");
  });

  test("move clamps at the ends", () => {
    const sel = new ToolSelection();
    sel.sync(anchors("a", "b"));
    sel.move(-1); // → first (a)
    sel.move(-1); // stays at a
    expect(sel.selected).toBe("a");
    sel.move(1); // b
    sel.move(1); // stays at b
    expect(sel.selected).toBe("b");
  });

  test("toggle expands/collapses only the selected tool", () => {
    const sel = new ToolSelection();
    sel.sync(anchors("a", "b"));
    expect(sel.toggle()).toBe(false); // nothing selected yet
    sel.move(1); // b
    expect(sel.toggle()).toBe(true);
    expect([...sel.expanded]).toEqual(["b"]);
    expect(sel.toggle()).toBe(true);
    expect([...sel.expanded]).toEqual([]);
  });

  test("sync forgets a selection whose tool disappeared", () => {
    const sel = new ToolSelection();
    sel.sync(anchors("a", "b"));
    sel.move(-1); // a
    sel.sync(anchors("b", "c")); // a is gone
    expect(sel.selected).toBeNull();
    expect(sel.selectedLine()).toBeNull();
  });

  test("selectedLine reports the anchor line of the selection", () => {
    const sel = new ToolSelection();
    sel.sync(anchors("a", "b", "c")); // lines 0, 10, 20
    sel.move(1); // c
    expect(sel.selectedLine()).toBe(20);
  });
});

import { describe, expect, test } from "bun:test";
import { ToolSelection } from "../src/tui/tool-selection.ts";

describe("ToolSelection", () => {
  test("first Tab selects the last row, Shift+Tab the first", () => {
    const sel = new ToolSelection();
    sel.sync(["a", "b", "c"]);
    sel.move(1);
    expect(sel.selected).toBe("c");

    const back = new ToolSelection();
    back.sync(["a", "b", "c"]);
    back.move(-1);
    expect(back.selected).toBe("a");
  });

  test("move clamps at the ends", () => {
    const sel = new ToolSelection();
    sel.sync(["a", "b"]);
    sel.move(-1); // → first (a)
    sel.move(-1); // stays at a
    expect(sel.selected).toBe("a");
    sel.move(1); // b
    sel.move(1); // stays at b
    expect(sel.selected).toBe("b");
  });

  test("toggle expands/collapses only the selected row", () => {
    const sel = new ToolSelection();
    sel.sync(["a", "b"]);
    expect(sel.toggle()).toBe(false); // nothing selected yet
    sel.move(1); // b
    expect(sel.toggle()).toBe(true);
    expect([...sel.expanded]).toEqual(["b"]);
    expect(sel.toggle()).toBe(true);
    expect([...sel.expanded]).toEqual([]);
  });

  test("sync forgets a selection whose row disappeared", () => {
    const sel = new ToolSelection();
    sel.sync(["a", "b"]);
    sel.move(-1); // a
    sel.sync(["b", "c"]); // a is gone
    expect(sel.selected).toBeNull();
  });

  test("sync keeps a still-present selection across a rebuild", () => {
    const sel = new ToolSelection();
    sel.sync(["a", "b", "c"]);
    sel.move(1); // c
    sel.sync(["a", "c"]); // c still present
    expect(sel.selected).toBe("c");
  });
});

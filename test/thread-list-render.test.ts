import { describe, expect, test } from "bun:test";
import { formatThreadRow, renderThreadList } from "../src/tui/thread-list-render.ts";

describe("renderThreadList", () => {
  test("sorts newest first and applies title fallback", () => {
    const rows = renderThreadList([
      { id: "t1", title: "old", status: "idle", updatedAt: 100 },
      { id: "t2", title: null, titleFallback: "fresh", status: "active", updatedAt: 200 },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["t2", "t1"]);
    expect(rows[0]?.title).toBe("fresh");
  });

  test("untitled when no title or fallback", () => {
    const rows = renderThreadList([{ id: "t1", status: "idle", updatedAt: 1 }]);
    expect(rows[0]?.title).toBe("(untitled)");
  });

  test("flags pending interaction as attention", () => {
    const rows = renderThreadList([
      { id: "t1", title: "x", status: "active", updatedAt: 1, hasPendingInteraction: true },
    ]);
    expect(rows[0]?.attention).toBe(true);
  });

  test("drops archived, deleted and hidden threads", () => {
    const rows = renderThreadList([
      {
        id: "live",
        title: "live",
        status: "idle",
        updatedAt: 4,
        archivedAt: null,
        deletedAt: null,
      },
      { id: "arch", title: "archived", status: "idle", updatedAt: 3, archivedAt: 1700000000000 },
      { id: "del", title: "deleted", status: "idle", updatedAt: 2, deletedAt: 1700000000000 },
      { id: "hid", title: "hidden", status: "idle", updatedAt: 1, visibility: "hidden" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["live"]);
  });

  test("skips entries without an id", () => {
    expect(renderThreadList([{ title: "no id" }, null, "x"])).toEqual([]);
  });
});

describe("formatThreadRow", () => {
  test("marks attention rows and pads status", () => {
    const line = formatThreadRow({
      id: "t1",
      title: "Fix bug",
      status: "active",
      attention: true,
      updatedAt: 1,
    });
    expect(line.startsWith("!")).toBe(true);
    expect(line).toContain("active");
    expect(line).toContain("Fix bug");
  });

  test("no marker without attention", () => {
    const line = formatThreadRow({
      id: "t1",
      title: "x",
      status: "idle",
      attention: false,
      updatedAt: 1,
    });
    expect(line.startsWith(" ")).toBe(true);
  });
});

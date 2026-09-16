import { describe, expect, test } from "bun:test";
import { formatProjectRow, toProjectRows } from "../src/tui/project-list-render.ts";

describe("toProjectRows", () => {
  test("sorts by name", () => {
    const rows = toProjectRows([
      { id: "p2", name: "zeta" },
      { id: "p1", name: "alpha" },
    ]);
    expect(rows.map((r) => r.name)).toEqual(["alpha", "zeta"]);
    expect(rows.map((r) => r.id)).toEqual(["p1", "p2"]);
  });

  test("defaults the name and skips id-less entries", () => {
    const rows = toProjectRows([{ id: "p1" }, { name: "no id" }, null]);
    expect(rows).toEqual([{ id: "p1", name: "(unnamed)" }]);
  });
});

describe("formatProjectRow", () => {
  test("renders the project name", () => {
    expect(formatProjectRow({ id: "p", name: "ci" })).toBe("ci");
  });
});

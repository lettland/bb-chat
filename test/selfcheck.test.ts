import { describe, expect, test } from "bun:test";
import { type Highlighter, runSelfcheck } from "../src/cli/selfcheck.ts";

function fake(overrides: Partial<Highlighter> = {}): Highlighter {
  return {
    initialize: async () => {},
    highlightOnce: async () => ({ highlights: [1, 2, 3] }),
    destroy: async () => {},
    ...overrides,
  };
}

async function run(highlighter: Highlighter | (() => Promise<Highlighter>), timeoutMs = 200) {
  const lines: string[] = [];
  const load = typeof highlighter === "function" ? highlighter : async () => highlighter;
  const code = await runSelfcheck({
    loadHighlighter: load,
    timeoutMs,
    write: (l) => lines.push(l),
  });
  return { code, out: lines.join("\n") };
}

describe("runSelfcheck", () => {
  test("passes when every probe highlights", async () => {
    const { code, out } = await run(fake());
    expect(code).toBe(0);
    expect(out).toContain("selfcheck passed");
  });

  test("fails when a probe yields no highlights (e.g. grammar not embedded)", async () => {
    const { code, out } = await run(
      fake({ highlightOnce: async () => ({ highlights: [], warning: "No parser available" }) }),
    );
    expect(code).toBe(1);
    expect(out).toContain("FAIL typescript: 0 highlights (No parser available)");
  });

  test("fails, rather than hanging, when the parser never answers", async () => {
    const { code, out } = await run(fake({ initialize: () => new Promise(() => {}) }), 30);
    expect(code).toBe(1);
    expect(out).toContain("timed out");
  });

  test("fails when anything attempts a network fetch", async () => {
    const { code, out } = await run(
      fake({
        highlightOnce: async () => {
          await globalThis.fetch("https://example.com/grammar.wasm").catch(() => {});
          return { highlights: [1] };
        },
      }),
    );
    expect(code).toBe(1);
    expect(out).toContain("network was attempted");
  });

  test("always restores fetch — even when loading the highlighter throws", async () => {
    const before = globalThis.fetch;
    const { code } = await run(async () => {
      throw new Error("no native module");
    });
    expect(code).toBe(1);
    expect(globalThis.fetch).toBe(before);
  });
});

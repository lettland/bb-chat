import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { ListPanel, Screen } from "../src/tui/views/chrome.ts";

const ESC = String.fromCharCode(0x1b);

// Each headless renderer registers console listeners; destroy them so they don't pile up.
type TestSetup = Awaited<ReturnType<typeof createTestRenderer>>;
const live: TestSetup[] = [];
async function makeRenderer(width: number, height: number): Promise<TestSetup> {
  const t = await createTestRenderer({ width, height });
  live.push(t);
  return t;
}
afterEach(() => {
  for (const t of live.splice(0)) t.renderer.destroy();
});

async function frame(
  width: number,
  build: (r: Awaited<ReturnType<typeof createTestRenderer>>["renderer"]) => Screen,
) {
  const t = await makeRenderer(width, 20);
  const screen = build(t.renderer);
  t.renderer.root.add(screen.outer);
  await t.renderOnce();
  await t.renderOnce(); // second pass: footer re-fits to its measured width
  return { t, screen, text: t.captureCharFrame() };
}

describe("Screen", () => {
  test("renders the title, subtitle, status context and hints", async () => {
    const { text } = await frame(100, (r) => {
      const s = new Screen(r, { title: "my thread", subtitle: "feat/x", hints: "q quit" });
      s.setContext(["claude", "active"]);
      return s;
    });
    expect(text).toContain("my thread");
    expect(text).toContain("feat/x");
    expect(text).toContain("claude · active");
    expect(text).toContain("q quit");
  });

  test("sanitizes an escape-laden title", async () => {
    const { text } = await frame(
      80,
      (r) => new Screen(r, { title: `${ESC}]0;pwned${ESC}\\safe`, hints: "" }),
    );
    expect(text).toContain("safe");
    expect(text).not.toContain("pwned");
  });

  test("drops the hints on a narrow terminal instead of wrapping", async () => {
    const { text } = await frame(30, (r) => {
      const s = new Screen(r, { title: "t", hints: "tab select · ctrl+e expand · esc back" });
      s.setContext(["claude", "active"]);
      return s;
    });
    expect(text).toContain("claude · active");
    expect(text).not.toContain("ctrl+e expand");
  });

  test("shows the wordmark only when asked", async () => {
    const withMark = await frame(
      80,
      (r) => new Screen(r, { title: "home", hints: "", wordmark: true }),
    );
    const without = await frame(80, (r) => new Screen(r, { title: "home", hints: "" }));
    // The wordmark adds rows above the header, so the title lands lower.
    const row = (f: string) => f.split("\n").findIndex((l) => l.includes("home"));
    expect(row(withMark.text)).toBeGreaterThan(row(without.text));
  });
});

describe("ListPanel", () => {
  async function panel() {
    const t = await makeRenderer(60, 12);
    const p = new ListPanel(t.renderer);
    t.renderer.root.add(p.root);
    return { t, p };
  }

  test("shows the loading message until items arrive, then the items", async () => {
    const { t, p } = await panel();
    await t.renderOnce();
    expect(t.captureCharFrame()).toContain("loading");
    p.setItems(["alpha", "beta", "gamma"], "nothing here");
    await t.renderOnce();
    const text = t.captureCharFrame();
    expect(text).toContain("alpha");
    expect(text).toContain("gamma");
    expect(text).not.toContain("loading");
  });

  test("an empty list shows the empty text", async () => {
    const { t, p } = await panel();
    p.setItems([], "no threads yet — press n to start one");
    await t.renderOnce();
    expect(t.captureCharFrame()).toContain("no threads yet");
    expect(p.size).toBe(0);
  });

  test("select clamps into range", async () => {
    const { p } = await panel();
    p.setItems(["a", "b"], "none");
    expect(p.select(5)).toBe(1);
    expect(p.select(-3)).toBe(0);
  });

  test("an error message replaces the list", async () => {
    const { t, p } = await panel();
    p.setItems(["alpha"], "none");
    p.showMessage("error loading threads: boom", "error");
    await t.renderOnce();
    const text = t.captureCharFrame();
    expect(text).toContain("error loading threads: boom");
    expect(text).not.toContain("alpha");
  });
});

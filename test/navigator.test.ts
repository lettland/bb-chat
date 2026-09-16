import { describe, expect, test } from "bun:test";
import type { CliRenderer, KeyEvent } from "@opentui/core";
import { Navigator, type View, type ViewHost } from "../src/tui/navigator.ts";

class FakeView implements View {
  mounts = 0;
  unmounts = 0;
  keys: string[] = [];
  constructor(readonly title: string) {}
  mount(_host: ViewHost): void {
    this.mounts++;
  }
  unmount(): void {
    this.unmounts++;
  }
  onKey(key: KeyEvent): void {
    this.keys.push(key.name ?? "");
  }
}

class ThrowingView implements View {
  readonly title = "bad";
  mounts = 0;
  unmounts = 0;
  mount(_host: ViewHost): void {
    this.mounts++;
    throw new Error("mount failed");
  }
  unmount(): void {
    this.unmounts++;
  }
  onKey(_key: KeyEvent): void {}
}

const key = (name: string): KeyEvent => ({ name }) as unknown as KeyEvent;

function makeNavigator(): { nav: Navigator; state: { exits: number } } {
  const state = { exits: 0 };
  const nav = new Navigator({
    renderer: {} as unknown as CliRenderer,
    exit: () => {
      state.exits++;
    },
  });
  return { nav, state };
}

describe("Navigator", () => {
  test("push mounts and tracks the top view", async () => {
    const { nav } = makeNavigator();
    const a = new FakeView("a");
    await nav.push(a);
    expect(nav.depth).toBe(1);
    expect(nav.current).toBe(a);
    expect(a.mounts).toBe(1);
  });

  test("pushing a second view unmounts the first, mounts the second", async () => {
    const { nav } = makeNavigator();
    const a = new FakeView("a");
    const b = new FakeView("b");
    await nav.push(a);
    await nav.push(b);
    expect(nav.depth).toBe(2);
    expect(a.unmounts).toBe(1);
    expect(b.mounts).toBe(1);
    expect(nav.current).toBe(b);
  });

  test("keys route to the top view only", async () => {
    const { nav } = makeNavigator();
    const a = new FakeView("a");
    const b = new FakeView("b");
    await nav.push(a);
    await nav.push(b);
    nav.handleKey(key("x"));
    expect(a.keys).toEqual([]);
    expect(b.keys).toEqual(["x"]);
  });

  test("pop unmounts top and re-mounts the previous", async () => {
    const { nav } = makeNavigator();
    const a = new FakeView("a");
    const b = new FakeView("b");
    await nav.push(a);
    await nav.push(b);
    await nav.pop();
    expect(nav.depth).toBe(1);
    expect(nav.current).toBe(a);
    expect(b.unmounts).toBe(1);
    expect(a.mounts).toBe(2); // mounted again on return
  });

  test("popping the last view exits", async () => {
    const { nav, state } = makeNavigator();
    const a = new FakeView("a");
    await nav.push(a);
    await nav.pop();
    expect(nav.depth).toBe(0);
    expect(state.exits).toBe(1);
  });

  test("a view whose mount throws is rolled back to the previous", async () => {
    const { nav } = makeNavigator();
    const a = new FakeView("a");
    const bad = new ThrowingView();
    await nav.push(a);
    await nav.push(bad);
    expect(nav.depth).toBe(1);
    expect(nav.current).toBe(a);
    expect(a.mounts).toBe(2); // re-mounted after rollback
  });

  test("a failing push with nothing to fall back to exits", async () => {
    const { nav, state } = makeNavigator();
    await nav.push(new ThrowingView());
    expect(nav.depth).toBe(0);
    expect(state.exits).toBe(1);
  });

  test("replace swaps the top view", async () => {
    const { nav } = makeNavigator();
    const a = new FakeView("a");
    const b = new FakeView("b");
    await nav.push(a);
    await nav.replace(b);
    expect(nav.depth).toBe(1);
    expect(nav.current).toBe(b);
    expect(a.unmounts).toBe(1);
  });
});

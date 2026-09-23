import { afterEach, describe, expect, test } from "bun:test";
import type { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { BBSdk } from "../src/bb/sdk.ts";
import { Navigator } from "../src/tui/navigator.ts";
import { DiffView } from "../src/tui/views/diff-view.ts";
import { GlobalHomeView } from "../src/tui/views/global-home-view.ts";
import { MessageView } from "../src/tui/views/message-view.ts";
import { PluginsView } from "../src/tui/views/plugins-view.ts";
import { SkillsView } from "../src/tui/views/skills-view.ts";
import { SpawnWizardView } from "../src/tui/views/spawn-wizard-view.ts";
import { TerminalsView } from "../src/tui/views/terminals-view.ts";
import { ThreadListView } from "../src/tui/views/thread-list-view.ts";
import { ThreadView } from "../src/tui/views/thread-view.ts";

type TestSetup = Awaited<ReturnType<typeof createTestRenderer>>;
const live: TestSetup[] = [];
afterEach(() => {
  for (const t of live.splice(0)) t.renderer.destroy();
});

const THREADS = [
  { id: "thr_a", title: "Fix the flaky test", status: "idle", updatedAt: 3 },
  { id: "thr_b", title: "Add dark mode", status: "active", updatedAt: 2 },
  { id: "thr_c", title: "Bump deps", status: "idle", updatedAt: 1, hasPendingInteraction: true },
];

interface StubOptions {
  threads?: unknown[];
  listError?: Error;
  metaError?: Error;
}

/** A stub SDK covering the calls every view makes. */
function fakeSdk(o: StubOptions = {}): BBSdk {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
  return {
    threads: {
      list: async () => {
        if (o.listError) throw o.listError;
        return o.threads ?? THREADS;
      },
      timeline: async () => ({
        rows: [
          { kind: "conversation", role: "user", text: "hello", id: "m1" },
          { kind: "conversation", role: "assistant", text: "**hi** there", id: "m2" },
        ],
        timelinePage: {},
      }),
      get: async () => {
        if (o.metaError) throw o.metaError;
        return {
          title: "Fix the flaky test",
          providerId: "claude-code",
          status: "idle",
          environmentId: "env_1",
          environmentBranchName: "fix/flaky",
        };
      },
      send: async () => ({}),
    },
    projects: {
      list: async () => [
        { id: "p1", name: "vch" },
        { id: "p2", name: "ripwire" },
      ],
    },
    providers: {
      list: async () => [{ id: "claude-code", name: "Claude Code" }, { id: "codex" }],
      models: async () => ({ models: [{ id: "opus-5", displayName: "Opus 5" }] }),
    },
    skills: {
      list: async () => ({
        skills: [
          { id: "s1", name: "tdd" },
          { id: "s2", name: "debug" },
        ],
      }),
    },
    plugins: {
      list: async () => ({
        plugins: [
          { id: "a", name: "advisor", enabled: true },
          { id: "b", name: "bb-guide", enabled: false },
        ],
      }),
    },
    terminals: {
      list: async () => ({ sessions: [{ id: "t1", title: "dev server", status: "running" }] }),
      output: async () => ({ chunks: [{ dataBase64: b64("listening on :3000\n") }] }),
    },
    environments: {
      diffFiles: async () => ({
        outcome: "available",
        files: [{ path: "src/a.ts", changeKind: "modified", additions: 1, deletions: 1 }],
        initialPatches: [{ path: "src/a.ts", patch: "@@ -1 +1 @@\n-old\n+new" }],
      }),
    },
    subscribe: () => () => {},
  } as unknown as BBSdk;
}

/** Poll until `check` passes (instead of guessing a sleep), rendering between tries. */
async function eventually(t: TestSetup, check: () => boolean | Promise<boolean>, ms = 2000) {
  const deadline = Date.now() + ms;
  for (;;) {
    await t.renderOnce();
    if (await check()) return;
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function boot() {
  const t = await createTestRenderer({ width: 100, height: 30 });
  live.push(t);
  let exited = false;
  const navigator = new Navigator({ renderer: t.renderer, exit: () => (exited = true) });
  const press = (name: string) =>
    navigator.handleKey({ name, ctrl: false, shift: false, meta: false } as KeyEvent);
  const frame = async () => {
    await t.renderOnce();
    await t.renderOnce();
    return t.captureCharFrame();
  };
  /** Wait until the rendered frame contains `text`, then return the frame. */
  const shows = async (text: string) => {
    await eventually(t, () => t.captureCharFrame().includes(text));
    return t.captureCharFrame();
  };
  return { t, navigator, press, frame, shows, exited: () => exited };
}

const project = { id: "prj_1", name: "vch" };

describe("ThreadListView (keyboard parity after the SelectRenderable migration)", () => {
  test("renders the project, threads, count and hints", async () => {
    const app = await boot();
    await app.navigator.push(new ThreadListView(fakeSdk(), project));
    const text = await app.shows("3 threads");
    expect(text).toContain("Fix the flaky test");
    expect(text).toContain("Bump deps");
    expect(text).toContain("n new");
    expect(text).toContain("q quit"); // root view: q quits
  });

  test("enter opens the highlighted thread; j/k move the highlight", async () => {
    const app = await boot();
    await app.navigator.push(new ThreadListView(fakeSdk(), project));
    await app.shows("3 threads");
    app.press("j");
    app.press("j");
    app.press("k"); // net: second row
    app.press("return");
    await eventually(app.t, () => app.navigator.current instanceof ThreadView);
    expect(app.navigator.depth).toBe(2);
    // Newest-first order is a, b, c — so j j k lands on the second thread.
    expect((app.navigator.current as unknown as { threadId: string }).threadId).toBe("thr_b");
  });

  test("n opens the spawn wizard, p opens skills, esc comes back", async () => {
    const app = await boot();
    await app.navigator.push(new ThreadListView(fakeSdk(), project));
    await app.shows("3 threads");
    app.press("n");
    await eventually(app.t, () => app.navigator.current?.title === "new thread");
    app.press("escape");
    await eventually(app.t, () => app.navigator.current?.title === "threads");
    app.press("p");
    await eventually(app.t, () => app.navigator.current?.title === "skills");
    await app.shows("tdd");
  });

  test("q pops (and exits when it is the last view)", async () => {
    const app = await boot();
    await app.navigator.push(new ThreadListView(fakeSdk(), project));
    app.press("q");
    await eventually(app.t, () => app.exited());
  });

  test("empty and error states render their copy", async () => {
    const empty = await boot();
    await empty.navigator.push(new ThreadListView(fakeSdk({ threads: [] }), project));
    await empty.shows("no threads yet — press n to start one");

    const broken = await boot();
    const failing = fakeSdk({ listError: new Error("server down") });
    await broken.navigator.push(new ThreadListView(failing, project));
    await broken.shows("error loading threads: server down");
  });
});

describe("GlobalHomeView", () => {
  test("lists projects; enter opens a project's threads, which then says 'q back'", async () => {
    const app = await boot();
    await app.navigator.push(new GlobalHomeView(fakeSdk()));
    const text = await app.shows("2 projects");
    expect(text).toContain("ripwire");
    expect(text).toContain("all projects");
    app.press("return"); // projects sort by name → "ripwire" first
    await eventually(app.t, () => app.navigator.current?.title === "threads");
    const threads = await app.shows("3 threads");
    expect(threads).toContain("q back"); // not the root any more
  });
});

describe("remount race", () => {
  test("a fetch from before a push/pop cannot paint stale rows into the remounted view", async () => {
    const app = await boot();
    const base = fakeSdk();
    let releaseStale: (v: unknown) => void = () => {};
    let calls = 0;
    const sdk = {
      ...base,
      projects: {
        list: () => {
          calls += 1;
          if (calls === 1) return new Promise((r) => (releaseStale = r)); // held open
          return Promise.resolve([{ id: "p9", name: "fresh-project" }]);
        },
      },
    } as unknown as BBSdk;
    void app.navigator.push(new GlobalHomeView(sdk)); // first fetch stays pending
    await eventually(app.t, () => calls === 1);
    await app.navigator.push(new PluginsView(sdk)); // unmounts home
    await app.navigator.pop(); // remounts home → second fetch
    await app.shows("fresh-project");
    releaseStale([{ id: "p1", name: "stale-project" }]); // the old fetch lands late
    await new Promise((r) => setTimeout(r, 20));
    const text = await app.frame();
    expect(text).toContain("fresh-project");
    expect(text).not.toContain("stale-project");
  });
});

describe("SkillsView / PluginsView", () => {
  test("skills list with count; j/k scroll without leaving the view", async () => {
    const app = await boot();
    await app.navigator.push(new SkillsView(fakeSdk(), "prj_1"));
    const text = await app.shows("2 skills");
    expect(text).toContain("debug");
    app.press("j");
    app.press("k");
    expect(app.navigator.current?.title).toBe("skills");
  });

  test("plugins list shows installed and enabled counts", async () => {
    const app = await boot();
    await app.navigator.push(new PluginsView(fakeSdk()));
    const text = await app.shows("2 installed · 1 enabled");
    expect(text).toContain("advisor");
  });
});

describe("SpawnWizardView", () => {
  test("walks provider → model with step progress and a status-bar summary", async () => {
    const app = await boot();
    await app.navigator.push(new SpawnWizardView(fakeSdk(), async () => project));
    let text = await app.shows("step 1/4 · provider");
    expect(text).toContain("Claude Code");
    app.press("return"); // choose the highlighted provider
    text = await app.shows("Opus 5"); // models load after the provider is chosen
    expect(text).toContain("step 2/4 · model");
    expect(text).toContain("Claude Code"); // chosen provider in the status bar
  });
});

describe("TerminalsView", () => {
  test("lists sessions and shows the selected session's output", async () => {
    const app = await boot();
    await app.navigator.push(new TerminalsView(fakeSdk(), "thr_a"));
    const text = await app.shows("listening on :3000");
    expect(text).toContain("dev server  [running]");
    expect(text).toContain("1 terminal");
  });
});

describe("DiffView", () => {
  test("renders the patch and a changed-file count; scroll keys stay in the view", async () => {
    const app = await boot();
    await app.navigator.push(new DiffView(fakeSdk(), "thr_a"));
    const text = await app.shows("1 file changed");
    expect(text).toContain("+new");
    app.press("j");
    app.press("pagedown");
    app.press("home");
    expect(app.navigator.current?.title).toBe("diff");
  });
});

describe("ThreadView chrome", () => {
  test("header shows the real title and branch; status bar shows provider and status", async () => {
    const app = await boot();
    await app.navigator.push(new ThreadView(fakeSdk(), "thr_a", "thr_a"));
    const text = await app.shows("claude-code · idle");
    expect(text).toContain("Fix the flaky test");
    expect(text).toContain("fix/flaky");
    expect(text).toContain("hello");
    expect(text).toContain("enter send");
    expect(text).toContain("esc quit"); // opened directly: esc leaves vch
  });

  test("a metadata failure still renders the transcript with the fallback title", async () => {
    const app = await boot();
    const sdk = fakeSdk({ metaError: new Error("get failed") });
    await app.navigator.push(new ThreadView(sdk, "thr_a", "thr_fallback"));
    const text = await app.shows("hello");
    expect(text).toContain("thr_fallback");
    expect(text).not.toContain("loading…"); // the status bar left its loading state
  });
});

describe("MessageView", () => {
  test("renders its lines with the shared chrome", async () => {
    const app = await boot();
    await app.navigator.push(new MessageView("vch", ["No project in focus."]));
    const text = await app.shows("No project in focus.");
    expect(text).toContain("q or esc to go back");
  });
});

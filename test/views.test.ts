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
  timelineRows?: () => unknown[];
  timelineError?: Error;
  /** Receives every message the view sends; set `sendError` to fail the send. */
  sent?: string[];
  sendError?: Error;
  /** Receives the realtime callback so a test can simulate a server push. */
  onSubscribe?: (callback: () => void) => void;
  providersError?: Error;
  modelsError?: Error;
  spawnResult?: unknown;
  spawnError?: Error;
  terminals?: unknown[];
  terminalsError?: Error;
  outputError?: Error;
  environmentId?: string | null;
  diffError?: Error;
  skillsError?: Error;
  pluginsError?: Error;
  /** The thread-list plugin's preferences (mutated by writes); omit for a BB without groups. */
  prefs?: Record<string, unknown>;
  /** Fail the thread-list plugin's RPCs (reads and writes). */
  rpcError?: Error;
  projects?: unknown[];
}

/** A stub SDK covering the calls every view makes. */
function fakeSdk(o: StubOptions = {}): BBSdk {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
  const fail = (error: Error | undefined) => {
    if (error) throw error;
  };
  return {
    threads: {
      list: async () => {
        fail(o.listError);
        return o.threads ?? THREADS;
      },
      timeline: async () => {
        fail(o.timelineError);
        return {
          rows: o.timelineRows?.() ?? [
            { kind: "conversation", role: "user", text: "hello", id: "m1" },
            { kind: "conversation", role: "assistant", text: "**hi** there", id: "m2" },
          ],
          timelinePage: {},
        };
      },
      get: async () => {
        fail(o.metaError);
        return {
          title: "Fix the flaky test",
          providerId: "claude-code",
          status: "idle",
          environmentId: o.environmentId === undefined ? "env_1" : o.environmentId,
          environmentBranchName: "fix/flaky",
        };
      },
      send: async (args: { input: { text: string }[] }) => {
        fail(o.sendError);
        o.sent?.push(args.input[0]?.text ?? "");
        return {};
      },
      spawn: async () => {
        fail(o.spawnError);
        return o.spawnResult ?? { threadId: "thr_new" };
      },
    },
    projects: {
      list: async () =>
        o.projects ?? [
          { id: "p1", name: "bbchat" },
          { id: "p2", name: "ripwire" },
        ],
    },
    providers: {
      list: async () => {
        fail(o.providersError);
        return [{ id: "claude-code", name: "Claude Code" }, { id: "codex" }];
      },
      models: async () => {
        fail(o.modelsError);
        return { models: [{ id: "opus-5", displayName: "Opus 5" }] };
      },
    },
    skills: {
      list: async () => {
        fail(o.skillsError);
        return {
          skills: [
            { id: "s1", name: "tdd" },
            { id: "s2", name: "debug" },
          ],
        };
      },
    },
    plugins: {
      list: async () => {
        fail(o.pluginsError);
        return {
          plugins: [
            { id: "a", name: "advisor", enabled: true },
            { id: "b", name: "bb-guide", enabled: false },
          ],
        };
      },
      callRpc: async (args: { method: string; input?: unknown }) => {
        fail(o.rpcError);
        const prefs = o.prefs ?? {};
        if (args.method === "setPreference") {
          const { key, value } = args.input as { key: string; value: unknown };
          prefs[key] = value;
          return { key, value };
        }
        return { preferences: { ...prefs } };
      },
    },
    terminals: {
      list: async () => {
        fail(o.terminalsError);
        return {
          sessions: o.terminals ?? [{ id: "t1", title: "dev server", status: "running" }],
        };
      },
      output: async (args: { terminalId: string }) => {
        fail(o.outputError);
        if (args.terminalId === "t_quiet") return { chunks: [] };
        return {
          chunks: [
            { dataBase64: b64(`${args.terminalId === "t2" ? "built" : "listening on :3000"}\n`) },
          ],
        };
      },
    },
    environments: {
      diffFiles: async () => {
        fail(o.diffError);
        return {
          outcome: "available",
          files: [{ path: "src/a.ts", changeKind: "modified", additions: 1, deletions: 1 }],
          initialPatches: [{ path: "src/a.ts", patch: "@@ -1 +1 @@\n-old\n+new" }],
        };
      },
    },
    subscribe: (s: { callback: () => void }) => {
      o.onSubscribe?.(s.callback);
      return () => {};
    },
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
  const press = (name: string, mods: Partial<Pick<KeyEvent, "ctrl" | "shift">> = {}) =>
    navigator.handleKey({ name, ctrl: false, shift: false, meta: false, ...mods } as KeyEvent);
  /** Type printable text into whatever composer has focus. */
  const type = (text: string) => {
    for (const ch of text) {
      navigator.handleKey({ name: ch, sequence: ch, ctrl: false, meta: false } as KeyEvent);
    }
  };
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
  return { t, navigator, press, type, frame, shows, exited: () => exited };
}

const project = { id: "prj_1", name: "bbchat" };

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

describe("GlobalHomeView project groups", () => {
  const projects = [
    { id: "p1", name: "bbchat" },
    { id: "p2", name: "ripwire" },
    { id: "p3", name: "aerotime" },
  ];
  const withGroups = () => ({
    projectGroups: [{ id: "g1", name: "dev", projectIds: ["p3"] }],
    collapsedProjectGroups: [] as string[],
  });

  test("shows groups with indented members; enter on a header folds it and saves that", async () => {
    const app = await boot();
    const prefs: Record<string, unknown> = withGroups();
    await app.navigator.push(new GlobalHomeView(fakeSdk({ projects, prefs })));
    const text = await app.shows("1 group");
    expect(text).toContain("▾ dev (1)");
    expect(text).toContain("    aerotime");
    // Rows: bbchat, ▾ dev, aerotime, ripwire — move to the header.
    app.press("j");
    await app.shows("e rename");
    app.press("return");
    await app.shows("▸ dev (1)");
    expect(await app.frame()).not.toContain("aerotime");
    await eventually(app.t, () => (prefs.collapsedProjectGroups as string[]).includes("g1"));
    app.press("return");
    await app.shows("▾ dev (1)");
    await eventually(app.t, () => (prefs.collapsedProjectGroups as string[]).length === 0);
  });

  test("g moves a project into an existing group, then home shows it there", async () => {
    const app = await boot();
    const prefs: Record<string, unknown> = withGroups();
    await app.navigator.push(new GlobalHomeView(fakeSdk({ projects, prefs })));
    await app.shows("1 group");
    app.press("g"); // on bbchat
    await eventually(app.t, () => app.navigator.current?.title === "project group");
    const picker = await app.shows("+ new group…");
    expect(picker).toContain("move to group");
    expect(picker).toContain("ungrouped");
    app.press("return"); // "dev" is the first choice
    await eventually(app.t, () => app.navigator.current?.title === "projects");
    await app.shows("▾ dev (2)");
    expect(prefs.projectGroups).toEqual([{ id: "g1", name: "dev", projectIds: ["p3", "p1"] }]);
  });

  test("g → new group asks for a name; esc returns to the picker", async () => {
    const app = await boot();
    const prefs: Record<string, unknown> = withGroups();
    await app.navigator.push(new GlobalHomeView(fakeSdk({ projects, prefs })));
    await app.shows("1 group");
    app.press("j");
    app.press("j"); // aerotime, already in "dev"
    app.press("g");
    await app.shows("− remove from dev");
    app.press("j"); // + new group…
    app.press("return");
    await app.shows("group name");
    app.press("escape");
    await app.shows("+ new group…");
    app.press("return");
    await app.shows("group name");
    app.press("return"); // blank name is refused
    await app.shows("a group needs a name");
    app.type("linked");
    app.press("return");
    await eventually(app.t, () => app.navigator.current?.title === "projects");
    await app.shows("▾ linked (1)");
    const groups = prefs.projectGroups as { name: string; projectIds: string[] }[];
    // "dev" lost its only project, so it is gone.
    expect(groups.map((g) => [g.name, g.projectIds])).toEqual([["linked", ["p3"]]]);
  });

  test("remove from group ungroups the project", async () => {
    const app = await boot();
    const prefs: Record<string, unknown> = withGroups();
    await app.navigator.push(new GlobalHomeView(fakeSdk({ projects, prefs })));
    await app.shows("1 group");
    app.press("j");
    app.press("j");
    app.press("g");
    await app.shows("− remove from dev");
    app.press("j");
    app.press("j");
    app.press("return");
    await eventually(app.t, () => app.navigator.current?.title === "projects");
    await eventually(app.t, () => (prefs.projectGroups as unknown[]).length === 0);
    await eventually(app.t, () => !app.t.captureCharFrame().includes("dev"));
  });

  test("e renames a group (prefilled) and u ungroups it", async () => {
    const app = await boot();
    const prefs: Record<string, unknown> = withGroups();
    await app.navigator.push(new GlobalHomeView(fakeSdk({ projects, prefs })));
    await app.shows("1 group");
    app.press("j");
    app.press("e");
    const rename = await app.shows("rename group");
    expect(rename).toContain("❯ dev");
    for (let i = 0; i < 3; i++) app.press("backspace");
    app.type("job");
    app.press("return");
    await eventually(app.t, () => app.navigator.current?.title === "projects");
    await app.shows("▾ job (1)");
    app.press("u");
    await eventually(app.t, () => (prefs.projectGroups as unknown[]).length === 0);
    await eventually(app.t, () => !app.t.captureCharFrame().includes("job"));
  });

  test("esc leaves a rename without saving", async () => {
    const app = await boot();
    const prefs: Record<string, unknown> = withGroups();
    await app.navigator.push(new GlobalHomeView(fakeSdk({ projects, prefs })));
    await app.shows("1 group");
    app.press("j");
    app.press("e");
    await app.shows("rename group");
    app.type("x");
    app.press("escape");
    await eventually(app.t, () => app.navigator.current?.title === "projects");
    expect(prefs.projectGroups).toEqual(withGroups().projectGroups);
  });

  test("a failed group read still lists projects, and g offers a retry", async () => {
    const app = await boot();
    await app.navigator.push(
      new GlobalHomeView(fakeSdk({ projects, rpcError: new Error("plugin crashed") })),
    );
    await app.shows("error loading groups: plugin crashed");
    expect(await app.shows("3 projects")).toContain("aerotime");
    app.press("g");
    await app.shows("project groups didn't load — press r to retry");
  });

  test("a failed save keeps the typed name and says why", async () => {
    const app = await boot();
    const prefs: Record<string, unknown> = withGroups();
    const sdk = fakeSdk({ projects, prefs });
    await app.navigator.push(new GlobalHomeView(sdk));
    await app.shows("1 group");
    app.press("j");
    app.press("e");
    await app.shows("rename group");
    (sdk.plugins as unknown as { callRpc: () => Promise<never> }).callRpc = async () => {
      throw new Error("offline");
    };
    app.type("x");
    app.press("return");
    const text = await app.shows("save failed: offline");
    expect(text).toContain("❯ devx");
    expect(app.navigator.current?.title).toBe("project group");
  });

  test("a group name from BB is sanitized in the rename box", async () => {
    const app = await boot();
    const prefs: Record<string, unknown> = {
      projectGroups: [{ id: "g1", name: "dev\u001b[31mred", projectIds: ["p3"] }],
      collapsedProjectGroups: [],
    };
    await app.navigator.push(new GlobalHomeView(fakeSdk({ projects, prefs })));
    await app.shows("1 group");
    app.press("j");
    app.press("e");
    const text = await app.shows("rename group");
    expect(text).not.toContain("\u001b");
  });

  test("without project groups in BB the list is flat and g says why", async () => {
    const app = await boot();
    await app.navigator.push(new GlobalHomeView(fakeSdk({ projects })));
    await app.shows("3 projects");
    app.press("g");
    await app.shows("project groups need a BB");
    expect(app.navigator.current?.title).toBe("projects");
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
    expect(text).toContain("esc quit"); // opened directly: esc leaves bbchat
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
    await app.navigator.push(new MessageView("bbchat", ["No project in focus."]));
    const text = await app.shows("No project in focus.");
    expect(text).toContain("q or esc to go back");
  });
});

describe("ThreadView interaction", () => {
  const toolRows = () => [
    { kind: "conversation", role: "user", text: "run it", id: "m1" },
    {
      kind: "work",
      workKind: "command",
      status: "success",
      id: "w1",
      command: "make test",
      output: "first line\nsecond line\nthird line",
    },
  ];

  test("typing edits the composer and enter sends the trimmed message", async () => {
    const sent: string[] = [];
    const app = await boot();
    await app.navigator.push(new ThreadView(fakeSdk({ sent }), "thr_a", "thr_a"));
    await app.shows("hello");
    app.type("hix");
    app.press("backspace");
    await app.shows("❯ hi");
    app.type("  ");
    app.press("return");
    await eventually(app.t, () => sent.length === 1);
    expect(sent).toEqual(["hi"]);
    expect(await app.frame()).not.toContain("❯ hi");
  });

  test("a leading-slash message that is not a command is sent as text", async () => {
    const sent: string[] = [];
    const app = await boot();
    await app.navigator.push(new ThreadView(fakeSdk({ sent }), "thr_a", "thr_a"));
    await app.shows("hello");
    app.type("/tmp/x.log");
    app.press("return");
    await eventually(app.t, () => sent.length === 1);
    expect(sent).toEqual(["/tmp/x.log"]);
  });

  test("a failed send surfaces in the status line", async () => {
    const app = await boot();
    const sdk = fakeSdk({ sendError: new Error("thread is archived") });
    await app.navigator.push(new ThreadView(sdk, "thr_a", "thr_a"));
    await app.shows("hello");
    app.type("hi");
    app.press("return");
    await app.shows("send failed: thread is archived");
  });

  test("/help shows the tone legend; /diff and /terminals open their views", async () => {
    const app = await boot();
    await app.navigator.push(new ThreadView(fakeSdk(), "thr_a", "thr_a"));
    await app.shows("hello");
    app.type("/help");
    app.press("return");
    await app.shows("Ctrl+E expand");

    app.type("/diff");
    app.press("return");
    await eventually(app.t, () => app.navigator.current?.title === "diff");
    app.press("q");
    await eventually(app.t, () => app.navigator.current?.title === "thread");
    await app.shows("hello");

    app.type("/term");
    app.press("return");
    await eventually(app.t, () => app.navigator.current?.title === "terminals");
  });

  test("/back pops and /exit quits", async () => {
    const app = await boot();
    await app.navigator.push(new MessageView("home", ["home screen"]));
    await app.navigator.push(new ThreadView(fakeSdk(), "thr_a", "thr_a"));
    await app.shows("hello");
    app.type("/back");
    app.press("return");
    await eventually(app.t, () => app.navigator.current?.title === "home");

    const solo = await boot();
    await solo.navigator.push(new ThreadView(fakeSdk(), "thr_a", "thr_a"));
    await solo.shows("hello");
    solo.type("/exit");
    solo.press("return");
    expect(solo.exited()).toBe(true);
  });

  test("ctrl+o opens the diff, ctrl+t the terminals, esc goes back", async () => {
    const app = await boot();
    await app.navigator.push(new ThreadView(fakeSdk(), "thr_a", "thr_a"));
    await app.shows("hello");
    app.press("o", { ctrl: true });
    await eventually(app.t, () => app.navigator.current?.title === "diff");
    app.press("escape");
    await eventually(app.t, () => app.navigator.current?.title === "thread");
    app.press("t", { ctrl: true });
    await eventually(app.t, () => app.navigator.current?.title === "terminals");
    app.press("escape");
    await eventually(app.t, () => app.navigator.current?.title === "thread");
    app.press("escape");
    await eventually(app.t, () => app.exited());
  });

  test("tab selects a tool row and ctrl+e expands its full output", async () => {
    const app = await boot();
    await app.navigator.push(new ThreadView(fakeSdk({ timelineRows: toolRows }), "thr_a", "thr_a"));
    let text = await app.shows("$ make test");
    expect(text).toContain("first line");
    expect(text).not.toContain("third line"); // collapsed: a one-line preview

    app.press("e", { ctrl: true }); // nothing selected yet
    await app.shows("select a row with Tab");

    app.press("tab");
    app.press("e", { ctrl: true });
    text = await app.shows("third line");
    expect(text).toContain("second line");

    app.press("tab", { shift: true });
    app.press("e", { ctrl: true }); // collapse again
    await eventually(app.t, () => !app.t.captureCharFrame().includes("third line"));
  });

  test("scroll keys are consumed by the transcript, not the composer", async () => {
    const app = await boot();
    await app.navigator.push(new ThreadView(fakeSdk({ timelineRows: toolRows }), "thr_a", "thr_a"));
    await app.shows("$ make test");
    for (const key of ["pageup", "pagedown", "up", "down", "home", "end"]) app.press(key);
    const text = await app.frame();
    expect(text).toContain("❯ ");
    expect(text).not.toContain("❯ pageup");
    expect(app.navigator.current?.title).toBe("thread");
  });

  test("a timeline failure renders an error row", async () => {
    const app = await boot();
    const sdk = fakeSdk({ timelineError: new Error("timeline gone") });
    await app.navigator.push(new ThreadView(sdk, "thr_a", "thr_a"));
    await app.shows("error loading timeline: timeline gone");
  });

  test("a realtime change refetches, and a burst coalesces into one extra fetch", async () => {
    let push: () => void = () => {};
    let fetches = 0;
    let text = "hello";
    const sdk = fakeSdk({
      onSubscribe: (callback) => (push = callback),
      timelineRows: () => {
        fetches += 1;
        return [{ kind: "conversation", role: "user", text, id: "m1" }];
      },
    });
    const app = await boot();
    await app.navigator.push(new ThreadView(sdk, "thr_a", "thr_a"));
    await app.shows("hello");
    const before = fetches;
    text = "updated from the server";
    push();
    push(); // arrives mid-fetch: queued, not a parallel fetch
    push();
    await app.shows("updated from the server");
    await eventually(app.t, () => fetches === before + 2);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetches).toBe(before + 2);
  });
});

describe("TerminalsView interaction", () => {
  const two = [
    { id: "t1", title: "dev server", status: "running" },
    { id: "t2", title: "build", status: "exited" },
  ];

  test("j/k switch sessions and load that session's output; r refreshes", async () => {
    const app = await boot();
    await app.navigator.push(new TerminalsView(fakeSdk({ terminals: two }), "thr_a"));
    await app.shows("listening on :3000");
    expect(await app.frame()).toContain("2 terminals");
    app.press("j");
    await app.shows("built");
    app.press("k");
    await app.shows("listening on :3000");
    app.press("r");
    await app.shows("2 terminals");
    app.press("q");
    await eventually(app.t, () => app.exited());
  });

  test("empty list, empty output, and fetch errors each render their copy", async () => {
    const empty = await boot();
    await empty.navigator.push(new TerminalsView(fakeSdk({ terminals: [] }), "thr_a"));
    await empty.shows("no terminals for this thread");
    empty.press("j"); // nothing to move to

    const quiet = await boot();
    const quietSdk = fakeSdk({ terminals: [{ id: "t_quiet", title: "idle", status: "running" }] });
    await quiet.navigator.push(new TerminalsView(quietSdk, "thr_a"));
    await quiet.shows("(no output)");

    const broken = await boot();
    const listError = new Error("no host");
    await broken.navigator.push(new TerminalsView(fakeSdk({ terminalsError: listError }), "thr_a"));
    await broken.shows("error loading terminals: no host");

    const noOutput = await boot();
    const outputError = new Error("pty closed");
    await noOutput.navigator.push(new TerminalsView(fakeSdk({ outputError }), "thr_a"));
    await noOutput.shows("error loading output: pty closed");
  });
});

describe("SpawnWizardView interaction", () => {
  const resolve = async () => project;

  test("provider → model → mode → prompt spawns and replaces itself with the thread", async () => {
    const app = await boot();
    await app.navigator.push(new SpawnWizardView(fakeSdk(), resolve));
    await app.shows("step 1/4 · provider");
    app.press("j");
    app.press("k");
    app.press("return");
    await app.shows("Opus 5");
    app.press("return");
    await app.shows("step 3/4 · mode");
    app.press("down");
    app.press("up");
    app.press("return");
    await app.shows("step 4/4 · prompt");
    app.press("return"); // an empty prompt does not spawn
    app.type("fix it");
    await app.shows("❯ fix it");
    app.press("return");
    await eventually(app.t, () => app.navigator.current instanceof ThreadView);
    expect(app.navigator.depth).toBe(1);
  });

  test("a full preset skips straight to the prompt step", async () => {
    const app = await boot();
    const preset = {
      providerId: "claude-code",
      model: "opus-5",
      reasoningLevel: "high",
      permissionMode: "auto" as const,
    };
    await app.navigator.push(new SpawnWizardView(fakeSdk(), resolve, preset));
    const text = await app.shows("step 4/4 · prompt");
    expect(text).toContain("high");
  });

  test("a preset whose models fail to load reports it and falls back to the plain flow", async () => {
    const app = await boot();
    const preset = {
      providerId: "claude-code",
      model: null,
      reasoningLevel: null,
      permissionMode: null,
    };
    const sdk = fakeSdk({ modelsError: new Error("models down") });
    await app.navigator.push(new SpawnWizardView(sdk, resolve, preset));
    await app.shows("error loading models: models down");
    expect(await app.frame()).toContain("step 1/4 · provider");
  });

  test("provider, model, and spawn failures are reported in place", async () => {
    const noProviders = await boot();
    const providersError = new Error("providers down");
    await noProviders.navigator.push(new SpawnWizardView(fakeSdk({ providersError }), resolve));
    await noProviders.shows("error loading providers: providers down");

    const noModels = await boot();
    const modelsError = new Error("models down");
    await noModels.navigator.push(new SpawnWizardView(fakeSdk({ modelsError }), resolve));
    await noModels.shows("step 1/4 · provider");
    noModels.press("return");
    await noModels.shows("error loading models: models down");

    for (const [opts, message] of [
      [{ spawnResult: {} }, "spawn returned no thread id"],
      [{ spawnError: new Error("quota") }, "spawn failed: quota"],
    ] as const) {
      const preset = {
        providerId: "claude-code",
        model: "opus-5",
        reasoningLevel: null,
        permissionMode: "auto" as const,
      };
      const app = await boot();
      await app.navigator.push(new SpawnWizardView(fakeSdk(opts), resolve, preset));
      await app.shows("step 4/4 · prompt");
      app.type("go");
      app.press("return");
      await app.shows(message);
      expect(app.navigator.current?.title).toBe("new thread");
    }
  });
});

describe("DiffView / SkillsView / PluginsView states", () => {
  test("diff: no environment, a fetch error, refresh, and back", async () => {
    const none = await boot();
    await none.navigator.push(new DiffView(fakeSdk({ environmentId: null }), "thr_a"));
    await none.shows("this thread has no environment to diff");

    const broken = await boot();
    await broken.navigator.push(new DiffView(fakeSdk({ diffError: new Error("git") }), "thr_a"));
    await broken.shows("error loading diff: git");

    const app = await boot();
    await app.navigator.push(new DiffView(fakeSdk(), "thr_a"));
    await app.shows("1 file changed");
    for (const key of ["k", "down", "up", "pageup", "space", "end", "r"]) app.press(key);
    await app.shows("+new");
    app.press("escape");
    await eventually(app.t, () => app.exited());
  });

  test("skills and plugins render fetch errors and refresh on r", async () => {
    const skills = await boot();
    const skillsError = new Error("skills down");
    await skills.navigator.push(new SkillsView(fakeSdk({ skillsError }), "prj_1"));
    await skills.shows("error loading skills: skills down");
    skills.press("r");
    skills.press("q");
    await eventually(skills.t, () => skills.exited());

    const plugins = await boot();
    const pluginsError = new Error("plugins down");
    await plugins.navigator.push(new PluginsView(fakeSdk({ pluginsError })));
    await plugins.shows("error loading plugins: plugins down");

    const ok = await boot();
    await ok.navigator.push(new PluginsView(fakeSdk()));
    await ok.shows("advisor");
    for (const key of ["j", "down", "k", "up", "r"]) ok.press(key);
    await ok.shows("2 installed · 1 enabled");
    ok.press("escape");
    await eventually(ok.t, () => ok.exited());
  });

  test("MessageView pops on q", async () => {
    const app = await boot();
    await app.navigator.push(new MessageView("bbchat", ["No project in focus."]));
    await app.shows("No project in focus.");
    app.press("x"); // ignored
    app.press("q");
    await eventually(app.t, () => app.exited());
  });
});

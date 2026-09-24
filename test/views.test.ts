import { afterEach, describe, expect, test } from "bun:test";
import type { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { BBSdk } from "../src/bb/sdk.ts";
import { Navigator } from "../src/tui/navigator.ts";
import { DiffView } from "../src/tui/views/diff-view.ts";
import { GlobalHomeView } from "../src/tui/views/global-home-view.ts";
import { InteractionsView } from "../src/tui/views/interactions-view.ts";
import { MessageView } from "../src/tui/views/message-view.ts";
import { PluginsView } from "../src/tui/views/plugins-view.ts";
import { QueueView } from "../src/tui/views/queue-view.ts";
import { SkillsView } from "../src/tui/views/skills-view.ts";
import { SpawnWizardView } from "../src/tui/views/spawn-wizard-view.ts";
import { TerminalsView } from "../src/tui/views/terminals-view.ts";
import { ThreadListView } from "../src/tui/views/thread-list-view.ts";
import { ThreadSearchView } from "../src/tui/views/thread-search-view.ts";
import { ThreadView } from "../src/tui/views/thread-view.ts";

type TestSetup = Awaited<ReturnType<typeof createTestRenderer>>;
const live: TestSetup[] = [];
afterEach(() => {
  for (const t of live.splice(0)) t.renderer.destroy();
});

describe("BB actions added to the TUI", () => {
  test("failed delivery leaves the draft editable; stop uses the BB thread action", async () => {
    const actions: string[] = [];
    const app = await boot();
    await app.navigator.push(
      new ThreadView(fakeSdk({ sendError: new Error("offline"), actions }), "thr_a", "thread"),
    );
    app.type("keep me");
    app.press("return");
    await app.shows("send failed: offline");
    expect(await app.frame()).toContain("❯ keep me");
    for (let i = 0; i < "keep me".length; i++) app.press("backspace");
    app.type("/stop");
    app.press("return");
    await eventually(app.t, () => actions.includes("stop"));
  });

  test("a no-argument thread action rejects extra text without clearing the draft", async () => {
    const actions: string[] = [];
    const app = await boot();
    await app.navigator.push(new ThreadView(fakeSdk({ actions }), "thr_a", "thread"));
    app.type("/clear extra");
    app.press("return");
    await app.shows("usage: /clear");
    expect(actions).not.toContain("clear");
    expect(await app.frame()).toContain("❯ /clear extra");
  });

  test("an approval shows its command and resolves once", async () => {
    const resolved: unknown[] = [];
    const interactions: unknown[] = [
      {
        id: "int_1",
        status: "pending",
        origin: { kind: "provider" },
        payload: {
          kind: "approval",
          reason: "Needs network",
          availableDecisions: ["allow_once", "deny"],
          subject: { kind: "command", command: "curl example.com", cwd: "/repo" },
        },
      },
    ];
    const app = await boot();
    await app.navigator.push(
      new ThreadView(fakeSdk({ interactions, resolved }), "thr_a", "thread"),
    );
    app.press("i", { ctrl: true });
    await app.shows("curl example.com");
    app.press("a");
    await eventually(app.t, () => resolved.length === 1);
    expect(resolved[0]).toEqual({
      threadId: "thr_a",
      interactionId: "int_1",
      resolution: { decision: "allow_once", grantedPermissions: null },
    });
    await app.shows("no pending interactions");
  });

  test("file approval displays every patch linked to its call", async () => {
    const resolved: unknown[] = [];
    const interactions: unknown[] = [
      {
        id: "int_file",
        status: "pending",
        payload: {
          kind: "approval",
          availableDecisions: ["allow_once", "deny"],
          subject: {
            kind: "file_change",
            itemId: "call_1",
            writeScope: "/repo",
            sessionGrant: null,
          },
        },
      },
    ];
    const timelineRows = () => [
      {
        kind: "turn",
        children: [
          {
            kind: "work",
            workKind: "file-change",
            callId: "call_1",
            change: { path: "src/a.ts", kind: "modify", diff: "@@ -1 +1 @@\n-old\n+new" },
          },
          {
            kind: "work",
            workKind: "file-change",
            callId: "call_1",
            change: { path: "src/b.ts", kind: "add", diff: "@@ -0,0 +1 @@\n+added" },
          },
        ],
      },
    ];
    const app = await boot();
    await app.navigator.push(
      new InteractionsView(fakeSdk({ interactions, resolved, timelineRows }), "thr_a"),
    );
    const frame = await app.shows("src/a.ts");
    expect(frame).toContain("+new");
    expect(frame).toContain("src/b.ts");
    app.press("a");
    await eventually(app.t, () => resolved.length === 1);
  });

  test("file approval stays blocked when one linked patch is unavailable", async () => {
    const resolved: unknown[] = [];
    const interactions: unknown[] = [
      {
        id: "int_binary",
        status: "pending",
        payload: {
          kind: "approval",
          availableDecisions: ["allow_once", "deny"],
          subject: { kind: "file_change", itemId: "call_binary", writeScope: "/repo" },
        },
      },
    ];
    const timelineRows = () => [
      {
        kind: "work",
        workKind: "file-change",
        callId: "call_binary",
        change: { path: "image.png", diff: null },
      },
    ];
    const app = await boot();
    await app.navigator.push(
      new InteractionsView(fakeSdk({ interactions, resolved, timelineRows }), "thr_a"),
    );
    await app.shows("file patch is unavailable");
    app.press("a");
    await app.shows("Approval disabled");
    expect(resolved).toHaveLength(0);
  });

  test("tool approval shows arguments; missing details block approval but allow denial", async () => {
    const resolved: unknown[] = [];
    const request = {
      id: "int_tool",
      status: "pending",
      payload: {
        kind: "approval",
        availableDecisions: ["allow_once", "deny"],
        subject: {
          kind: "tool_use",
          itemId: "call_tool",
          tool: "deploy",
          presentation: { title: "Deploy" },
        },
      },
    };
    const interactions: unknown[] = [request];
    const timelineRows = () => [
      {
        kind: "work",
        workKind: "tool",
        callId: "call_tool",
        toolName: "deploy",
        toolArgs: { target: "stage" },
      },
    ];
    const app = await boot();
    await app.navigator.push(
      new InteractionsView(fakeSdk({ interactions, resolved, timelineRows }), "thr_a"),
    );
    const frame = await app.shows('"target": "stage"');
    expect(frame).toContain("Tool: deploy");
    app.press("a");
    await eventually(app.t, () => resolved.length === 1);

    const blocked: unknown[] = [];
    const missing = await boot();
    await missing.navigator.push(
      new InteractionsView(
        fakeSdk({ interactions: [request], resolved: blocked, timelineRows: () => [] }),
        "thr_a",
      ),
    );
    await missing.shows("Tool arguments unavailable");
    missing.press("a");
    await missing.shows("Approval disabled");
    expect(blocked).toHaveLength(0);
    missing.press("d");
    await eventually(missing.t, () => blocked.length === 1);
    expect(blocked[0]).toEqual({
      threadId: "thr_a",
      interactionId: "int_tool",
      resolution: { decision: "deny" },
    });
  });

  test("a provider question accepts an offered value", async () => {
    const resolved: unknown[] = [];
    const interactions: unknown[] = [
      {
        id: "int_2",
        status: "pending",
        origin: { kind: "provider" },
        payload: {
          kind: "user_question",
          questions: [
            {
              id: "q1",
              prompt: "Which environment?",
              multiSelect: false,
              allowFreeText: false,
              options: [{ value: "stage", label: "Stage" }],
            },
          ],
        },
      },
    ];
    const app = await boot();
    await app.navigator.push(new InteractionsView(fakeSdk({ interactions, resolved }), "thr_a"));
    await app.shows("Which environment?");
    app.press("return");
    app.type("stage");
    app.press("return");
    await eventually(app.t, () => resolved.length === 1);
    expect(resolved[0]).toEqual({
      threadId: "thr_a",
      interactionId: "int_2",
      resolution: { kind: "user_answer", answers: { q1: { selected: ["stage"] } } },
    });
  });

  test("a plugin form submits JSON through the interaction response", async () => {
    const resolved: unknown[] = [];
    const interactions: unknown[] = [
      {
        id: "int_form",
        status: "pending",
        origin: { kind: "plugin" },
        payload: { kind: "plugin", title: "Choose target", data: { choices: ["stage"] } },
      },
    ];
    const app = await boot();
    await app.navigator.push(new InteractionsView(fakeSdk({ interactions, resolved }), "thr_a"));
    await app.shows("Choose target");
    app.press("return");
    app.type('{"target":"stage"}');
    app.press("return");
    await eventually(app.t, () => resolved.length === 1);
    expect(resolved[0]).toEqual({
      threadId: "thr_a",
      interactionId: "int_form",
      value: { target: "stage" },
    });
  });

  test("new threads can reuse a selected environment", async () => {
    const spawnArgs: unknown[] = [];
    const app = await boot();
    const sdk = fakeSdk({
      spawnArgs,
      environments: [
        {
          id: "env_2",
          status: "ready",
          lifecycle: { phase: "active" },
          path: "/repo/other",
          branchName: "feature/a",
        },
      ],
    });
    await app.navigator.push(new SpawnWizardView(sdk, async () => project, null, project.id));
    await app.shows("step 1/5 · provider");
    app.press("return");
    await app.shows("step 2/5 · model");
    app.press("return");
    await app.shows("step 3/5 · mode");
    app.press("return");
    await app.shows("step 4/5 · environment");
    app.press("down");
    app.press("return");
    await app.shows("step 5/5 · prompt");
    app.type("do work");
    app.press("return");
    await eventually(app.t, () => spawnArgs.length === 1);
    expect(spawnArgs[0]).toMatchObject({ environment: { type: "reuse", environmentId: "env_2" } });
  });

  test("a terminal accepts a command and creates a new session", async () => {
    const terminalCalls: string[] = [];
    const app = await boot();
    await app.navigator.push(new TerminalsView(fakeSdk({ terminalCalls }), "thr_a"));
    app.press("return");
    app.type("pwd");
    app.press("return");
    await eventually(app.t, () => terminalCalls.includes("pwd\n"));
    app.press("n");
    await eventually(app.t, () => terminalCalls.includes("create"));
    await app.shows("shell");
  });

  test("terminal close and restart require a second keypress", async () => {
    const terminalCalls: string[] = [];
    const app = await boot();
    await app.navigator.push(new TerminalsView(fakeSdk({ terminalCalls }), "thr_a"));
    app.press("x");
    expect(terminalCalls).not.toContain("close");
    app.press("x");
    await eventually(app.t, () => terminalCalls.includes("close"));
    await app.shows("terminal closed");
    app.press("z");
    expect(terminalCalls).not.toContain("restart");
    app.press("z");
    await eventually(app.t, () => terminalCalls.includes("restart"));
  });

  test("threads can be pinned, archived, and restored from the archived list", async () => {
    const actions: string[] = [];
    const rows: unknown[] = [
      {
        id: "thr_a",
        title: "Work",
        status: "idle",
        updatedAt: 1,
        archivedAt: null,
        pinnedAt: null,
      },
    ];
    const app = await boot();
    await app.navigator.push(new ThreadListView(fakeSdk({ threads: rows, actions }), project));
    await app.shows("Work");
    app.press("i");
    await eventually(app.t, () => actions.includes("pin"));
    app.press("x");
    expect(actions).not.toContain("archive");
    app.press("x");
    await eventually(app.t, () => actions.includes("archive"));
    await app.shows("no threads yet");
    app.press("v");
    await app.shows("Work");
    app.press("u");
    await eventually(app.t, () => actions.includes("unarchive"));
  });

  test("BB search opens a matching thread", async () => {
    const app = await boot();
    const searchResult = {
      active: {
        total: 1,
        results: [
          {
            thread: {
              id: "thr_a",
              projectId: project.id,
              title: "Fix the flaky test",
              titleFallback: null,
              archivedAt: null,
            },
            matches: [{ text: "the flaky test" }],
          },
        ],
      },
      archived: { total: 0, results: [] },
    };
    await app.navigator.push(new ThreadListView(fakeSdk({ searchResult }), project));
    app.press("s");
    await eventually(app.t, () => app.navigator.current instanceof ThreadSearchView);
    app.type("flaky");
    app.press("return");
    await app.shows("the flaky test");
    app.press("return");
    await eventually(app.t, () => app.navigator.current instanceof ThreadView);
    app.press("escape");
    await eventually(app.t, () => app.navigator.current instanceof ThreadSearchView);
    await app.shows("the flaky test");
  });

  test("search keeps newer results when an older request finishes last", async () => {
    const pending: { query: string; resolve: (value: unknown) => void }[] = [];
    const searchHandler = (query: string): Promise<unknown> =>
      new Promise((resolve) => pending.push({ query, resolve }));
    const result = (title: string) => ({
      active: {
        total: 1,
        results: [
          { thread: { id: title, projectId: project.id, title, archivedAt: null }, matches: [] },
        ],
      },
      archived: { total: 0, results: [] },
    });
    const app = await boot();
    await app.navigator.push(new ThreadSearchView(fakeSdk({ searchHandler }), project.id));
    app.type("old");
    app.press("return");
    await eventually(app.t, () => pending.length === 1);
    for (let i = 0; i < 3; i++) app.press("backspace");
    app.type("new");
    app.press("return");
    await eventually(app.t, () => pending.length === 2);
    pending[1]?.resolve(result("new result"));
    await app.shows("new result");
    pending[0]?.resolve(result("old result"));
    await app.t.renderOnce();
    expect(await app.frame()).toContain("new result");
    expect(await app.frame()).not.toContain("old result");
  });

  test("queued text can be edited and dispatched", async () => {
    const queueCalls: string[] = [];
    const queued: unknown[] = [
      {
        id: "msg_1",
        updatedAt: 1,
        editable: true,
        content: [{ type: "text", text: "old", mentions: [] }],
        payload: { kind: "inline" },
        waitingOn: { kind: "thread-busy" },
        failureReason: null,
      },
    ];
    const app = await boot();
    await app.navigator.push(new ThreadView(fakeSdk({ queued, queueCalls }), "thr_a", "thread"));
    app.press("q", { ctrl: true });
    await eventually(app.t, () => app.navigator.current instanceof QueueView);
    await app.shows("old");
    app.press("e");
    app.press("backspace");
    app.type("w");
    app.press("return");
    await eventually(app.t, () => queueCalls.includes("edit:olw"));
    app.press("n");
    await eventually(app.t, () => queueCalls.includes("send"));
    await app.shows("no queued messages");
  });

  test("queue editing preserves mention-bearing messages by refusing an unsafe edit", async () => {
    const queueCalls: string[] = [];
    const queued: unknown[] = [
      {
        id: "msg_mention",
        updatedAt: 1,
        editable: true,
        content: [{ type: "text", text: "ask @agent", mentions: [{ id: "agent" }] }],
        payload: { kind: "inline" },
        waitingOn: { kind: "thread-busy" },
        failureReason: null,
      },
    ];
    const app = await boot();
    await app.navigator.push(new QueueView(fakeSdk({ queued, queueCalls }), "thr_a"));
    await app.shows("ask @agent");
    app.press("e");
    await app.shows("one plain text part");
    expect(queueCalls).toHaveLength(0);
  });

  test("queued message deletion requires confirmation", async () => {
    const queueCalls: string[] = [];
    const queued: unknown[] = [
      {
        id: "msg_delete",
        updatedAt: 1,
        editable: true,
        content: [{ type: "text", text: "discard me", mentions: [] }],
        payload: { kind: "inline" },
        waitingOn: { kind: "thread-busy" },
        failureReason: null,
      },
    ];
    const app = await boot();
    await app.navigator.push(new QueueView(fakeSdk({ queued, queueCalls }), "thr_a"));
    app.press("d");
    expect(queueCalls).not.toContain("delete");
    app.press("d");
    await eventually(app.t, () => queueCalls.includes("delete"));
    await app.shows("no queued messages");
  });

  test("diff review switches from working changes to the full branch", async () => {
    const diffTargets: string[] = [];
    const app = await boot();
    await app.navigator.push(new DiffView(fakeSdk({ diffTargets }), "thr_a"));
    expect(diffTargets).toEqual(["uncommitted"]);
    app.press("a");
    await eventually(app.t, () => diffTargets.includes("all"));
    await app.shows("whole branch");
  });
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
  actions?: string[];
  interactions?: unknown[];
  resolved?: unknown[];
  spawnArgs?: unknown[];
  environments?: unknown[];
  terminalCalls?: string[];
  searchResult?: unknown;
  searchHandler?: (query: string) => Promise<unknown>;
  queued?: unknown[];
  queueCalls?: string[];
  diffTargets?: string[];
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
  const terminalRows = o.terminals ?? [{ id: "t1", title: "dev server", status: "running" }];
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
      spawn: async (args: unknown) => {
        fail(o.spawnError);
        o.spawnArgs?.push(args);
        return o.spawnResult ?? { threadId: "thr_new" };
      },
      stop: async () => {
        o.actions?.push("stop");
        return {};
      },
      retry: async () => {
        o.actions?.push("retry");
        return {};
      },
      compact: async () => {
        o.actions?.push("compact");
        return {};
      },
      clearContext: async () => {
        o.actions?.push("clear");
        return {};
      },
      cancelPlan: async () => {
        o.actions?.push("cancel-plan");
        return {};
      },
      clearGoal: async () => {
        o.actions?.push("clear-goal");
        return {};
      },
      update: async (args: unknown) => {
        o.actions?.push(JSON.stringify(args));
        return {};
      },
      interactions: {
        list: async () => o.interactions ?? [],
        resolve: async (args: unknown) => {
          o.resolved?.push(args);
          o.interactions?.shift();
          return {};
        },
        respond: async (args: unknown) => {
          o.resolved?.push(args);
          o.interactions?.shift();
          return {};
        },
      },
      archive: async ({ threadId }: { threadId: string }) => {
        const row = o.threads?.find((item) => (item as { id?: string }).id === threadId) as
          | { archivedAt?: number }
          | undefined;
        if (row) row.archivedAt = Date.now();
        o.actions?.push("archive");
        return {};
      },
      unarchive: async ({ threadId }: { threadId: string }) => {
        const row = o.threads?.find((item) => (item as { id?: string }).id === threadId) as
          | { archivedAt?: null }
          | undefined;
        if (row) row.archivedAt = null;
        o.actions?.push("unarchive");
        return {};
      },
      pin: async ({ threadId }: { threadId: string }) => {
        const row = o.threads?.find((item) => (item as { id?: string }).id === threadId) as
          | { pinnedAt?: number }
          | undefined;
        if (row) row.pinnedAt = Date.now();
        o.actions?.push("pin");
        return {};
      },
      unpin: async ({ threadId }: { threadId: string }) => {
        const row = o.threads?.find((item) => (item as { id?: string }).id === threadId) as
          | { pinnedAt?: null }
          | undefined;
        if (row) row.pinnedAt = null;
        o.actions?.push("unpin");
        return {};
      },
      search: async (args: { query: string }) =>
        o.searchHandler?.(args.query) ??
        o.searchResult ?? {
          active: { total: 0, results: [] },
          archived: { total: 0, results: [] },
        },
      queuedMessages: {
        list: async () => o.queued ?? [],
        update: async (args: { input: { text?: string }[] }) => {
          o.queueCalls?.push(`edit:${args.input[0]?.text ?? ""}`);
          const row = o.queued?.[0] as { content?: unknown[] } | undefined;
          if (row) row.content = args.input;
          return {};
        },
        send: async () => {
          o.queueCalls?.push("send");
          o.queued?.shift();
          return {};
        },
        delete: async () => {
          o.queueCalls?.push("delete");
          o.queued?.shift();
          return {};
        },
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
          sessions: terminalRows,
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
      input: async (args: { dataBase64: string }) => {
        o.terminalCalls?.push(Buffer.from(args.dataBase64, "base64").toString("utf8"));
        return {};
      },
      create: async () => {
        const row = { id: "t_new", title: "shell", status: "running" };
        terminalRows.push(row);
        o.terminalCalls?.push("create");
        return row;
      },
      close: async () => {
        o.terminalCalls?.push("close");
        return {};
      },
      restart: async () => {
        o.terminalCalls?.push("restart");
        return {};
      },
    },
    environments: {
      list: async () => o.environments ?? [],
      get: async () => ({ mergeBaseBranch: "master", defaultBranch: "master" }),
      diffFiles: async (args: { target: string }) => {
        fail(o.diffError);
        o.diffTargets?.push(args.target);
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

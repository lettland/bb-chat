import { describe, expect, test } from "bun:test";
import { ensureProject, findProject, listProjects } from "../src/bb/project.ts";
import { listModels, listProviders, spawnThread } from "../src/bb/providers.ts";
import type { BBSdk } from "../src/bb/sdk.ts";
import {
  getThreadEnvironmentId,
  getThreadMeta,
  getTimelineRows,
  listThreads,
  sendText,
  watchProject,
  watchThread,
} from "../src/bb/threads.ts";
import { isBbchatError } from "../src/errors.ts";
import type { SpawnParams } from "../src/tui/spawn-wizard.ts";

/** Records every SDK call as `[method, args]` and answers from `impl`. */
function recordingSdk(impl: Record<string, Record<string, (args: unknown) => unknown>>) {
  const calls: [string, unknown][] = [];
  const sdk: Record<string, unknown> = {};
  for (const [ns, methods] of Object.entries(impl)) {
    const wrapped: Record<string, (args: unknown) => unknown> = {};
    for (const [name, fn] of Object.entries(methods)) {
      wrapped[name] = (args) => {
        calls.push([`${ns}.${name}`, args]);
        return fn(args);
      };
    }
    sdk[ns] = wrapped;
  }
  return { sdk: sdk as unknown as BBSdk, calls };
}

describe("providers", () => {
  test("listProviders and listModels pass through, tolerating a missing models array", async () => {
    const { sdk, calls } = recordingSdk({
      providers: {
        list: async () => [{ id: "codex" }],
        models: async (args) =>
          (args as { providerId: string }).providerId === "codex" ? { models: [{ id: "m" }] } : {},
      },
    });
    expect(await listProviders(sdk)).toEqual([{ id: "codex" }]);
    expect(await listModels(sdk, "codex")).toEqual([{ id: "m" }]);
    expect(await listModels(sdk, "other")).toEqual([]);
    expect(calls[1]).toEqual(["providers.models", { providerId: "codex" }]);
  });

  const params = (overrides: Partial<SpawnParams> = {}): SpawnParams => ({
    projectId: "prj_1",
    providerId: null,
    model: null,
    reasoningLevel: null,
    permissionMode: null,
    prompt: "hello",
    ...overrides,
  });

  test("spawnThread omits unset fields so BB resolves the defaults", async () => {
    const { sdk, calls } = recordingSdk({
      threads: { spawn: async () => ({ threadId: "thr_1" }) },
    });
    expect(await spawnThread(sdk, params())).toBe("thr_1");
    expect(calls[0]?.[1]).toEqual({
      projectId: "prj_1",
      environment: { type: "project-default" },
      prompt: "hello",
    });
  });

  test("spawnThread forwards every set field", async () => {
    const { sdk, calls } = recordingSdk({ threads: { spawn: async () => ({ id: "thr_2" }) } });
    const id = await spawnThread(
      sdk,
      params({
        providerId: "codex",
        model: "gpt",
        reasoningLevel: "high",
        permissionMode: "auto",
      }),
    );
    expect(id).toBe("thr_2"); // falls back to `id` when `threadId` is absent
    expect(calls[0]?.[1]).toMatchObject({
      providerId: "codex",
      model: "gpt",
      reasoningLevel: "high",
      permissionMode: "auto",
    });
  });

  test("spawnThread returns null for an unexpected response shape", async () => {
    const { sdk } = recordingSdk({ threads: { spawn: async () => ({ threadId: 42 }) } });
    expect(await spawnThread(sdk, params())).toBeNull();
  });
});

describe("project", () => {
  const projects = [
    { id: "p1", name: "alpha", sources: [{ type: "local_path", path: "/work/alpha" }] },
  ];

  test("listProjects and findProject read the project list", async () => {
    const { sdk } = recordingSdk({ projects: { list: async () => projects } });
    expect(await listProjects(sdk)).toEqual(projects);
    expect(await findProject(sdk, "/work/alpha/")).toEqual({ id: "p1", name: "alpha" });
    expect(await findProject(sdk, "/work/beta")).toBeNull();
  });

  test("ensureProject returns an existing match without creating anything", async () => {
    const { sdk, calls } = recordingSdk({
      projects: { list: async () => projects, create: async () => ({}) },
      hosts: { list: async () => [] },
    });
    expect(await ensureProject(sdk, "/work/alpha")).toEqual({ id: "p1", name: "alpha" });
    expect(calls.map(([name]) => name)).toEqual(["projects.list"]);
  });

  test("ensureProject creates a local-path project on the preferred host", async () => {
    const { sdk, calls } = recordingSdk({
      projects: {
        list: async () => projects,
        create: async (args) => ({ id: "p2", name: (args as { name: string }).name }),
      },
      hosts: {
        list: async () => [
          { id: "h1", type: "ephemeral", status: "connected" },
          { id: "h2", type: "persistent", status: "connected" },
        ],
      },
    });
    expect(await ensureProject(sdk, "/work/beta/")).toEqual({ id: "p2", name: "beta" });
    expect(calls.at(-1)).toEqual([
      "projects.create",
      { name: "beta", source: { type: "local_path", hostId: "h2", path: "/work/beta" } },
    ]);
  });

  test("ensureProject fails clearly when there is no host", async () => {
    const { sdk } = recordingSdk({
      projects: { list: async () => [] },
      hosts: { list: async () => [] },
    });
    const error = await ensureProject(sdk, "/work/beta").catch((e: unknown) => e);
    expect(isBbchatError(error)).toBe(true);
    expect((error as Error).message).toContain("No BB host");
  });
});

describe("threads", () => {
  test("listThreads excludes archived threads server-side", async () => {
    const { sdk, calls } = recordingSdk({ threads: { list: async () => [] } });
    await listThreads(sdk, "prj_1");
    expect(calls[0]).toEqual(["threads.list", { projectId: "prj_1", archived: false }]);
  });

  test("getTimelineRows pages backward, prepends older rows, and de-duplicates by id", async () => {
    const pages: Record<string, unknown> = {
      first: {
        rows: [{ id: "r3" }, { id: "r4" }],
        timelinePage: { hasOlderRows: true, olderCursor: { anchorSeq: 3, anchorId: "r3" } },
      },
      "3": {
        rows: [{ id: "r1" }, { id: "r2" }, { id: "r3" }, { note: "no id" }],
        timelinePage: { hasOlderRows: true, olderCursor: { anchorSeq: 1, anchorId: "r1" } },
      },
      "1": { rows: [{ id: "r1" }], timelinePage: { hasOlderRows: true, olderCursor: null } },
    };
    const { sdk, calls } = recordingSdk({
      threads: {
        timeline: async (args) =>
          pages[(args as { beforeAnchorSeq?: string }).beforeAnchorSeq ?? "first"],
      },
    });
    const rows = await getTimelineRows(sdk, "thr_1");
    expect(rows).toEqual([
      { id: "r1" },
      { id: "r2" },
      { note: "no id" },
      { id: "r3" },
      { id: "r4" },
    ]);
    expect(calls[1]?.[1]).toMatchObject({ beforeAnchorSeq: "3", beforeAnchorId: "r3" });
    // The third page only repeats a seen row, so pagination stops there.
    expect(calls).toHaveLength(3);
  });

  test("getTimelineRows tolerates a response without rows or page metadata", async () => {
    const { sdk } = recordingSdk({ threads: { timeline: async () => ({}) } });
    expect(await getTimelineRows(sdk, "thr_1")).toEqual([]);
  });

  test("sendText sends a plain-text auto-mode message", async () => {
    const { sdk, calls } = recordingSdk({ threads: { send: async () => ({}) } });
    await sendText(sdk, "thr_1", "hi");
    expect(calls[0]).toEqual([
      "threads.send",
      { threadId: "thr_1", mode: "auto", input: [{ type: "text", text: "hi", mentions: [] }] },
    ]);
  });

  test("getThreadEnvironmentId and getThreadMeta read the thread record", async () => {
    const records: Record<string, unknown> = {
      thr_env: { environmentId: "env_1", title: "T", runtime: { displayStatus: "active" } },
      thr_none: { environmentId: null },
    };
    const { sdk } = recordingSdk({
      threads: { get: async (args) => records[(args as { threadId: string }).threadId] },
    });
    expect(await getThreadEnvironmentId(sdk, "thr_env")).toBe("env_1");
    expect(await getThreadEnvironmentId(sdk, "thr_none")).toBeNull();
    const meta = await getThreadMeta(sdk, "thr_env");
    expect(meta.title).toBe("T");
    expect(meta.busy).toBe(true);
  });

  test("watchThread/watchProject subscribe to the right events and relay changes", () => {
    const subs: { event: string; callback: () => void }[] = [];
    const sdk = {
      subscribe: (s: { event: string; callback: () => void }) => {
        subs.push(s);
        return () => {};
      },
    } as unknown as BBSdk;
    let changes = 0;
    watchThread(sdk, "thr_1", () => changes++);
    watchProject(sdk, "prj_1", () => changes++);
    expect(subs.map((s) => s.event)).toEqual(["thread:changed", "project:changed"]);
    for (const s of subs) s.callback();
    expect(changes).toBe(2);
  });
});

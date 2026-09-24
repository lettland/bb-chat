import { describe, expect, test } from "bun:test";
import { BbHttpError } from "bb-app";
import {
  readProjectGroups,
  setGroupCollapsed,
  THREAD_LIST_PLUGIN_ID,
  updateProjectGroups,
} from "../src/bb/project-groups.ts";
import type { BBSdk } from "../src/bb/sdk.ts";
import {
  assignProject,
  assignProjectToNamedGroup,
  findGroup,
  formatHomeRow,
  layoutHome,
  newGroupId,
  type ProjectGroup,
  parseCollapsedGroups,
  parseProjectGroups,
  renameGroup,
  ungroup,
} from "../src/tui/project-groups.ts";

const WORK: ProjectGroup = { id: "g1", name: "work", projectIds: ["p1", "p2"] };
const LINKED: ProjectGroup = { id: "g2", name: "linked", projectIds: ["p3"] };

const PROJECTS = [
  { id: "p1", name: "zeta" },
  { id: "p2", name: "alpha" },
  { id: "p3", name: "bb" },
  { id: "p4", name: "ci" },
  { id: "p5", name: "yak" },
];

describe("parseProjectGroups", () => {
  test("keeps valid groups, trimming names", () => {
    expect(parseProjectGroups([{ id: "g", name: "  Work ", projectIds: ["p1", 7, ""] }])).toEqual([
      { id: "g", name: "Work", projectIds: ["p1"] },
    ]);
  });

  test("drops malformed groups, duplicate ids, and a project's second group", () => {
    const groups = parseProjectGroups([
      null,
      { id: "", name: "x", projectIds: [] },
      { id: "g0", name: "   ", projectIds: [] },
      { id: "g1", name: "a", projectIds: ["p1"] },
      { id: "g1", name: "dup", projectIds: ["p2"] },
      { id: "g2", name: "b", projectIds: ["p1", "p3"] },
      { id: "g3", name: "no list" },
    ]);
    expect(groups).toEqual([
      { id: "g1", name: "a", projectIds: ["p1"] },
      { id: "g2", name: "b", projectIds: ["p3"] },
      { id: "g3", name: "no list", projectIds: [] },
    ]);
  });

  test("keeps fields it doesn't know, so edits write them back", () => {
    const [group] = parseProjectGroups([{ id: "g", name: "a", projectIds: [], color: "red" }]);
    expect(renameGroup(group ? [group] : [], "g", "b")).toEqual([
      { id: "g", name: "b", projectIds: [], color: "red" } as ProjectGroup,
    ]);
  });

  test("anything but an array is no groups", () => {
    expect(parseProjectGroups(undefined)).toEqual([]);
    expect(parseProjectGroups({})).toEqual([]);
  });
});

describe("parseCollapsedGroups", () => {
  test("keeps string ids only", () => {
    expect([...parseCollapsedGroups(["g1", 2, "", "g2"])]).toEqual(["g1", "g2"]);
    expect(parseCollapsedGroups("g1").size).toBe(0);
  });
});

describe("layoutHome", () => {
  test("groups sort by name among loose projects; members sort beneath, indented", () => {
    const rows = layoutHome(PROJECTS, [WORK, LINKED], new Set());
    expect(rows.map(formatHomeRow)).toEqual([
      "ci",
      "▾ linked (1)",
      "    bb",
      "▾ work (2)",
      "    alpha",
      "    zeta",
      "yak",
    ]);
  });

  test("a collapsed group keeps its header and hides its members", () => {
    const rows = layoutHome(PROJECTS, [WORK, LINKED], new Set(["g1"]));
    expect(rows.map(formatHomeRow)).toEqual(["ci", "▾ linked (1)", "    bb", "▸ work (2)", "yak"]);
  });

  test("a group with no listed project is left out", () => {
    const rows = layoutHome(PROJECTS, [{ id: "g9", name: "gone", projectIds: ["p_x"] }], new Set());
    expect(rows.every((row) => row.kind === "project")).toBe(true);
    expect(rows).toHaveLength(5);
  });
});

describe("group edits", () => {
  test("findGroup", () => {
    expect(findGroup([WORK, LINKED], "p3")?.id).toBe("g2");
    expect(findGroup([WORK, LINKED], "p4")).toBeNull();
  });

  test("assignProject moves a project, removes it, and drops an emptied group", () => {
    expect(assignProject([WORK, LINKED], "p1", "g2")).toEqual([
      { ...WORK, projectIds: ["p2"] },
      { ...LINKED, projectIds: ["p3", "p1"] },
    ]);
    expect(assignProject([WORK, LINKED], "p3", null)).toEqual([WORK]);
    expect(assignProject([WORK, LINKED], "p4", "g1")[0]?.projectIds).toEqual(["p1", "p2", "p4"]);
  });

  test("assignProject is a no-op for the current group or an unknown one", () => {
    expect(assignProject([WORK], "p1", "g1")).toEqual([WORK]);
    expect(assignProject([WORK], "p1", "nope")).toEqual([WORK]);
    expect(assignProject([WORK], "p4", null)).toEqual([WORK]);
  });

  test("assignProjectToNamedGroup creates a group, or reuses one with the same name", () => {
    expect(assignProjectToNamedGroup([WORK], "p1", "  new  ", "g9")).toEqual([
      { ...WORK, projectIds: ["p2"] },
      { id: "g9", name: "new", projectIds: ["p1"] },
    ]);
    expect(assignProjectToNamedGroup([WORK, LINKED], "p4", "linked", "g9")).toEqual([
      WORK,
      { ...LINKED, projectIds: ["p3", "p4"] },
    ]);
    expect(assignProjectToNamedGroup([WORK], "p4", "  ", "g9")).toEqual([WORK]);
  });

  test("renameGroup trims and ignores a blank name; ungroup removes the group", () => {
    expect(renameGroup([WORK], "g1", " Job ")).toEqual([{ ...WORK, name: "Job" }]);
    expect(renameGroup([WORK], "g1", " ")).toEqual([WORK]);
    expect(ungroup([WORK, LINKED], "g1")).toEqual([LINKED]);
  });

  test("newGroupId is base-36 time plus a random suffix", () => {
    expect(newGroupId(36 ** 3, () => 0.5)).toBe("1000i");
    expect(newGroupId()).toMatch(/^[0-9a-z]+$/);
  });
});

/** A stub SDK whose thread-list plugin stores preferences in memory. */
function pluginSdk(prefs: Record<string, unknown> | Error) {
  const calls: { pluginId: string; method: string; input: unknown }[] = [];
  const sdk = {
    plugins: {
      callRpc: async (args: {
        pluginId: string;
        method: string;
        input?: unknown;
        outputSchema: { parse: (v: unknown) => unknown };
      }) => {
        calls.push({ pluginId: args.pluginId, method: args.method, input: args.input });
        if (prefs instanceof Error) throw prefs;
        if (args.method === "setPreference") {
          const { key, value } = args.input as { key: string; value: unknown };
          prefs[key] = value;
          return args.outputSchema.parse({ key, value });
        }
        return args.outputSchema.parse({ preferences: { ...prefs } });
      },
    },
  } as unknown as BBSdk;
  return { sdk, calls };
}

describe("readProjectGroups", () => {
  test("reads groups and collapsed ids from the thread-list plugin", async () => {
    const { sdk, calls } = pluginSdk({
      projectGroups: [WORK],
      collapsedProjectGroups: ["g1"],
    });
    const state = await readProjectGroups(sdk);
    expect(state.supported).toBe(true);
    expect(state.groups).toEqual([WORK]);
    expect([...state.collapsed]).toEqual(["g1"]);
    expect(calls[0]).toEqual({
      pluginId: THREAD_LIST_PLUGIN_ID,
      method: "listPreferences",
      input: null,
    });
  });

  test("a thread-list plugin without project groups is unsupported", async () => {
    const { sdk } = pluginSdk({ organizationMode: "project" });
    expect((await readProjectGroups(sdk)).supported).toBe(false);
  });

  test("a missing plugin (404) is unsupported; other errors propagate", async () => {
    const missing = new BbHttpError({
      status: 404,
      body: null,
      code: null,
      message: "unknown plugin",
    });
    expect((await readProjectGroups(pluginSdk(missing).sdk)).supported).toBe(false);
    await expect(readProjectGroups(pluginSdk(new Error("down")).sdk)).rejects.toThrow("down");
  });
});

describe("writing project groups", () => {
  test("updateProjectGroups edits the latest groups and saves them", async () => {
    const prefs: Record<string, unknown> = { projectGroups: [WORK], collapsedProjectGroups: [] };
    const { sdk, calls } = pluginSdk(prefs);
    await updateProjectGroups(sdk, (groups) => renameGroup(groups, "g1", "Job"));
    expect(prefs.projectGroups).toEqual([{ ...WORK, name: "Job" }]);
    expect(calls.map((c) => c.method)).toEqual(["listPreferences", "setPreference"]);
  });

  test("setGroupCollapsed adds and removes a group id", async () => {
    const prefs: Record<string, unknown> = { projectGroups: [], collapsedProjectGroups: ["g2"] };
    const { sdk } = pluginSdk(prefs);
    await setGroupCollapsed(sdk, "g1", true);
    expect(prefs.collapsedProjectGroups).toEqual(["g2", "g1"]);
    await setGroupCollapsed(sdk, "g2", false);
    expect(prefs.collapsedProjectGroups).toEqual(["g1"]);
  });

  test("both refuse to write when this BB has no project groups", async () => {
    const { sdk, calls } = pluginSdk({});
    await expect(updateProjectGroups(sdk, (g) => g)).rejects.toThrow("no project groups");
    await expect(setGroupCollapsed(sdk, "g1", true)).rejects.toThrow("no project groups");
    expect(calls.every((c) => c.method === "listPreferences")).toBe(true);
  });
});

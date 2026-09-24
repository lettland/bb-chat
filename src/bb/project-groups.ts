import { BbHttpError, type PluginRpcArgs } from "bb-app";
import {
  type ProjectGroup,
  parseCollapsedGroups,
  parseProjectGroups,
} from "../tui/project-groups.ts";
import type { BBSdk } from "./sdk.ts";

/**
 * Project groups are owned by BB's built-in thread-list plugin, stored as its
 * `projectGroups` and `collapsedProjectGroups` preferences and exposed through
 * its RPCs. Reading and writing them here keeps bbchat and the BB sidebar in
 * sync: a group made in either shows up in both.
 */
export const THREAD_LIST_PLUGIN_ID = "thread-list";

/**
 * The SDK validates RPC output with a caller-supplied schema; bbchat parses the
 * result structurally instead (as it does every SDK response), so this one
 * passes the value through untouched.
 */
const passthrough = { parse: (value: unknown) => value } as PluginRpcArgs<unknown>["outputSchema"];

export interface ProjectGroupState {
  /** False when this BB has no project groups (no thread-list plugin, or one that predates them). */
  supported: boolean;
  groups: ProjectGroup[];
  collapsed: Set<string>;
}

const UNSUPPORTED: ProjectGroupState = { supported: false, groups: [], collapsed: new Set() };

/** Read the current project groups and which are collapsed. */
export async function readProjectGroups(
  sdk: BBSdk,
  signal?: AbortSignal,
): Promise<ProjectGroupState> {
  let result: unknown;
  try {
    result = await sdk.plugins.callRpc({
      pluginId: THREAD_LIST_PLUGIN_ID,
      method: "listPreferences",
      input: null,
      outputSchema: passthrough,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof BbHttpError && error.status === 404) return UNSUPPORTED;
    throw error;
  }
  const prefs =
    result && typeof result === "object"
      ? (result as Record<string, unknown>).preferences
      : undefined;
  if (!prefs || typeof prefs !== "object" || !("projectGroups" in prefs)) return UNSUPPORTED;
  const rec = prefs as Record<string, unknown>;
  return {
    supported: true,
    groups: parseProjectGroups(rec.projectGroups),
    collapsed: parseCollapsedGroups(rec.collapsedProjectGroups),
  };
}

async function setPreference(sdk: BBSdk, key: string, value: unknown): Promise<void> {
  await sdk.plugins.callRpc({
    pluginId: THREAD_LIST_PLUGIN_ID,
    method: "setPreference",
    input: { key, value } as PluginRpcArgs<unknown>["input"],
    outputSchema: passthrough,
  });
}

/**
 * Apply `edit` to the latest groups and save the result. `setPreference`
 * replaces the whole list, so re-reading first keeps a change made in the BB
 * app since this screen loaded from being overwritten.
 */
export async function updateProjectGroups(
  sdk: BBSdk,
  edit: (groups: ProjectGroup[]) => ProjectGroup[],
): Promise<void> {
  const current = await readProjectGroups(sdk);
  if (!current.supported) throw new Error("this BB has no project groups");
  await setPreference(sdk, "projectGroups", edit(current.groups));
}

/** Collapse or expand one group (read-modify-write, like `updateProjectGroups`). */
export async function setGroupCollapsed(
  sdk: BBSdk,
  groupId: string,
  collapsed: boolean,
): Promise<void> {
  const current = await readProjectGroups(sdk);
  if (!current.supported) throw new Error("this BB has no project groups");
  const next = new Set(current.collapsed);
  if (collapsed) next.add(groupId);
  else next.delete(groupId);
  await setPreference(sdk, "collapsedProjectGroups", [...next]);
}

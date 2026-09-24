/**
 * Project groups for the global home: named, collapsible sets of projects that
 * mirror the BB sidebar's project groups (the thread-list plugin's
 * `projectGroups` / `collapsedProjectGroups` preferences). Pure — parsing,
 * layout, and the edits that produce the next `projectGroups` value; the view
 * reads and writes the preferences through `bb/project-groups.ts`.
 *
 * Layout matches BB's alphabetical project sort: a group sorts by its name
 * among the ungrouped projects, and its members sort by name beneath it.
 */

import type { ProjectRow } from "./project-list-render.ts";

export interface ProjectGroup {
  id: string;
  name: string;
  projectIds: string[];
}

export type HomeRow =
  | { kind: "group"; group: ProjectGroup; members: ProjectRow[]; collapsed: boolean }
  | { kind: "project"; project: ProjectRow; groupId: string | null };

function toGroup(entry: unknown): ProjectGroup | null {
  if (!entry || typeof entry !== "object") return null;
  const rec = entry as Record<string, unknown>;
  if (typeof rec.id !== "string" || rec.id.length === 0) return null;
  const name = typeof rec.name === "string" ? rec.name.trim() : "";
  if (name.length === 0) return null;
  const projectIds = Array.isArray(rec.projectIds)
    ? rec.projectIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  // Any other field BB keeps on a group rides along, so a rewrite doesn't drop it.
  return { ...rec, id: rec.id, name, projectIds };
}

/**
 * Normalize a `projectGroups` value (structural/defensive). Duplicate group ids
 * and a project listed in a second group are dropped — BB rejects both on write.
 */
export function parseProjectGroups(value: unknown): ProjectGroup[] {
  if (!Array.isArray(value)) return [];
  const groups: ProjectGroup[] = [];
  const groupIds = new Set<string>();
  const projectIds = new Set<string>();
  for (const entry of value) {
    const group = toGroup(entry);
    if (!group || groupIds.has(group.id)) continue;
    groupIds.add(group.id);
    group.projectIds = group.projectIds.filter((id) => !projectIds.has(id));
    for (const id of group.projectIds) projectIds.add(id);
    groups.push(group);
  }
  return groups;
}

/** Normalize a `collapsedProjectGroups` value into a set of group ids. */
export function parseCollapsedGroups(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0));
}

/**
 * Lay projects out under their groups. Groups with no listed project are left
 * out; a collapsed group keeps its header but hides its members.
 */
export function layoutHome(
  projects: readonly ProjectRow[],
  groups: readonly ProjectGroup[],
  collapsed: ReadonlySet<string>,
): HomeRow[] {
  const groupOf = new Map<string, ProjectGroup>();
  for (const group of groups) {
    for (const id of group.projectIds) groupOf.set(id, group);
  }
  const members = new Map<string, ProjectRow[]>();
  const top: { name: string; group: ProjectGroup | null; project: ProjectRow | null }[] = [];
  for (const project of projects) {
    const group = groupOf.get(project.id);
    if (!group) {
      top.push({ name: project.name, group: null, project });
      continue;
    }
    const list = members.get(group.id);
    if (list) {
      list.push(project);
    } else {
      members.set(group.id, [project]);
      top.push({ name: group.name, group, project: null });
    }
  }
  top.sort((a, b) => a.name.localeCompare(b.name));

  const rows: HomeRow[] = [];
  for (const entry of top) {
    if (entry.project) {
      rows.push({ kind: "project", project: entry.project, groupId: null });
      continue;
    }
    const group = entry.group as ProjectGroup;
    const list = (members.get(group.id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    const isCollapsed = collapsed.has(group.id);
    rows.push({ kind: "group", group, members: list, collapsed: isCollapsed });
    if (isCollapsed) continue;
    for (const project of list) rows.push({ kind: "project", project, groupId: group.id });
  }
  return rows;
}

/** One-line display string for a home row: `▾ name (n)` headers, indented members. */
export function formatHomeRow(row: HomeRow): string {
  if (row.kind === "group") {
    return `${row.collapsed ? "▸" : "▾"} ${row.group.name} (${row.members.length})`;
  }
  return row.groupId ? `    ${row.project.name}` : row.project.name;
}

/** The group a project belongs to, or null. */
export function findGroup(groups: readonly ProjectGroup[], projectId: string): ProjectGroup | null {
  return groups.find((group) => group.projectIds.includes(projectId)) ?? null;
}

function withoutProject(groups: readonly ProjectGroup[], projectId: string): ProjectGroup[] {
  return groups.flatMap((group) => {
    if (!group.projectIds.includes(projectId)) return [group];
    const remaining = group.projectIds.filter((id) => id !== projectId);
    // Like BB, a group whose last project leaves is removed.
    return remaining.length === 0 ? [] : [{ ...group, projectIds: remaining }];
  });
}

/** Move a project into `groupId`, or out of every group when `groupId` is null. */
export function assignProject(
  groups: readonly ProjectGroup[],
  projectId: string,
  groupId: string | null,
): ProjectGroup[] {
  if (findGroup(groups, projectId)?.id === groupId) return [...groups];
  if (groupId !== null && !groups.some((group) => group.id === groupId)) return [...groups];
  return withoutProject(groups, projectId).map((group) =>
    group.id === groupId ? { ...group, projectIds: [...group.projectIds, projectId] } : group,
  );
}

/**
 * Put a project into a group named `name`: an existing group with exactly that
 * name is reused, otherwise a new group is created with `newId`.
 */
export function assignProjectToNamedGroup(
  groups: readonly ProjectGroup[],
  projectId: string,
  name: string,
  newId: string,
): ProjectGroup[] {
  const trimmed = name.trim();
  if (trimmed.length === 0) return [...groups];
  const existing = groups.find((group) => group.name === trimmed);
  if (existing) return assignProject(groups, projectId, existing.id);
  return [
    ...withoutProject(groups, projectId),
    { id: newId, name: trimmed, projectIds: [projectId] },
  ];
}

export function renameGroup(
  groups: readonly ProjectGroup[],
  groupId: string,
  name: string,
): ProjectGroup[] {
  const trimmed = name.trim();
  if (trimmed.length === 0) return [...groups];
  return groups.map((group) => (group.id === groupId ? { ...group, name: trimmed } : group));
}

/** Remove a group; its projects become ungrouped. */
export function ungroup(groups: readonly ProjectGroup[], groupId: string): ProjectGroup[] {
  return groups.filter((group) => group.id !== groupId);
}

/** A fresh group id in BB's format (base-36 time + random suffix). */
export function newGroupId(now: number = Date.now(), random: () => number = Math.random): string {
  return `${now.toString(36)}${random().toString(36).slice(2, 8)}`;
}

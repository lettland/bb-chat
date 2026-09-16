import { basename, resolve } from "node:path";
import { VchError } from "../errors.ts";
import type { BBSdk } from "./sdk.ts";

/** Structural subset of a BB project we rely on (decoupled from exact SDK type names). */
export interface ProjectLike {
  id: string;
  name: string;
  sources: ReadonlyArray<{ type: string; path?: string | undefined }>;
}

/** Structural subset of a BB host. */
export interface HostLike {
  id: string;
  type: string;
  status: string;
}

/** Normalize a filesystem path for equality comparison (absolute, no trailing slash). */
export function normalizePath(path: string): string {
  const abs = resolve(path);
  return abs.length > 1 && abs.endsWith("/") ? abs.slice(0, -1) : abs;
}

/** Find the project whose local-path source matches `cwd` exactly, or `null`. */
export function matchProjectByPath<P extends ProjectLike>(
  projects: readonly P[],
  cwd: string,
): P | null {
  const target = normalizePath(cwd);
  for (const project of projects) {
    for (const source of project.sources) {
      if (source.type === "local_path" && source.path && normalizePath(source.path) === target) {
        return project;
      }
    }
  }
  return null;
}

/** Choose the local host for creating a local-path project: prefer connected + persistent. */
export function pickLocalHost<H extends HostLike>(hosts: readonly H[]): H | null {
  const connectedPersistent = hosts.find(
    (h) => h.type === "persistent" && h.status === "connected",
  );
  if (connectedPersistent) return connectedPersistent;
  const persistent = hosts.find((h) => h.type === "persistent");
  if (persistent) return persistent;
  return hosts[0] ?? null;
}

export interface ResolveProjectOptions {
  /** Auto-create the project when no match exists (the default "just works" behavior). */
  create?: boolean;
  signal?: AbortSignal;
}

export interface ResolvedProject {
  id: string;
  name: string;
  /** Whether this project was created during resolution. */
  created: boolean;
}

/**
 * Resolve the BB project for a working directory: match an existing project by
 * local-path source, else create one rooted at `cwd` (like a coding agent that
 * "just works" in whatever directory you launch it from).
 */
export async function resolveProject(
  sdk: BBSdk,
  cwd: string,
  options: ResolveProjectOptions = {},
): Promise<ResolvedProject> {
  const { create = true, signal } = options;
  const projects = (await sdk.projects.list({ signal })) as ProjectLike[];
  const match = matchProjectByPath(projects, cwd);
  if (match) return { id: match.id, name: match.name, created: false };

  if (!create) {
    throw new VchError(
      `No BB project is registered for ${normalizePath(cwd)}.`,
      "Run 'vch' here to create one, or open the directory in the BB app.",
    );
  }

  const hosts = (await sdk.hosts.list()) as HostLike[];
  const host = pickLocalHost(hosts);
  if (!host) {
    throw new VchError(
      "No BB host is available to create a project on.",
      "Ensure the BB host daemon is running, then retry.",
    );
  }

  const created = await sdk.projects.create({
    name: basename(normalizePath(cwd)) || "project",
    source: { type: "local_path", hostId: host.id, path: normalizePath(cwd) },
  });
  return { id: created.id, name: created.name, created: true };
}

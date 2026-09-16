import { basename, resolve } from "node:path";
import { VchError } from "../errors.ts";
import type { BBSdk } from "./sdk.ts";

/** Structural subset of a BB project we rely on (decoupled from exact SDK type names). */
export interface ProjectLike {
  id: string;
  name: string;
  sources: ReadonlyArray<{ type: string; path?: string | undefined }>;
}

/** List all projects (for the global home). */
export function listProjects(sdk: BBSdk, signal?: AbortSignal): Promise<unknown[]> {
  return sdk.projects.list({ signal }) as Promise<unknown[]>;
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

export interface ProjectMatch {
  id: string;
  name: string;
}

/**
 * Find the BB project registered for a working directory by its local-path
 * source. Returns null when none exists — never creates one, so merely opening
 * `vch` in a directory has no side effect.
 */
export async function findProject(
  sdk: BBSdk,
  cwd: string,
  signal?: AbortSignal,
): Promise<ProjectMatch | null> {
  const projects = (await sdk.projects.list({ signal })) as ProjectLike[];
  const match = matchProjectByPath(projects, cwd);
  return match ? { id: match.id, name: match.name } : null;
}

/**
 * Resolve the BB project for a working directory, creating one rooted at `cwd`
 * if none exists. Call this only when the user commits to working here (starting
 * a thread) — not on a bare open — so projects aren't registered for directories
 * you only glanced at.
 */
export async function ensureProject(
  sdk: BBSdk,
  cwd: string,
  signal?: AbortSignal,
): Promise<ProjectMatch> {
  const existing = await findProject(sdk, cwd, signal);
  if (existing) return existing;

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
  return { id: created.id, name: created.name };
}

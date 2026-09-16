import type { BBSdk } from "./sdk.ts";

/** List installed plugins. */
export function listPlugins(sdk: BBSdk, signal?: AbortSignal): Promise<unknown> {
  return sdk.plugins.list({ signal });
}

/** List skills available in a project (environment-scoped when given). */
export function listSkills(
  sdk: BBSdk,
  projectId: string,
  environmentId: string | null = null,
  signal?: AbortSignal,
): Promise<unknown> {
  return sdk.skills.list({ projectId, environmentId, signal });
}

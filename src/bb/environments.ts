import type { BBSdk } from "./sdk.ts";
import type { Unsubscribe } from "./threads.ts";

/**
 * Fetch the changed-files diff (with eagerly-loaded patches) for an environment.
 * Review uncommitted changes or the full branch relative to its merge base.
 */
export async function getDiffFiles(
  sdk: BBSdk,
  environmentId: string,
  signal?: AbortSignal,
  target: "uncommitted" | "all" = "uncommitted",
): Promise<unknown> {
  if (target === "uncommitted")
    return sdk.environments.diffFiles({ environmentId, target, signal });
  const environment = await sdk.environments.get({ environmentId, signal });
  const mergeBaseBranch = environment.mergeBaseBranch ?? environment.defaultBranch;
  if (!mergeBaseBranch) throw new Error("this environment has no merge base branch");
  return sdk.environments.diffFiles({ environmentId, target, mergeBaseBranch, signal });
}

/**
 * Watch an environment for changes. An environment's diff also moves when
 * something other than the on-screen thread touches it — a commit from the
 * auto-review plugin, a manual `git commit`, a branch switch — none of which
 * emit a `thread:changed`, so a diff view has to watch the environment itself.
 */
export function watchEnvironment(
  sdk: BBSdk,
  environmentId: string,
  onChange: () => void,
): Unsubscribe {
  return sdk.subscribe({
    event: "environment:changed",
    environmentId,
    callback: () => onChange(),
  });
}

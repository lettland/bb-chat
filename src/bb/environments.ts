import type { BBSdk } from "./sdk.ts";

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

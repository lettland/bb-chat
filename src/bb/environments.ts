import type { BBSdk } from "./sdk.ts";

/**
 * Fetch the changed-files diff (with eagerly-loaded patches) for an environment.
 * Targets uncommitted working-tree changes — the pre-commit review case.
 * Reviewing a whole branch (`target: "all"`) needs the merge-base branch and
 * lands in a later pass.
 */
export function getDiffFiles(
  sdk: BBSdk,
  environmentId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  return sdk.environments.diffFiles({ environmentId, target: "uncommitted", signal });
}

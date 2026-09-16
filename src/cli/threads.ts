import { ensureServer } from "../bb/ensure-server.ts";
import { findProject } from "../bb/project.ts";
import { createSdk } from "../bb/sdk.ts";
import { listThreads } from "../bb/threads.ts";
import { resolveConfig } from "../config.ts";
import { VchError } from "../errors.ts";
import { renderThreadList } from "../tui/thread-list-render.ts";

/**
 * `vch threads` — list the current project's threads with their ids, i.e. the
 * `thr_...` values for `vch <thread-id>`. Read-only; does not create a project,
 * so it errors clearly when the cwd isn't a BB project.
 */
export async function runThreads(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const config = await resolveConfig(env);
  const server = await ensureServer(config);
  const sdk = createSdk(server.serverUrl);
  const project = await findProject(sdk, process.cwd());
  if (!project) {
    throw new VchError(
      `No BB project for ${process.cwd()}.`,
      'Start one here with:  vch new "your first task"',
    );
  }

  const rows = renderThreadList(await listThreads(sdk, project.id));
  const lines: string[] = [`Threads in ${project.name} (open with: vch <id>):`, ""];
  if (rows.length === 0) {
    lines.push("  (no threads yet — start one with: vch new)");
  }
  for (const row of rows) {
    const flag = row.attention ? "!" : " ";
    lines.push(`  ${row.id}  ${flag} ${row.status.padEnd(9).slice(0, 9)}  ${row.title}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

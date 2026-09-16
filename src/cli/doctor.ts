import { candidateServerUrls, detect } from "../bb/detect.ts";
import { probeHealth } from "../bb/health.ts";
import { configPath, resolveConfig } from "../config.ts";

/**
 * `vch doctor` — re-run detection and a health check against the resolved config.
 * Read-only diagnostics: it explains whether `vch` can reach BB and what launch
 * options exist, without changing anything.
 */
export async function runDoctor(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const config = await resolveConfig(env);
  const path = configPath(env);
  const fileExists = await Bun.file(path).exists();

  const health = await probeHealth(config.serverUrl);
  const detection = await detect(candidateServerUrls(env));

  const lines = [
    `config file   ${fileExists ? path : `${path} (not present — using defaults)`}`,
    `serverUrl     ${config.serverUrl}`,
    `health        ${health.ok ? `ok (launchId ${health.launchId ?? "unknown"})` : "unreachable"}`,
    `autoStart     ${config.autoStart}`,
    `startCommand  ${config.startCommand ? config.startCommand.join(" ") : "(none)"}`,
    `bb-app on PATH ${detection.bbAppPath ?? "(not found)"}`,
    `bb on PATH    ${detection.bbPath ?? "(not found)"}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  return health.ok ? 0 : 1;
}

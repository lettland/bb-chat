import { candidateServerUrls, detect, detectionToConfig } from "../bb/detect.ts";
import { configPath, writeConfigFile } from "../config.ts";
import type { VchConfig } from "../types.ts";

export interface InitOptions {
  yes: boolean;
  force: boolean;
  print: boolean;
}

function summarize(config: VchConfig, detection: { runningServerUrl: string | null }): string {
  const reachable = detection.runningServerUrl === config.serverUrl;
  const lines = [
    `  serverUrl     ${config.serverUrl}${reachable ? "  (reachable)" : ""}`,
    `  bbCommand     ${config.bbCommand ? config.bbCommand.join(" ") : "(none detected)"}`,
    `  startCommand  ${config.startCommand ? config.startCommand.join(" ") : "(none detected)"}`,
    `  autoStart     ${config.autoStart}`,
  ];
  return lines.join("\n");
}

/**
 * `vch init` — detect a system-local BB and write an editable config. Never
 * launches anything; `autoStart` defaults to `false`. The written file is meant
 * to be hand-edited (e.g. to point at a local dev BB instead of an official one).
 */
export async function runInit(
  options: InitOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const candidates = candidateServerUrls(env);
  const detection = await detect(candidates);
  const config = detectionToConfig(detection, candidates[0]);

  // An explicitly-requested URL is the user's intent and wins over whatever
  // stray server happened to answer detection (e.g. an unrelated BB on the
  // default port while the requested one is momentarily down).
  const explicitUrl = env.VCH_SERVER_URL?.trim() || env.BB_SERVER_URL?.trim() || null;
  const overrodeReachable =
    explicitUrl !== null &&
    detection.runningServerUrl !== null &&
    detection.runningServerUrl !== explicitUrl;
  if (explicitUrl) config.serverUrl = explicitUrl;
  const path = configPath(env);

  if (options.print) {
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    return 0;
  }

  const overrideNote = overrodeReachable
    ? `\nNote: kept your requested ${explicitUrl}; a different BB is reachable at ${detection.runningServerUrl}.\n`
    : "";

  const exists = await Bun.file(path).exists();
  if (exists && !options.force) {
    process.stdout.write(
      `Config already exists at ${path}.\nDetected settings (not written — pass --force to overwrite):\n${summarize(config, detection)}\n${overrideNote}`,
    );
    return 0;
  }

  await writeConfigFile(config, env);
  process.stdout.write(`Wrote ${path}\n${summarize(config, detection)}\n${overrideNote}`);
  if (!detection.runningServerUrl) {
    process.stdout.write(
      "\nBB was not reachable during detection. Start BB, or edit the config to set a startCommand and autoStart.\n",
    );
  }
  return 0;
}

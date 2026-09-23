import { candidateServerUrls, detect, detectionToConfig } from "../bb/detect.ts";
import { createSdk } from "../bb/sdk.ts";
import { configPath, parseCommand, writeConfigFile } from "../config.ts";
import type { BbchatConfig } from "../types.ts";

export interface InitOptions {
  yes: boolean;
  force: boolean;
  print: boolean;
}

/** Minimal line-prompter, injected so the interactive flow stays testable. */
export interface InitPrompter {
  text(question: string, def: string): string;
  yesNo(question: string, def: boolean): boolean;
}

/** Interactively refine a config. Pure given the prompter. */
export function promptConfig(config: BbchatConfig, prompter: InitPrompter): BbchatConfig {
  const serverUrl = prompter.text("BB server URL", config.serverUrl) || config.serverUrl;
  const startRaw = prompter.text(
    "Start command to launch BB when it is down (blank = none)",
    config.startCommand ? config.startCommand.join(" ") : "",
  );
  const startCommand = parseCommand(startRaw);
  const autoStart = startCommand
    ? prompter.yesNo("Auto-start BB with that command when it is unreachable?", config.autoStart)
    : false;
  return { ...config, serverUrl, startCommand, autoStart };
}

/** Bun-backed prompter using the global prompt(). */
const bunPrompter: InitPrompter = {
  text(question, def) {
    const answer = prompt(question, def);
    const value = (answer ?? def).trim();
    return value.length > 0 ? value : def;
  },
  yesNo(question, def) {
    const answer = prompt(`${question} ${def ? "[Y/n]" : "[y/N]"}`, "");
    const value = (answer ?? "").trim().toLowerCase();
    if (value.length === 0) return def;
    return value === "y" || value === "yes";
  },
};

function summarize(config: BbchatConfig, reachable: boolean): string {
  return [
    `  serverUrl     ${config.serverUrl}${reachable ? "  (reachable)" : ""}`,
    `  bbCommand     ${config.bbCommand ? config.bbCommand.join(" ") : "(none)"}`,
    `  startCommand  ${config.startCommand ? config.startCommand.join(" ") : "(none)"}`,
    `  autoStart     ${config.autoStart}`,
  ].join("\n");
}

/** Best-effort: ask a reachable server what it is (it exposes version/source, not its launcher). */
async function serverInfo(serverUrl: string): Promise<string | null> {
  try {
    const v = await createSdk(serverUrl).system.version();
    return `BB ${v.currentVersion} (${v.isDevelopment ? "development" : v.source})`;
  } catch {
    return null;
  }
}

/**
 * Explain the command fields. BB does not expose its own launch command over the
 * API, and an npm/desktop install has no `bb-app` CLI on PATH — so empty
 * bbCommand/startCommand is expected. They are only needed to auto-launch BB when
 * it is unreachable; a reachable server needs neither.
 */
function commandNote(config: BbchatConfig, reachable: boolean): string {
  if (config.startCommand) return "";
  if (reachable) {
    return "\nNo start command detected — not needed while BB is reachable. It is only used to auto-launch BB when it is down; the server doesn't expose its own launch command, so it can't be filled in automatically. Set startCommand + autoStart yourself if you want bbchat to launch BB.\n";
  }
  return "\nBB was not reachable and no launch command was detected. Start BB yourself, or set startCommand + autoStart in the config so bbchat can launch it.\n";
}

/**
 * `bbchat init` — detect a system-local BB and write an editable config. Interactive
 * by default (review/edit each field); `--yes` or a non-TTY stdin writes the
 * detected values without prompting. Never launches anything; `autoStart`
 * defaults to `false`.
 */
export async function runInit(
  options: InitOptions,
  env: NodeJS.ProcessEnv = process.env,
  prompter: InitPrompter = bunPrompter,
): Promise<number> {
  const candidates = candidateServerUrls(env);
  const detection = await detect(candidates);
  let config = detectionToConfig(detection, candidates[0]);

  // An explicitly-requested URL wins over whatever stray server answered detection.
  const explicitUrl = env.BBCHAT_SERVER_URL?.trim() || env.BB_SERVER_URL?.trim() || null;
  if (explicitUrl) config.serverUrl = explicitUrl;

  const reachable = detection.runningServerUrl === config.serverUrl;
  const path = configPath(env);

  if (options.print) {
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    return 0;
  }

  const info = reachable ? await serverInfo(config.serverUrl) : null;
  const interactive = !options.yes && Boolean(process.stdin.isTTY);
  const exists = await Bun.file(path).exists();

  if (interactive) {
    if (info) process.stdout.write(`Detected ${info} at ${config.serverUrl}\n`);
    if (exists && !options.force) {
      if (!prompter.yesNo(`Config exists at ${path}. Overwrite?`, false)) {
        process.stdout.write("Keeping the existing config.\n");
        return 0;
      }
    }
    config = promptConfig(config, prompter);
  } else if (exists && !options.force) {
    process.stdout.write(
      `Config already exists at ${path}.\nDetected settings (not written — pass --force to overwrite, or run without --yes to edit):\n${summarize(config, reachable)}\n`,
    );
    return 0;
  }

  await writeConfigFile(config, env);
  process.stdout.write(
    `Wrote ${path}\n${info ? `${info}\n` : ""}${summarize(config, reachable)}\n${commandNote(config, reachable)}`,
  );
  return 0;
}

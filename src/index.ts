#!/usr/bin/env bun
import { ensureServer } from "./bb/ensure-server.ts";
import { ensureProject, findProject } from "./bb/project.ts";
import { spawnThread } from "./bb/providers.ts";
import { createSdk } from "./bb/sdk.ts";
import { parseArgs } from "./cli/args.ts";
import { runDoctor } from "./cli/doctor.ts";
import { runInit } from "./cli/init.ts";
import { assessPrompt } from "./cli/prompt-guard.ts";
import { runProviders } from "./cli/providers.ts";
import { runSelfcheck } from "./cli/selfcheck.ts";
import { resolveSpawnShorthand } from "./cli/shorthand.ts";
import { runThreads } from "./cli/threads.ts";
import { resolveConfig } from "./config.ts";
import { BbchatError, isBbchatError } from "./errors.ts";
import type { ChatContext } from "./tui/app.ts";
import { runChat } from "./tui/app.ts";
import {
  PERMISSION_MODES,
  type PermissionMode,
  REASONING_LEVELS,
  type SpawnPreset,
} from "./tui/spawn-wizard.ts";
import { errorText } from "./tui/util.ts";
import { VERSION } from "./version.ts";

/** Reject a flag value that isn't one of the allowed enum values. */
function assertEnumFlag(flag: string, value: string | null, allowed: readonly string[]): void {
  if (value !== null && !allowed.includes(value)) {
    throw new BbchatError(`invalid ${flag} "${value}"`, `expected one of: ${allowed.join(", ")}`);
  }
}

/** The `bbchat new …` command that reproduces a resolved shorthand preset, for hints. */
function presetCommandHint(preset: SpawnPreset | null): string {
  const base = 'bbchat new "your first task"';
  if (!preset) return base;
  const flags = [
    `--provider ${preset.providerId}`,
    preset.model ? `--model ${preset.model}` : null,
    preset.reasoningLevel ? `--reasoning ${preset.reasoningLevel}` : null,
    preset.permissionMode ? `--mode ${preset.permissionMode}` : null,
  ].filter((f): f is string => f !== null);
  return `${base} ${flags.join(" ")}`;
}

const HELP = `bbchat ${VERSION} — BB in your terminal

Usage:
  bbchat                      Open the current directory's project (does not create one)
  bbchat <provider> [model] [reasoning] [mode]
                              Open the thread list with those new-thread defaults
                              (opens the list, does not spawn; order-independent).
                              e.g. bbchat codex 5.6-sol high · bbchat claude 'opus-5[1m]'
                              (quote models with [brackets] so the shell doesn't glob them)
  bbchat -g, --global         Global home: all projects
  bbchat <thread-id>          Open a specific thread (thr_...)
  bbchat threads              List this project's threads and their ids
  bbchat new ["prompt"]       Start a thread (interactive picker if no prompt)
      [--provider <id>] [--model <id>] [--reasoning <level>] [--mode <mode>] [--force]
      (a trivial prompt like "hi" asks to confirm; --force skips the check)
  bbchat providers            List providers, models, reasoning levels, and modes
  bbchat init [--yes] [--force] [--print]
                              Detect system-local BB, write an editable config
  bbchat doctor               Diagnose config + BB reachability
  bbchat selfcheck            Verify offline markdown/code highlighting in this build
  bbchat help | version

Configuration (~/.config/bbchat/config.json, overridable by env):
  BBCHAT_SERVER_URL / BB_SERVER_URL, BBCHAT_START_COMMAND, BBCHAT_BB_COMMAND, BBCHAT_AUTO_START
  BBCHAT_THEME=light|dark    Force the palette (default: follow the terminal's background)
`;

async function runChatCommand(
  global: boolean,
  threadId: string | null,
  spawnTokens: string[] | null,
): Promise<number> {
  const config = await resolveConfig();
  const server = await ensureServer(config);
  const sdk = createSdk(server.serverUrl);

  // Resolve the `bbchat <provider> …` shorthand into new-thread defaults. A bad token
  // throws BbchatError (aborts with the valid options); a transport blip yields null,
  // so the command still behaves exactly like bare `bbchat`.
  const spawnPreset: SpawnPreset | null =
    spawnTokens && spawnTokens.length > 0 ? await resolveSpawnShorthand(sdk, spawnTokens) : null;

  // Opening a specific thread or the global home needs no project. Bare `bbchat`
  // only OPENS the cwd's project — it does not create one (that happens when you
  // start a thread), so merely opening in a new directory has no side effect.
  let project: ChatContext["project"] = null;
  if (!global && !threadId) {
    project = await findProject(sdk, process.cwd());
    if (!project) {
      // Echo the resolved preset as a runnable command so the shorthand isn't lost.
      process.stdout.write(
        `No BB project for ${process.cwd()} yet (nothing was created).\n` +
          `Start one here with:  ${presetCommandHint(spawnPreset)}\n`,
      );
      return 0;
    }
  }

  if (!process.stdout.isTTY) {
    const scope = threadId ?? (global ? "global" : (project?.name ?? "project"));
    process.stdout.write(
      `Connected to BB at ${server.serverUrl} (${scope}). Run bbchat in a terminal to open the interactive UI.\n`,
    );
    return 0;
  }

  await runChat({
    sdk,
    serverUrl: server.serverUrl,
    project,
    global,
    initialThreadId: threadId,
    newThreadCwd: null,
    spawnPreset,
  });
  // The TUI is done (quit via /exit, Ctrl-C, or backing out). Realtime WebSocket
  // subscriptions and the OpenTUI runtime keep the event loop alive after the
  // renderer is destroyed, so force a clean exit rather than hang.
  process.exit(0);
}

/**
 * `bbchat new`. With a prompt, quick-spawns a thread using the given
 * provider/model/mode (project-default environment) and opens it. Without a
 * prompt, opens the interactive spawn wizard.
 */
async function runNew(
  provider: string | null,
  model: string | null,
  mode: string | null,
  reasoning: string | null,
  promptText: string | null,
  force: boolean,
): Promise<number> {
  assertEnumFlag("--mode", mode, PERMISSION_MODES);
  assertEnumFlag("--reasoning", reasoning, REASONING_LEVELS);

  const config = await resolveConfig();
  const server = await ensureServer(config);
  const sdk = createSdk(server.serverUrl);

  // No prompt → interactive wizard. The project is created lazily on submit, so
  // opening (and cancelling) the wizard registers nothing.
  if (!promptText) {
    if (!process.stdout.isTTY) {
      process.stdout.write(
        'Run `bbchat new` in a terminal for the picker, or pass a task: bbchat new "your task".\n',
      );
      return 0;
    }
    await runChat({
      sdk,
      serverUrl: server.serverUrl,
      project: null,
      global: false,
      initialThreadId: null,
      newThreadCwd: process.cwd(),
      spawnPreset: null,
    });
    process.exit(0);
  }

  // Quick-spawn. Assess the prompt BEFORE creating a project or spawning, so a
  // trivial prompt neither registers a project nor spends tokens.
  if (!force) {
    const assessment = assessPrompt(promptText);
    if (assessment.lowValue) {
      if (process.stdin.isTTY && process.stdout.isTTY) {
        const answer = globalThis.prompt(
          `This prompt ${assessment.reason} and will spend provider tokens. Start a thread anyway? [y/N]`,
        );
        if (!/^y(es)?$/i.test((answer ?? "").trim())) {
          process.stdout.write("Aborted — no thread created.\n");
          return 0;
        }
      } else {
        throw new BbchatError(
          `Refusing to spawn: the prompt ${assessment.reason}.`,
          "Give a more specific task, or pass --force to spawn anyway.",
        );
      }
    }
  }

  const project = await ensureProject(sdk, process.cwd());
  // provider/model may be null: BB resolves its own defaults (see spawnThread).
  let threadId: string | null;
  try {
    threadId = await spawnThread(sdk, {
      projectId: project.id,
      providerId: provider,
      model,
      permissionMode: mode as PermissionMode | null,
      reasoningLevel: reasoning,
      prompt: promptText,
    });
  } catch (error) {
    throw new BbchatError(
      `could not start a thread: ${errorText(error)}`,
      "check 'bbchat providers' for valid --provider / --model values",
    );
  }
  if (!threadId) throw new BbchatError("BB did not return a new thread id.");

  if (!process.stdout.isTTY) {
    process.stdout.write(`Created ${threadId}\n`);
    return 0;
  }
  await runChat({
    sdk,
    serverUrl: server.serverUrl,
    project,
    global: false,
    initialThreadId: threadId,
    newThreadCwd: null,
    spawnPreset: null,
  });
  process.exit(0);
}

async function main(): Promise<number> {
  const command = parseArgs(Bun.argv.slice(2));
  switch (command.kind) {
    case "help":
      process.stdout.write(HELP);
      return 0;
    case "version":
      process.stdout.write(`${VERSION}\n`);
      return 0;
    case "init":
      return runInit(command);
    case "doctor":
      return runDoctor();
    case "selfcheck":
      return runSelfcheck();
    case "providers":
      return runProviders();
    case "threads":
      return runThreads();
    case "chat":
      return runChatCommand(command.global, command.threadId, command.spawnTokens);
    case "new":
      return runNew(
        command.provider,
        command.model,
        command.mode,
        command.reasoning,
        command.prompt,
        command.force,
      );
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (isBbchatError(error)) {
      process.stderr.write(`bbchat: ${error.message}\n`);
      if (error.hint) process.stderr.write(`     ${error.hint}\n`);
    } else {
      process.stderr.write(`bbchat: unexpected error: ${String(error)}\n`);
      if (process.env.BBCHAT_DEBUG && error instanceof Error && error.stack) {
        process.stderr.write(`${error.stack}\n`);
      }
    }
    process.exitCode = 1;
  });

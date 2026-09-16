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
import { runThreads } from "./cli/threads.ts";
import { resolveConfig } from "./config.ts";
import { isVchError, VchError } from "./errors.ts";
import type { ChatContext } from "./tui/app.ts";
import { runChat } from "./tui/app.ts";
import { PERMISSION_MODES, type PermissionMode } from "./tui/spawn-wizard.ts";
import { errorText } from "./tui/util.ts";
import { VERSION } from "./version.ts";

const HELP = `vch ${VERSION} — BB in your terminal

Usage:
  vch                     Open the current directory's project (does not create one)
  vch -g, --global        Global home: all projects
  vch <thread-id>         Open a specific thread (thr_...)
  vch threads             List this project's threads and their ids
  vch new ["prompt"]      Start a thread (interactive picker if no prompt)
      [--provider <id>] [--model <id>] [--mode <mode>] [--force]
      (a trivial prompt like "hi" asks to confirm; --force skips the check)
  vch providers           List providers, models, and modes (values for vch new)
  vch init [--yes] [--force] [--print]   Detect system-local BB, write editable config
  vch doctor              Diagnose config + BB reachability
  vch help | version

Configuration (~/.config/vch/config.json, overridable by env):
  VCH_SERVER_URL / BB_SERVER_URL, VCH_START_COMMAND, VCH_BB_COMMAND, VCH_AUTO_START
`;

async function runChatCommand(global: boolean, threadId: string | null): Promise<number> {
  const config = await resolveConfig();
  const server = await ensureServer(config);
  const sdk = createSdk(server.serverUrl);

  // Opening a specific thread or the global home needs no project. Bare `vch`
  // only OPENS the cwd's project — it does not create one (that happens when you
  // start a thread), so merely opening in a new directory has no side effect.
  let project: ChatContext["project"] = null;
  if (!global && !threadId) {
    project = await findProject(sdk, process.cwd());
    if (!project) {
      process.stdout.write(
        `No BB project for ${process.cwd()} yet (nothing was created).\n` +
          `Start one here with:  vch new "your first task"\n`,
      );
      return 0;
    }
  }

  if (!process.stdout.isTTY) {
    const scope = threadId ?? (global ? "global" : (project?.name ?? "project"));
    process.stdout.write(
      `Connected to BB at ${server.serverUrl} (${scope}). Run vch in a terminal to open the interactive UI.\n`,
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
  });
  // The TUI is done (quit via /exit, Ctrl-C, or backing out). Realtime WebSocket
  // subscriptions and the OpenTUI runtime keep the event loop alive after the
  // renderer is destroyed, so force a clean exit rather than hang.
  process.exit(0);
}

/**
 * `vch new`. With a prompt, quick-spawns a thread using the given
 * provider/model/mode (project-default environment) and opens it. Without a
 * prompt, opens the interactive spawn wizard.
 */
async function runNew(
  provider: string | null,
  model: string | null,
  mode: string | null,
  promptText: string | null,
  force: boolean,
): Promise<number> {
  if (mode !== null && !(PERMISSION_MODES as readonly string[]).includes(mode)) {
    throw new VchError(
      `invalid --mode "${mode}"`,
      `expected one of: ${PERMISSION_MODES.join(", ")}`,
    );
  }

  const config = await resolveConfig();
  const server = await ensureServer(config);
  const sdk = createSdk(server.serverUrl);

  // No prompt → interactive wizard. The project is created lazily on submit, so
  // opening (and cancelling) the wizard registers nothing.
  if (!promptText) {
    if (!process.stdout.isTTY) {
      process.stdout.write(
        'Run `vch new` in a terminal for the picker, or pass a task: vch new "your task".\n',
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
        throw new VchError(
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
      prompt: promptText,
    });
  } catch (error) {
    throw new VchError(
      `could not start a thread: ${errorText(error)}`,
      "check 'vch providers' for valid --provider / --model values",
    );
  }
  if (!threadId) throw new VchError("BB did not return a new thread id.");

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
    case "providers":
      return runProviders();
    case "threads":
      return runThreads();
    case "chat":
      return runChatCommand(command.global, command.threadId);
    case "new":
      return runNew(command.provider, command.model, command.mode, command.prompt, command.force);
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (isVchError(error)) {
      process.stderr.write(`vch: ${error.message}\n`);
      if (error.hint) process.stderr.write(`     ${error.hint}\n`);
    } else {
      process.stderr.write(`vch: unexpected error: ${String(error)}\n`);
      if (process.env.VCH_DEBUG && error instanceof Error && error.stack) {
        process.stderr.write(`${error.stack}\n`);
      }
    }
    process.exitCode = 1;
  });

#!/usr/bin/env bun
import { ensureServer } from "./bb/ensure-server.ts";
import { resolveProject } from "./bb/project.ts";
import { createSdk } from "./bb/sdk.ts";
import { parseArgs } from "./cli/args.ts";
import { runDoctor } from "./cli/doctor.ts";
import { runInit } from "./cli/init.ts";
import { resolveConfig } from "./config.ts";
import { isVchError } from "./errors.ts";
import type { ChatContext } from "./tui/app.ts";
import { runChat } from "./tui/app.ts";
import { VERSION } from "./version.ts";

const HELP = `vch ${VERSION} — BB in your terminal

Usage:
  vch                     Open the current directory's project (creates it if new)
  vch -g, --global        Global home: all projects
  vch <thread-id>         Open a specific thread (thr_...)
  vch new [flags] [prompt] Start a new thread
      --provider <id> --model <id> --mode <mode> --env <env>
  vch init [--yes] [--force] [--print]   Detect system-local BB, write editable config
  vch doctor              Diagnose config + BB reachability
  vch help | version

Configuration (~/.config/vch/config.json, overridable by env):
  VCH_SERVER_URL / BB_SERVER_URL, VCH_START_COMMAND, VCH_BB_COMMAND, VCH_AUTO_START
`;

async function runChatCommand(
  global: boolean,
  threadId: string | null,
  openWizard = false,
): Promise<number> {
  const config = await resolveConfig();
  const server = await ensureServer(config);
  const sdk = createSdk(server.serverUrl);

  // Opening a specific thread needs no project; otherwise resolve (auto-create) cwd's project.
  let project: ChatContext["project"] = null;
  if (!global && !threadId) {
    const resolved = await resolveProject(sdk, process.cwd());
    project = { id: resolved.id, name: resolved.name };
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
    openWizard,
  });
  return 0;
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
    case "chat":
      return runChatCommand(command.global, command.threadId);
    case "new":
      return runChatCommand(false, null, true);
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

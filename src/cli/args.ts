/** Parsed `vch` invocation. One variant per subcommand. */
export type Command =
  | {
      kind: "chat";
      global: boolean;
      threadId: string | null;
      /** `vch <provider> [model] [reasoning] [mode]` tokens (flags removed), else null. */
      spawnTokens: string[] | null;
    }
  | {
      kind: "new";
      provider: string | null;
      model: string | null;
      mode: string | null;
      reasoning: string | null;
      prompt: string | null;
      force: boolean;
    }
  | { kind: "init"; yes: boolean; force: boolean; print: boolean }
  | { kind: "providers" }
  | { kind: "threads" }
  | { kind: "doctor" }
  | { kind: "help" }
  | { kind: "version" };

function takeValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`Flag ${flag} requires a value.`);
  }
  return value;
}

/** BB thread ids look like `thr_...`. */
function isThreadId(token: string): boolean {
  return /^thr_[a-z0-9]+$/i.test(token);
}

/**
 * Parse argv (already stripped of the runtime + script, i.e. `Bun.argv.slice(2)`)
 * into a `Command`. Unknown leading tokens fall through to `chat` (a bare thread
 * id opens that thread), keeping the common path — `vch` — zero-friction.
 */
export function parseArgs(argv: string[]): Command {
  const [first, ...rest] = argv;

  if (first === undefined) {
    return { kind: "chat", global: false, threadId: null, spawnTokens: null };
  }
  if (first === "-h" || first === "--help" || first === "help") return { kind: "help" };
  if (first === "-v" || first === "--version" || first === "version") return { kind: "version" };
  if (first === "doctor") return { kind: "doctor" };
  if (first === "providers") return { kind: "providers" };
  if (first === "threads") return { kind: "threads" };

  if (first === "init") {
    return {
      kind: "init",
      yes: rest.includes("--yes") || rest.includes("-y"),
      force: rest.includes("--force"),
      print: rest.includes("--print"),
    };
  }

  if (first === "new") return parseNew(rest);

  // Default: chat — `-g/--global`, an optional thread-id positional, or a provider
  // shorthand (a bare first token that isn't a thread id or a known subcommand).
  const global = argv.includes("-g") || argv.includes("--global");
  const threadId = argv.find((token) => isThreadId(token)) ?? null;
  if (!first.startsWith("-") && !isThreadId(first)) {
    // `vch <provider> [model] [reasoning] [mode]`. Flags are filtered out so a
    // trailing `-g` never reaches option resolution; `global` still comes from argv.
    const spawnTokens = argv.filter((token) => !token.startsWith("-"));
    return { kind: "chat", global, threadId: null, spawnTokens };
  }
  return { kind: "chat", global, threadId, spawnTokens: null };
}

function parseNew(rest: string[]): Command {
  let provider: string | null = null;
  let model: string | null = null;
  let mode: string | null = null;
  let reasoning: string | null = null;
  let prompt: string | null = null;
  let force = false;

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === undefined) continue;
    switch (token) {
      case "--provider":
        provider = takeValue(rest, i, token);
        i++;
        break;
      case "--model":
        model = takeValue(rest, i, token);
        i++;
        break;
      case "--mode":
        mode = takeValue(rest, i, token);
        i++;
        break;
      case "--reasoning":
        reasoning = takeValue(rest, i, token);
        i++;
        break;
      case "--force":
      case "-f":
        force = true;
        break;
      default:
        if (!token.startsWith("-") && prompt === null) prompt = token;
        break;
    }
  }

  return { kind: "new", provider, model, mode, reasoning, prompt, force };
}

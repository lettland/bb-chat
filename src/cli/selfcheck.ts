/**
 * `bbchat selfcheck` — verify the rendering stack works in THIS build, offline.
 *
 * The reskinned transcript highlights markdown and code with tree-sitter grammars
 * that `bun build --compile` embeds into the binary. If a future dependency or
 * build change stopped embedding them, highlighting would silently disappear (or,
 * worse, OpenTUI could fall back to downloading grammars at runtime). This check
 * loads the bundled grammars with the network blocked and fails loudly if either
 * highlighting breaks or anything tries to fetch. CI and the release workflow run
 * it against the compiled binary.
 */

/** The slice of OpenTUI's tree-sitter client the check needs (injectable for tests). */
export interface Highlighter {
  initialize(): Promise<void>;
  highlightOnce(
    content: string,
    filetype: string,
  ): Promise<{ highlights?: unknown[]; warning?: string; error?: string }>;
  destroy(): Promise<void>;
}

export interface SelfcheckOptions {
  /** Supplies the highlighter; defaults to OpenTUI's bundled tree-sitter client. */
  loadHighlighter?: () => Promise<Highlighter>;
  /** Per-step timeout so a wedged parser worker can't hang CI. */
  timeoutMs?: number;
  /** Where the report goes (stdout by default). */
  write?: (line: string) => void;
}

interface Probe {
  filetype: string;
  content: string;
}

const PROBES: Probe[] = [
  {
    filetype: "typescript",
    content: "const x: number = 1;\nfunction f(n: number) { return n; }\n",
  },
  { filetype: "markdown", content: "# Title\n\nSome **bold** text.\n" },
];

const DEFAULT_TIMEOUT_MS = 20_000;

async function defaultHighlighter(): Promise<Highlighter> {
  const { getTreeSitterClient } = await import("@opentui/core");
  return getTreeSitterClient();
}

function withTimeout<T>(promise: Promise<T>, label: string, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Run the check; resolves to the process exit code (0 = passed). */
export async function runSelfcheck(options: SelfcheckOptions = {}): Promise<number> {
  const load = options.loadHighlighter ?? defaultHighlighter;
  const ms = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));

  // Fail closed: any network attempt during the check is itself a failure. (This
  // guards the main thread; OpenTUI's parser worker reads bundled grammars from
  // the embedded filesystem and does not fetch under Bun.) Everything after the
  // patch sits inside try/finally so fetch is always restored.
  const originalFetch = globalThis.fetch;
  const fetchAttempts: string[] = [];
  globalThis.fetch = ((input: unknown) => {
    fetchAttempts.push(String(input));
    return Promise.reject(new Error("network access is blocked during selfcheck"));
  }) as typeof fetch;

  let ok = true;
  let client: Highlighter | null = null;
  try {
    client = await load();
    await withTimeout(client.initialize(), "tree-sitter initialize", ms);
    for (const probe of PROBES) {
      const result = await withTimeout(
        client.highlightOnce(probe.content, probe.filetype),
        `highlight ${probe.filetype}`,
        ms,
      );
      const count = result.highlights?.length ?? 0;
      const detail = result.error ?? result.warning ?? "";
      write(
        `${count > 0 ? "ok  " : "FAIL"} ${probe.filetype}: ${count} highlights${detail ? ` (${detail})` : ""}`,
      );
      if (count === 0) ok = false;
    }
  } catch (error) {
    write(`FAIL tree-sitter: ${messageOf(error)}`);
    ok = false;
  } finally {
    globalThis.fetch = originalFetch;
    await client?.destroy().catch(() => {});
  }

  if (fetchAttempts.length > 0) {
    write(`FAIL network was attempted: ${fetchAttempts.join(", ")}`);
    ok = false;
  }
  write(ok ? "selfcheck passed" : "selfcheck failed");
  return ok ? 0 : 1;
}

import { ensureProject } from "../bb/project.ts";
import type { BBSdk } from "../bb/sdk.ts";
import { Navigator } from "./navigator.ts";
import { GlobalHomeView } from "./views/global-home-view.ts";
import { MessageView } from "./views/message-view.ts";
import { SpawnWizardView } from "./views/spawn-wizard-view.ts";
import { ThreadListView } from "./views/thread-list-view.ts";
import { ThreadView } from "./views/thread-view.ts";

/** Context handed to the TUI once the server + project are resolved. */
export interface ChatContext {
  sdk: BBSdk;
  serverUrl: string;
  /** `null` in global mode or when opening a thread by id. */
  project: { id: string; name: string } | null;
  global: boolean;
  /** When set, open this thread directly instead of a list. */
  initialThreadId: string | null;
  /**
   * When set, open the spawn wizard directly for this working directory. The
   * project is created lazily on submit (so `vch new` that opens and cancels the
   * wizard doesn't register a project).
   */
  newThreadCwd: string | null;
}

/**
 * Launch the interactive TUI: build the OpenTUI renderer, wire global key routing
 * into the navigator, and push the initial view (thread → thread list → global
 * home, depending on how `vch` was invoked). OpenTUI is imported lazily so the
 * native renderer only loads on the interactive path.
 */
export async function runChat(ctx: ChatContext): Promise<void> {
  const { createCliRenderer } = await import("@opentui/core");
  // exitOnCtrlC is off: OpenTUI's built-in handler calls destroy(), which hangs
  // here — we handle Ctrl-C ourselves via shutdown() below. useMouse enables
  // mouse-wheel scrolling in the transcript's ScrollBox.
  const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true });

  // Single, reliable termination path. Destroying the renderer restores the
  // terminal; process.exit then forces a clean quit — the realtime WebSocket and
  // OpenTUI runtime otherwise keep the event loop alive after destroy(), so
  // resolving a promise would not actually end the process.
  // Terminal restore sequences: leave alt-screen, show cursor, disable mouse +
  // bracketed paste, reset colors. Built from char codes so no literal control
  // chars sit in source. renderer.destroy()/suspend() can hang in some runtimes,
  // so we restore manually and force-exit instead of relying on them.
  const ESC = String.fromCharCode(0x1b);
  const RESTORE = `${ESC}[?1049l${ESC}[?25h${ESC}[?1000l${ESC}[?1002l${ESC}[?1003l${ESC}[?1006l${ESC}[?2004l${ESC}[?1l${ESC}>${ESC}[0m`;
  let exiting = false;
  const shutdown = (): void => {
    if (exiting) return;
    exiting = true;
    try {
      process.stdin.setRawMode?.(false);
    } catch {}
    try {
      process.stdout.write(RESTORE);
    } catch {}
    process.exit(0);
  };

  const navigator = new Navigator({ renderer, exit: shutdown });
  renderer.keyInput.on("keypress", (key) => {
    if (key.ctrl && key.name === "c") {
      shutdown();
      return;
    }
    navigator.handleKey(key);
  });
  renderer.once("destroy", () => process.exit(0)); // fallback if destroyed elsewhere

  if (ctx.initialThreadId) {
    await navigator.push(new ThreadView(ctx.sdk, ctx.initialThreadId, ctx.initialThreadId));
  } else if (ctx.newThreadCwd !== null) {
    const cwd = ctx.newThreadCwd;
    await navigator.push(new SpawnWizardView(ctx.sdk, () => ensureProject(ctx.sdk, cwd)));
  } else if (ctx.global) {
    await navigator.push(new GlobalHomeView(ctx.sdk));
  } else if (ctx.project) {
    await navigator.push(new ThreadListView(ctx.sdk, ctx.project));
  } else {
    await navigator.push(new MessageView("vch", ["No project in focus."]));
  }

  // Stay alive until a shutdown path calls process.exit (quit / Ctrl-C / last pop).
  await new Promise<void>(() => {});
}

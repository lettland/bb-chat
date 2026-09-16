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
  /** Open the spawn wizard on top of the project's thread list. */
  openWizard: boolean;
}

/**
 * Launch the interactive TUI: build the OpenTUI renderer, wire global key routing
 * into the navigator, and push the initial view (thread → thread list → global
 * home, depending on how `vch` was invoked). OpenTUI is imported lazily so the
 * native renderer only loads on the interactive path.
 */
export async function runChat(ctx: ChatContext): Promise<void> {
  const { createCliRenderer } = await import("@opentui/core");
  const renderer = await createCliRenderer({ exitOnCtrlC: true });

  let resolveDone: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  let exited = false;
  const exit = (): void => {
    if (exited) return;
    exited = true;
    renderer.destroy();
    resolveDone();
  };

  const navigator = new Navigator({ renderer, exit });
  renderer.keyInput.on("keypress", (key) => navigator.handleKey(key));
  renderer.once("destroy", () => resolveDone());

  if (ctx.initialThreadId) {
    await navigator.push(new ThreadView(ctx.sdk, ctx.initialThreadId, ctx.initialThreadId));
  } else if (ctx.global) {
    await navigator.push(new GlobalHomeView(ctx.sdk));
  } else if (ctx.project) {
    await navigator.push(new ThreadListView(ctx.sdk, ctx.project));
    if (ctx.openWizard) await navigator.push(new SpawnWizardView(ctx.sdk, ctx.project));
  } else {
    await navigator.push(new MessageView("vch", ["No project in focus."]));
  }

  await finished;
}

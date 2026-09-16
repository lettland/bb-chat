import type { BBSdk } from "../bb/sdk.ts";
import { VERSION } from "../version.ts";

/** Context handed to the TUI once the server + project are resolved. */
export interface ChatContext {
  sdk: BBSdk;
  serverUrl: string;
  /** `null` in global mode (`vch -g`), where no single project is in focus. */
  project: { id: string; name: string } | null;
  global: boolean;
}

/**
 * Launch the interactive TUI. This is the seam the full desktop-parity client
 * grows behind: a view stack (global home → project thread list → thread) plus a
 * command palette. For now it renders a status frame so the end-to-end path
 * (config → ensure-server → project → render) is wired and verifiable.
 *
 * OpenTUI is imported lazily so the native renderer is only loaded on the
 * interactive path — never during tests or non-TTY invocations.
 */
export async function runChat(ctx: ChatContext): Promise<void> {
  const { BoxRenderable, TextRenderable, createCliRenderer } = await import("@opentui/core");

  const renderer = await createCliRenderer({ exitOnCtrlC: true });

  const panel = new BoxRenderable(renderer, {
    flexDirection: "column",
    padding: 1,
    gap: 1,
  });

  const scope = ctx.global ? "global — all projects" : (ctx.project?.name ?? "no project");
  panel.add(new TextRenderable(renderer, { content: `vch ${VERSION}` }));
  panel.add(new TextRenderable(renderer, { content: `server   ${ctx.serverUrl}` }));
  panel.add(new TextRenderable(renderer, { content: `scope    ${scope}` }));
  panel.add(
    new TextRenderable(renderer, {
      content: "thread list & chat — wiring in progress. press q or ctrl-c to exit.",
    }),
  );
  renderer.root.add(panel);

  await new Promise<void>((resolveExit) => {
    const onKey = (key: { name?: string }) => {
      if (key.name === "q") {
        renderer.keyInput.off("keypress", onKey);
        renderer.destroy();
        resolveExit();
      }
    };
    renderer.keyInput.on("keypress", onKey);
    renderer.once("destroy", () => resolveExit());
  });
}

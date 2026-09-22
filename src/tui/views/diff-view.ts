import { BoxRenderable, fg, type KeyEvent, StyledText, TextRenderable } from "@opentui/core";
import { getDiffFiles } from "../../bb/environments.ts";
import type { BBSdk } from "../../bb/sdk.ts";
import { getThreadEnvironmentId } from "../../bb/threads.ts";
import { renderDiffFiles } from "../diff-render.ts";
import type { View, ViewHost } from "../navigator.ts";
import { sanitizeText } from "../sanitize.ts";
import { diffColor } from "../theme.ts";
import { errorText } from "../util.ts";

/** Most recent diff lines to keep rendered (until a scroll view lands). */
const DIFF_TAIL = 800;

/**
 * Review the changes an agent made in a thread's environment: the changed-files
 * summary plus the eagerly-loaded unified patches. Read-only for now (commit / PR
 * actions land in a later pass).
 */
export class DiffView implements View {
  readonly title = "diff";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private body: TextRenderable | null = null;

  constructor(
    private readonly sdk: BBSdk,
    private readonly threadId: string,
  ) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    const box = new BoxRenderable(host.renderer, { flexDirection: "column", padding: 1, gap: 1 });
    box.add(new TextRenderable(host.renderer, { content: "diff · uncommitted changes" }));
    this.body = new TextRenderable(host.renderer, { content: "loading diff…" });
    box.add(this.body);
    box.add(new TextRenderable(host.renderer, { content: "r refresh · q back" }));
    host.renderer.root.add(box);
    this.box = box;
    await this.refresh();
  }

  unmount(): void {
    if (this.box) {
      this.host.renderer.root.remove(this.box);
      this.box.destroy();
      this.box = null;
    }
    // Null the body too: an in-flight refresh guards on `this.body`, so clearing
    // it prevents a write to the now-destroyed renderable if the user leaves mid-fetch.
    this.body = null;
  }

  onKey(key: KeyEvent): void {
    if (key.name === "q" || key.name === "escape") {
      void this.host.navigator.pop();
    } else if (key.name === "r") {
      void this.refresh();
    }
  }

  private async refresh(): Promise<void> {
    if (!this.body) return;
    try {
      const environmentId = await getThreadEnvironmentId(this.sdk, this.threadId);
      if (!this.body) return; // left the view mid-fetch
      if (!environmentId) {
        this.body.content = "this thread has no environment to diff";
        return;
      }
      const response = await getDiffFiles(this.sdk, environmentId);
      if (!this.body) return; // left the view mid-fetch
      const lines = renderDiffFiles(response).slice(0, DIFF_TAIL);
      // renderDiffFiles never returns []; guard anyway so the pane can't blank out.
      this.body.content =
        lines.length > 0
          ? new StyledText(lines.map((l) => fg(diffColor(l.tone))(`${sanitizeText(l.text)}\n`)))
          : "no changes";
    } catch (error) {
      if (this.body) this.body.content = sanitizeText(`error loading diff: ${errorText(error)}`);
    }
  }
}

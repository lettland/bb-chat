import {
  type BoxRenderable,
  fg,
  type KeyEvent,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
} from "@opentui/core";
import { getDiffFiles } from "../../bb/environments.ts";
import type { BBSdk } from "../../bb/sdk.ts";
import { getThreadEnvironmentId } from "../../bb/threads.ts";
import { renderDiffFiles } from "../diff-render.ts";
import type { View, ViewHost } from "../navigator.ts";
import { sanitizeText } from "../sanitize.ts";
import { diffColor } from "../theme.ts";
import { errorText } from "../util.ts";
import { Screen } from "./chrome.ts";

/** Cap on diff lines rendered — bounds render cost on huge diffs (the pane scrolls). */
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
  private screen: Screen | null = null;
  private pane: ScrollBoxRenderable | null = null;
  private body: TextRenderable | null = null;

  constructor(
    private readonly sdk: BBSdk,
    private readonly threadId: string,
  ) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    const screen = new Screen(host.renderer, {
      title: "diff",
      subtitle: "uncommitted changes",
      hints: "↑/↓ pgup/pgdn scroll · r refresh · q back",
    });
    this.pane = new ScrollBoxRenderable(host.renderer, { flexGrow: 1 });
    this.body = new TextRenderable(host.renderer, { content: "loading diff…" });
    this.pane.add(this.body);
    screen.content.add(this.pane);
    this.screen = screen;
    this.box = screen.outer;
    host.renderer.root.add(screen.outer);
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
    this.pane = null;
    this.screen = null;
  }

  onKey(key: KeyEvent): void {
    const pane = this.pane;
    switch (key.name) {
      case "q":
      case "escape":
        void this.host.navigator.pop();
        return;
      case "r":
        void this.refresh();
        return;
      case "up":
      case "k":
        pane?.scrollBy(-1);
        return;
      case "down":
      case "j":
        pane?.scrollBy(1);
        return;
      case "pageup":
        pane?.scrollBy(-1, "viewport");
        return;
      case "pagedown":
      case "space":
        pane?.scrollBy(1, "viewport");
        return;
      case "home":
        pane?.scrollTo(0);
        return;
      case "end":
        if (pane) pane.scrollTo(pane.scrollHeight);
        return;
      default:
        return;
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
      const all = renderDiffFiles(response);
      // Count files over the full diff, before the render cap truncates it.
      const files = all.filter((l) => l.tone === "file").length;
      const lines = all.slice(0, DIFF_TAIL);
      this.screen?.setContext([`${files} file${files === 1 ? "" : "s"} changed`]);
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

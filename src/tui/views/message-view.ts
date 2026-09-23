import { type BoxRenderable, TextRenderable } from "@opentui/core";
import type { View, ViewHost } from "../navigator.ts";
import { toneColor } from "../theme.ts";
import { Screen } from "./chrome.ts";

/**
 * A simple static message screen (e.g. "No project in focus."). Pops on q/escape.
 */
export class MessageView implements View {
  private host!: ViewHost;
  private box: BoxRenderable | null = null;

  constructor(
    readonly title: string,
    private readonly lines: string[],
  ) {}

  mount(host: ViewHost): void {
    this.host = host;
    const screen = new Screen(host.renderer, {
      title: this.title,
      hints: "q or esc to go back",
      wordmark: true,
    });
    for (const line of this.lines) {
      screen.content.add(
        new TextRenderable(host.renderer, { content: line, fg: toneColor("assistant") }),
      );
    }
    host.renderer.root.add(screen.outer);
    this.box = screen.outer;
  }

  unmount(): void {
    if (this.box) {
      this.host.renderer.root.remove(this.box);
      this.box.destroy();
      this.box = null;
    }
  }

  onKey(key: { name?: string }): void {
    if (key.name === "q" || key.name === "escape") void this.host.navigator.pop();
  }
}

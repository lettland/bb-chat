import { BoxRenderable, TextRenderable } from "@opentui/core";
import type { View, ViewHost } from "../navigator.ts";

/**
 * A simple static message screen — used for surfaces not yet built as full views
 * (global home, the spawn wizard). Pops on q/escape.
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
    const box = new BoxRenderable(host.renderer, { flexDirection: "column", padding: 1, gap: 1 });
    box.add(new TextRenderable(host.renderer, { content: `vch — ${this.title}` }));
    for (const line of this.lines) {
      box.add(new TextRenderable(host.renderer, { content: line }));
    }
    box.add(new TextRenderable(host.renderer, { content: "press q or esc to go back" }));
    host.renderer.root.add(box);
    this.box = box;
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

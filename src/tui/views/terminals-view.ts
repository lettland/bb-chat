import { BoxRenderable, type KeyEvent, TextRenderable } from "@opentui/core";
import type { BBSdk } from "../../bb/sdk.ts";
import { getTerminalOutput, listThreadTerminals } from "../../bb/terminals.ts";
import type { View, ViewHost } from "../navigator.ts";
import { decodeTerminalOutput, type TerminalRow, toTerminalRows } from "../terminal-render.ts";
import { clamp, errorText } from "../util.ts";

/** Most recent output lines to keep rendered. */
const OUTPUT_TAIL = 400;

/**
 * A thread's terminals: the session list plus the selected terminal's recent
 * output (base64 chunks decoded, ANSI stripped). Read-only for now — interactive
 * input and a full ANSI pane land in a later pass.
 */
export class TerminalsView implements View {
  readonly title = "terminals";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private list: TextRenderable | null = null;
  private output: TextRenderable | null = null;
  private rows: TerminalRow[] = [];
  private selected = 0;

  constructor(
    private readonly sdk: BBSdk,
    private readonly threadId: string,
  ) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    const box = new BoxRenderable(host.renderer, { flexDirection: "column", padding: 1, gap: 1 });
    box.add(new TextRenderable(host.renderer, { content: "terminals" }));
    this.list = new TextRenderable(host.renderer, { content: "loading…" });
    this.output = new TextRenderable(host.renderer, { content: "" });
    box.add(this.list);
    box.add(this.output);
    box.add(new TextRenderable(host.renderer, { content: "↑/↓ select · r refresh · q back" }));
    host.renderer.root.add(box);
    this.box = box;
    await this.refreshList();
  }

  unmount(): void {
    if (this.box) {
      this.host.renderer.root.remove(this.box);
      this.box.destroy();
      this.box = null;
    }
  }

  onKey(key: KeyEvent): void {
    switch (key.name) {
      case "up":
      case "k":
        this.move(-1);
        break;
      case "down":
      case "j":
        this.move(1);
        break;
      case "r":
        void this.refreshList();
        break;
      case "q":
      case "escape":
        void this.host.navigator.pop();
        break;
      default:
        break;
    }
  }

  private move(delta: number): void {
    if (this.rows.length === 0) return;
    const next = clamp(this.selected + delta, 0, this.rows.length - 1);
    if (next === this.selected) return;
    this.selected = next;
    this.renderList();
    void this.refreshOutput();
  }

  private async refreshList(): Promise<void> {
    if (!this.list) return;
    try {
      this.rows = toTerminalRows(await listThreadTerminals(this.sdk, this.threadId));
      this.selected = clamp(this.selected, 0, Math.max(0, this.rows.length - 1));
      this.renderList();
      await this.refreshOutput();
    } catch (error) {
      this.list.content = `error loading terminals: ${errorText(error)}`;
    }
  }

  private async refreshOutput(): Promise<void> {
    if (!this.output) return;
    const row = this.rows[this.selected];
    if (!row) {
      this.output.content = "";
      return;
    }
    try {
      const text = decodeTerminalOutput(await getTerminalOutput(this.sdk, row.id));
      const lines = text.length > 0 ? text.split("\n") : [];
      this.output.content = lines.length > 0 ? lines.slice(-OUTPUT_TAIL).join("\n") : "(no output)";
    } catch (error) {
      this.output.content = `error loading output: ${errorText(error)}`;
    }
  }

  private renderList(): void {
    if (!this.list) return;
    this.list.content =
      this.rows.length === 0
        ? "no terminals for this thread"
        : this.rows
            .map((row, i) => `${i === this.selected ? ">" : " "} ${row.title}  [${row.status}]`)
            .join("\n");
  }
}

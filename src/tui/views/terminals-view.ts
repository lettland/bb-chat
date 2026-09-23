import {
  type BoxRenderable,
  type KeyEvent,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import type { BBSdk } from "../../bb/sdk.ts";
import { getTerminalOutput, listThreadTerminals } from "../../bb/terminals.ts";
import type { View, ViewHost } from "../navigator.ts";
import { decodeTerminalOutput, type TerminalRow, toTerminalRows } from "../terminal-render.ts";
import { palette, toneColor } from "../theme.ts";
import { errorText } from "../util.ts";
import { ListPanel, Screen } from "./chrome.ts";

/** Most recent output lines to keep rendered. */
const OUTPUT_TAIL = 400;
/** Rows the session list may take before it scrolls. */
const LIST_MAX_ROWS = 6;

/**
 * A thread's terminals: the session list plus the selected terminal's recent
 * output (base64 chunks decoded, escapes stripped) in a scrollable pane that
 * follows the tail. Read-only for now — interactive input and a full ANSI pane
 * land in a later pass.
 */
export class TerminalsView implements View {
  readonly title = "terminals";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private screen: Screen | null = null;
  private panel: ListPanel | null = null;
  private output: TextRenderable | null = null;
  private rows: TerminalRow[] = [];
  private selected = 0;

  constructor(
    private readonly sdk: BBSdk,
    private readonly threadId: string,
  ) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    const p = palette();
    const screen = new Screen(host.renderer, {
      title: "terminals",
      hints: "↑/↓ select · r refresh · q back",
    });
    this.panel = new ListPanel(host.renderer, { flexGrow: 0, height: 1 });
    screen.content.add(this.panel.root);

    const pane = new ScrollBoxRenderable(host.renderer, {
      flexGrow: 1,
      marginTop: 1,
      border: ["top"],
      borderColor: p.border.default,
      stickyScroll: true,
      stickyStart: "bottom",
    });
    this.output = new TextRenderable(host.renderer, { content: "", fg: toneColor("output") });
    pane.add(this.output);
    screen.content.add(pane);

    this.screen = screen;
    this.box = screen.outer;
    host.renderer.root.add(screen.outer);
    await this.refreshList();
  }

  unmount(): void {
    if (this.box) {
      this.host.renderer.root.remove(this.box);
      this.box.destroy();
      this.box = null;
    }
    this.screen = null;
    this.panel = null;
    this.output = null;
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
    if (!this.panel || this.rows.length === 0) return;
    const next = this.panel.select(this.selected + delta);
    if (next === this.selected) return;
    this.selected = next;
    void this.refreshOutput();
  }

  private async refreshList(): Promise<void> {
    if (!this.panel) return;
    try {
      const rows = toTerminalRows(await listThreadTerminals(this.sdk, this.threadId));
      if (!this.panel) return; // left the view mid-fetch
      this.rows = rows;
      this.panel.root.height = Math.max(1, Math.min(rows.length, LIST_MAX_ROWS));
      this.selected = this.panel.setItems(
        rows.map((row) => `${row.title}  [${row.status}]`),
        "no terminals for this thread",
        this.selected,
      );
      this.screen?.setContext([`${rows.length} terminal${rows.length === 1 ? "" : "s"}`]);
      await this.refreshOutput();
    } catch (error) {
      if (!this.panel) return;
      this.panel.root.height = 1; // a one-line error, not a stale taller box
      this.panel.showMessage(`error loading terminals: ${errorText(error)}`, "error");
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
      if (!this.output) return; // left the view mid-fetch
      const lines = text.length > 0 ? text.split("\n") : [];
      this.output.content = lines.length > 0 ? lines.slice(-OUTPUT_TAIL).join("\n") : "(no output)";
    } catch (error) {
      this.screen?.setStatus(`error loading output: ${errorText(error)}`, "error");
    }
  }
}

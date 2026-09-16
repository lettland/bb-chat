import { BoxRenderable, fg, type KeyEvent, StyledText, TextRenderable } from "@opentui/core";
import type { BBSdk } from "../../bb/sdk.ts";
import { getTimelineRows, sendText, type Unsubscribe, watchThread } from "../../bb/threads.ts";
import { InputBuffer } from "../input-buffer.ts";
import type { View, ViewHost } from "../navigator.ts";
import { type DisplayLine, renderTimelineRows, toneColor } from "../timeline-render.ts";
import { errorText, scrollWindow, wrapText } from "../util.ts";
import { DiffView } from "./diff-view.ts";
import { TerminalsView } from "./terminals-view.ts";

const HEADER_FG = "#6A737D";
const COMPOSER_BORDER = "#4EC9B0";
const ROWS_OVERHEAD = 8; // header + status + bordered composer + margins
const COLS_OVERHEAD = 4; // transcript padding + margins

/**
 * A single thread: a colored, per-role transcript above a bordered composer.
 * User / assistant / tool activity are distinguished by color (see toneColor),
 * with blank lines between turns. The transcript scrolls (PgUp/PgDn, ↑/↓, Home/
 * End) through the full history and follows the latest when at the bottom; the
 * composer is always pinned and framed so the input is obvious.
 */
export class ThreadView implements View {
  readonly title = "thread";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private transcript: TextRenderable | null = null;
  private status: TextRenderable | null = null;
  private composer: TextRenderable | null = null;
  private readonly input = new InputBuffer();
  private unsub: Unsubscribe | null = null;
  private sending = false;
  /** All rendered timeline lines (pre-wrap); the source for windowed scrolling. */
  private lines: DisplayLine[] = [];
  /** Lines scrolled up from the bottom (0 = following the latest). */
  private scrollOffset = 0;
  private viewHeight = 20;
  /** In-flight guard: one full pagination at a time; bursts coalesce into one re-run. */
  private refreshing = false;
  private refreshQueued = false;

  constructor(
    private readonly sdk: BBSdk,
    private readonly threadId: string,
    private readonly threadTitle: string,
  ) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    const outer = new BoxRenderable(host.renderer, { flexDirection: "column", height: "100%" });

    outer.add(
      new TextRenderable(host.renderer, {
        content: ` ${this.threadTitle}   ctrl+o diff · ctrl+t terminals · esc back`,
        fg: HEADER_FG,
      }),
    );

    this.transcript = new TextRenderable(host.renderer, {
      content: "",
      flexGrow: 1,
      paddingLeft: 1,
      paddingRight: 1,
    });
    outer.add(this.transcript);

    this.status = new TextRenderable(host.renderer, { content: "", fg: "#E5C07B" });
    outer.add(this.status);

    const composerBox = new BoxRenderable(host.renderer, {
      border: true,
      borderStyle: "rounded",
      borderColor: COMPOSER_BORDER,
      title: "message",
      titleAlignment: "left",
      height: 3,
      flexShrink: 0,
    });
    this.composer = new TextRenderable(host.renderer, { content: "" });
    composerBox.add(this.composer);
    outer.add(composerBox);

    host.renderer.root.add(outer);
    this.box = outer;
    this.renderComposer();

    await this.refresh();
    this.unsub = watchThread(this.sdk, this.threadId, () => {
      void this.refresh();
    });
  }

  unmount(): void {
    this.unsub?.();
    this.unsub = null;
    if (this.box) {
      this.host.renderer.root.remove(this.box);
      this.box.destroy();
      this.box = null;
    }
  }

  onKey(key: KeyEvent): void {
    if (key.name === "escape") {
      void this.host.navigator.pop();
      return;
    }
    if (key.ctrl && key.name === "o") {
      void this.host.navigator.push(new DiffView(this.sdk, this.threadId));
      return;
    }
    if (key.ctrl && key.name === "t") {
      void this.host.navigator.push(new TerminalsView(this.sdk, this.threadId));
      return;
    }
    switch (key.name) {
      case "pageup":
        this.scroll(this.viewHeight - 1);
        return;
      case "pagedown":
        this.scroll(-(this.viewHeight - 1));
        return;
      case "up":
        this.scroll(1);
        return;
      case "down":
        this.scroll(-1);
        return;
      case "home":
        this.scrollOffset = Number.MAX_SAFE_INTEGER;
        this.render();
        return;
      case "end":
        this.scrollOffset = 0;
        this.render();
        return;
      default:
        break;
    }
    const action = this.input.handle(key);
    if (action.type === "submit") {
      void this.submit(action.value);
      this.renderComposer();
    } else if (action.type === "update") {
      this.renderComposer();
    }
  }

  private renderComposer(): void {
    if (this.composer) this.composer.content = `❯ ${this.input.value}`;
  }

  private async submit(text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.length === 0 || this.sending) return;
    this.sending = true;
    this.scrollOffset = 0; // jump to latest so the sent message + reply are visible
    if (this.status) this.status.content = "sending…";
    try {
      await sendText(this.sdk, this.threadId, trimmed);
      if (this.status) this.status.content = "";
      await this.refresh();
    } catch (error) {
      if (this.status) this.status.content = `send failed: ${errorText(error)}`;
    } finally {
      this.sending = false;
    }
  }

  /**
   * Reload the full timeline. Only one pagination runs at a time; realtime events
   * arriving mid-fetch set a single "queued" flag and trigger exactly one re-run
   * afterward — so fetches never overlap (no stale-fetch overwrite) and event
   * bursts don't amplify into many paginations.
   */
  private async refresh(): Promise<void> {
    if (!this.transcript) return;
    if (this.refreshing) {
      this.refreshQueued = true;
      return;
    }
    this.refreshing = true;
    try {
      const lines = renderTimelineRows(await getTimelineRows(this.sdk, this.threadId));
      this.lines = lines.length > 0 ? lines : [{ text: "(no messages yet)", tone: "meta" }];
    } catch (error) {
      this.lines = [{ text: `error loading timeline: ${errorText(error)}`, tone: "attention" }];
    } finally {
      this.refreshing = false;
    }
    this.render();
    if (this.refreshQueued && this.box) {
      this.refreshQueued = false;
      void this.refresh();
    }
  }

  private scroll(delta: number): void {
    this.scrollOffset = Math.max(0, this.scrollOffset + delta);
    this.render();
  }

  /**
   * Render the transcript into the viewport: word-wrap every line to the terminal
   * width up front (so the renderer never re-wraps and overlaps rows), then window
   * by scrollOffset (0 = latest) for scrollback, colored per role. A status line
   * shows how much history is hidden above.
   */
  private render(): void {
    const target = this.transcript;
    if (!target) return;
    const cols = Math.max(20, (process.stdout.columns ?? 100) - COLS_OVERHEAD);
    this.viewHeight = Math.max(5, (process.stdout.rows ?? 40) - ROWS_OVERHEAD);

    const wrapped: DisplayLine[] = [];
    for (const line of this.lines) {
      for (const piece of wrapText(line.text, cols)) wrapped.push({ text: piece, tone: line.tone });
    }
    const win = scrollWindow(wrapped, this.viewHeight, this.scrollOffset);
    this.scrollOffset = win.offset;
    target.content = new StyledText(
      win.shown.map((line) =>
        fg(toneColor(line.tone))(`${line.text.length > 0 ? line.text : " "}\n`),
      ),
    );
    if (this.status) {
      this.status.content =
        win.above > 0 ? `↑ ${win.above} more · PgUp/PgDn ↑/↓ scroll · End latest` : "";
    }
  }
}

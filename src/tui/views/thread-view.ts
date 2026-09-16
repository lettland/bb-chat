import { BoxRenderable, type KeyEvent, TextRenderable } from "@opentui/core";
import type { BBSdk } from "../../bb/sdk.ts";
import { getTimelineRows, sendText, type Unsubscribe, watchThread } from "../../bb/threads.ts";
import { InputBuffer } from "../input-buffer.ts";
import type { View, ViewHost } from "../navigator.ts";
import { type DisplayLine, renderTimelineRows, toneColor } from "../timeline-render.ts";
import { errorText } from "../util.ts";
import { DiffView } from "./diff-view.ts";
import { TerminalsView } from "./terminals-view.ts";

const HEADER_FG = "#6A737D";
const COMPOSER_BORDER = "#4EC9B0";
const ROWS_OVERHEAD = 8; // header + status + bordered composer + margins

/**
 * A single thread: a colored, per-role transcript above a bordered composer.
 * User / assistant / tool activity are distinguished by color (see toneColor),
 * with blank lines between turns. The transcript shows the most recent lines that
 * fit; the composer is always pinned and framed so the input is obvious.
 */
export class ThreadView implements View {
  readonly title = "thread";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private transcript: BoxRenderable | null = null;
  private status: TextRenderable | null = null;
  private composer: TextRenderable | null = null;
  private readonly input = new InputBuffer();
  private unsub: Unsubscribe | null = null;
  private sending = false;

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

    this.transcript = new BoxRenderable(host.renderer, {
      flexDirection: "column",
      flexGrow: 1,
      overflow: "hidden",
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

  private async refresh(): Promise<void> {
    if (!this.transcript) return;
    try {
      const lines = renderTimelineRows(await getTimelineRows(this.sdk, this.threadId));
      this.setTranscript(lines.length > 0 ? lines : [{ text: "(no messages yet)", tone: "meta" }]);
    } catch (error) {
      this.setTranscript([
        { text: `error loading timeline: ${errorText(error)}`, tone: "attention" },
      ]);
    }
  }

  /** Rebuild the transcript with one colored line per row, showing the latest that fit. */
  private setTranscript(lines: DisplayLine[]): void {
    const box = this.transcript;
    if (!box) return;
    for (const child of [...box.getChildren()]) {
      box.remove(child);
      child.destroy();
    }
    const cap = Math.max(5, (process.stdout.rows ?? 40) - ROWS_OVERHEAD);
    for (const line of lines.slice(-cap)) {
      box.add(
        new TextRenderable(this.host.renderer, {
          content: line.text.length > 0 ? line.text : " ",
          fg: toneColor(line.tone),
        }),
      );
    }
  }
}

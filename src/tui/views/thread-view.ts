import { BoxRenderable, type KeyEvent, TextRenderable } from "@opentui/core";
import type { BBSdk } from "../../bb/sdk.ts";
import { getTimelineRows, sendText, type Unsubscribe, watchThread } from "../../bb/threads.ts";
import { InputBuffer } from "../input-buffer.ts";
import type { View, ViewHost } from "../navigator.ts";
import { renderTimelineText } from "../timeline-render.ts";
import { errorText } from "../util.ts";
import { DiffView } from "./diff-view.ts";

/** Most recent transcript lines to keep rendered (until a scroll view lands). */
const TRANSCRIPT_TAIL = 500;

/**
 * A single thread: live streaming transcript plus a composer. The timeline is
 * fetched on mount and re-fetched whenever BB reports the thread changed
 * (realtime `thread:changed`). Typing composes a message; Enter sends it.
 */
export class ThreadView implements View {
  readonly title = "thread";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private header: TextRenderable | null = null;
  private transcript: TextRenderable | null = null;
  private composer: TextRenderable | null = null;
  private status: TextRenderable | null = null;
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
    const box = new BoxRenderable(host.renderer, { flexDirection: "column", padding: 1, gap: 1 });
    this.header = new TextRenderable(host.renderer, { content: this.headerText() });
    this.transcript = new TextRenderable(host.renderer, { content: "loading…" });
    this.status = new TextRenderable(host.renderer, { content: "" });
    this.composer = new TextRenderable(host.renderer, { content: this.composerText() });
    box.add(this.header);
    box.add(this.transcript);
    box.add(this.status);
    box.add(this.composer);
    host.renderer.root.add(box);
    this.box = box;

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
    const action = this.input.handle(key);
    if (action.type === "submit") {
      void this.submit(action.value);
      this.renderComposer();
    } else if (action.type === "update") {
      this.renderComposer();
    }
  }

  private headerText(): string {
    return `${this.threadTitle}  ·  ${this.threadId}  ·  ctrl+o diff · esc back`;
  }

  private composerText(): string {
    return `> ${this.input.value}`;
  }

  private renderComposer(): void {
    if (this.composer) this.composer.content = this.composerText();
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
      const rows = await getTimelineRows(this.sdk, this.threadId);
      const text = renderTimelineText(rows);
      const lines = text.length > 0 ? text.split("\n") : [];
      this.transcript.content =
        lines.length > 0 ? lines.slice(-TRANSCRIPT_TAIL).join("\n") : "(no messages yet)";
    } catch (error) {
      this.transcript.content = `error loading timeline: ${errorText(error)}`;
    }
  }
}

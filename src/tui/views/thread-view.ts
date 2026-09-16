import {
  BoxRenderable,
  fg,
  type KeyEvent,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
} from "@opentui/core";
import type { BBSdk } from "../../bb/sdk.ts";
import { getTimelineRows, sendText, type Unsubscribe, watchThread } from "../../bb/threads.ts";
import { InputBuffer } from "../input-buffer.ts";
import type { View, ViewHost } from "../navigator.ts";
import { renderTimelineRows, toneColor } from "../timeline-render.ts";
import { errorText, parseSlashCommand } from "../util.ts";
import { DiffView } from "./diff-view.ts";
import { TerminalsView } from "./terminals-view.ts";

const HEADER_FG = "#6A737D";
const COMPOSER_BORDER = "#4EC9B0";

/**
 * A single thread: a colored, per-role transcript in a scrollable region above a
 * bordered composer. The transcript is a real ScrollBox — it holds the FULL
 * thread, follows the latest (sticky bottom), and scrolls by mouse wheel, the
 * scrollbar, and PgUp/PgDn/↑/↓/Home/End. Each message gets a "▌ you" / "▌
 * assistant" gutter header colored by role (toneColor); tool activity is indented
 * under it; a horizontal rule separates successive exchanges.
 */
export class ThreadView implements View {
  /** Composer inputs intercepted as commands; everything else (incl. "/paths") sends. */
  private static readonly COMMANDS = new Set([
    "exit",
    "quit",
    "q",
    "back",
    "diff",
    "terminals",
    "term",
    "help",
  ]);
  readonly title = "thread";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private scrollbox: ScrollBoxRenderable | null = null;
  private body: TextRenderable | null = null;
  private status: TextRenderable | null = null;
  private composer: TextRenderable | null = null;
  private readonly input = new InputBuffer();
  private unsub: Unsubscribe | null = null;
  private sending = false;
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
        content: ` ${this.threadTitle}   /help · esc back · ctrl+c quit`,
        fg: HEADER_FG,
      }),
    );

    this.scrollbox = new ScrollBoxRenderable(host.renderer, {
      flexGrow: 1,
      stickyScroll: true,
      stickyStart: "bottom",
      contentOptions: { flexDirection: "column", paddingLeft: 1, paddingRight: 1 },
    });
    this.body = new TextRenderable(host.renderer, { content: "" });
    this.scrollbox.add(this.body);
    outer.add(this.scrollbox);

    this.status = new TextRenderable(host.renderer, { content: "", fg: "#E5C07B" });
    outer.add(this.status);

    const composerBox = new BoxRenderable(host.renderer, {
      border: true,
      borderStyle: "rounded",
      borderColor: COMPOSER_BORDER,
      title: "message · /help",
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
    if (this.handleScrollKey(key)) return;

    const action = this.input.handle(key);
    if (action.type === "submit") {
      void this.submit(action.value);
      this.renderComposer();
    } else if (action.type === "update") {
      this.renderComposer();
    }
  }

  /** Route navigation keys to the ScrollBox; returns true if the key scrolled. */
  private handleScrollKey(key: KeyEvent): boolean {
    const scroll = this.scrollbox;
    if (!scroll) return false;
    switch (key.name) {
      case "pageup":
        scroll.scrollBy(-1, "viewport");
        return true;
      case "pagedown":
        scroll.scrollBy(1, "viewport");
        return true;
      case "up":
        scroll.scrollBy(-1);
        return true;
      case "down":
        scroll.scrollBy(1);
        return true;
      case "home":
        scroll.scrollTo(0);
        return true;
      case "end":
        scroll.scrollTo(scroll.scrollHeight);
        return true;
      default:
        return false;
    }
  }

  private runCommand(name: string): void {
    switch (name) {
      case "exit":
      case "quit":
      case "q":
        this.host.exit();
        return;
      case "back":
        void this.host.navigator.pop();
        return;
      case "diff":
        void this.host.navigator.push(new DiffView(this.sdk, this.threadId));
        return;
      case "terminals":
      case "term":
        void this.host.navigator.push(new TerminalsView(this.sdk, this.threadId));
        return;
      default: // "help" and anything else routed here
        if (this.status) {
          this.status.content =
            "commands: /exit /back /diff /terminals · keys: esc back · ctrl+c quit · PgUp/PgDn/Home/End or mouse wheel to scroll";
        }
        return;
    }
  }

  private renderComposer(): void {
    if (this.composer) this.composer.content = `❯ ${this.input.value}`;
  }

  private async submit(text: string): Promise<void> {
    // Only KNOWN commands are intercepted; other leading-slash input (e.g. an
    // absolute path) is sent as a normal message.
    const command = parseSlashCommand(text);
    if (command && ThreadView.COMMANDS.has(command.name)) {
      this.runCommand(command.name);
      return;
    }
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

  /**
   * Reload the full timeline. One pagination runs at a time; realtime events
   * arriving mid-fetch set a single "queued" flag and trigger exactly one re-run
   * afterward, so fetches never overlap and bursts don't amplify.
   */
  private async refresh(): Promise<void> {
    if (!this.body) return;
    if (this.refreshing) {
      this.refreshQueued = true;
      return;
    }
    this.refreshing = true;
    try {
      // Rules span the transcript width: terminal columns minus the ScrollBox's
      // left/right padding and scrollbar gutter.
      const ruleWidth = Math.max(8, (process.stdout.columns ?? 80) - 4);
      const lines = renderTimelineRows(await getTimelineRows(this.sdk, this.threadId), {
        ruleWidth,
      });
      this.body.content = new StyledText(
        (lines.length > 0 ? lines : [{ text: "(no messages yet)", tone: "meta" as const }]).map(
          (line) => fg(toneColor(line.tone))(`${line.text.length > 0 ? line.text : " "}\n`),
        ),
      );
    } catch (error) {
      this.body.content = new StyledText([
        fg(toneColor("attention"))(`error loading timeline: ${errorText(error)}\n`),
      ]);
    } finally {
      this.refreshing = false;
    }
    if (this.refreshQueued && this.box) {
      this.refreshQueued = false;
      void this.refresh();
    }
  }
}

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
import { renderTranscript, toneColor } from "../timeline-render.ts";
import { ToolSelection } from "../tool-selection.ts";
import { helpLegend, styledTranscript } from "../transcript-style.ts";
import { errorText, parseSlashCommand } from "../util.ts";
import { DiffView } from "./diff-view.ts";
import { TerminalsView } from "./terminals-view.ts";

const HEADER_FG = "#6A737D";
const COMPOSER_BORDER = "#4EC9B0";

interface ThreadLayout {
  outer: BoxRenderable;
  scrollbox: ScrollBoxRenderable;
  body: TextRenderable;
  status: TextRenderable;
  composer: TextRenderable;
}

/** Build the thread view's renderable tree: header, scrollable transcript, status, composer. */
function buildThreadLayout(renderer: ViewHost["renderer"], title: string): ThreadLayout {
  const outer = new BoxRenderable(renderer, { flexDirection: "column", height: "100%" });
  outer.add(
    new TextRenderable(renderer, {
      content: ` ${title}   /help · tab+ctrl+e expand · esc back · ctrl+c quit`,
      fg: HEADER_FG,
    }),
  );

  const scrollbox = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    stickyScroll: true,
    stickyStart: "bottom",
    contentOptions: { flexDirection: "column", paddingLeft: 1, paddingRight: 1 },
  });
  const body = new TextRenderable(renderer, { content: "" });
  scrollbox.add(body);
  outer.add(scrollbox);

  const status = new TextRenderable(renderer, { content: "", fg: "#E5C07B" });
  outer.add(status);

  const composerBox = new BoxRenderable(renderer, {
    border: true,
    borderStyle: "rounded",
    borderColor: COMPOSER_BORDER,
    title: "message · /help",
    titleAlignment: "left",
    height: 3,
    flexShrink: 0,
  });
  const composer = new TextRenderable(renderer, { content: "" });
  composerBox.add(composer);
  outer.add(composerBox);

  return { outer, scrollbox, body, status, composer };
}

/**
 * A single thread: a colored, per-role transcript in a scrollable region above a
 * bordered composer. The transcript is a real ScrollBox — it holds the FULL
 * thread, follows the latest (sticky bottom), and scrolls by mouse wheel, the
 * scrollbar, and PgUp/PgDn/↑/↓/Home/End. Each message gets a "▌ you" / "▌
 * assistant" gutter header; tool calls, edits, subagents, questions, and errors
 * are colored distinctly (toneColor) and indented under the assistant; a rule
 * separates exchanges. Tool output is a one-line preview by default — Tab/Shift+Tab
 * move a selection cursor across tool calls and Ctrl+E expands the selected one.
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
  /** Tool-output selection/expansion state (cursor + expanded rows). */
  private readonly tools = new ToolSelection();
  private totalLines = 0;

  constructor(
    private readonly sdk: BBSdk,
    private readonly threadId: string,
    private readonly threadTitle: string,
  ) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    const layout = buildThreadLayout(host.renderer, this.threadTitle);
    this.box = layout.outer;
    this.scrollbox = layout.scrollbox;
    this.body = layout.body;
    this.status = layout.status;
    this.composer = layout.composer;
    host.renderer.root.add(layout.outer);
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
    if (this.handleShortcut(key)) return;
    if (this.handleScrollKey(key)) return;

    const action = this.input.handle(key);
    if (action.type === "submit") {
      void this.submit(action.value);
      this.renderComposer();
    } else if (action.type === "update") {
      this.renderComposer();
    }
  }

  /**
   * Navigation and tool-output shortcuts; returns true if the key was consumed.
   * Tab/Shift+Tab move the selection cursor across tool calls, Ctrl+E expands the
   * selected one. These keys aren't printable, so the composer never sees them.
   */
  private handleShortcut(key: KeyEvent): boolean {
    if (key.name === "escape") {
      void this.host.navigator.pop();
    } else if (key.ctrl && key.name === "o") {
      void this.host.navigator.push(new DiffView(this.sdk, this.threadId));
    } else if (key.ctrl && key.name === "t") {
      void this.host.navigator.push(new TerminalsView(this.sdk, this.threadId));
    } else if (key.name === "tab") {
      this.tools.move(key.shift ? -1 : 1);
      void this.refresh();
    } else if (key.ctrl && key.name === "e") {
      this.toggleSelectedTool();
    } else {
      return false;
    }
    return true;
  }

  /** Expand/collapse the selected tool, or hint how to select one. */
  private toggleSelectedTool(): void {
    if (this.tools.toggle()) void this.refresh();
    else if (this.status) this.status.content = "select a tool with Tab, then Ctrl+E to expand";
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

  /** Best-effort: scroll so the selected tool's call line is in view. */
  private scrollToSelected(): void {
    const scroll = this.scrollbox;
    const line = this.tools.selectedLine();
    if (!scroll || line === null || this.totalLines <= 1) return;
    // Lines wrap, so map the logical line to a scroll offset proportionally.
    const ratio = line / (this.totalLines - 1);
    scroll.scrollTo(Math.max(0, Math.round(ratio * scroll.scrollHeight)));
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
        this.showHelp();
        return;
    }
  }

  private renderComposer(): void {
    if (this.composer) this.composer.content = `❯ ${this.input.value}`;
  }

  /** Show the colored tone legend + expand keys in the status line. */
  private showHelp(): void {
    if (this.status) this.status.content = helpLegend();
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
      const rows = await getTimelineRows(this.sdk, this.threadId);
      const transcript = renderTranscript(rows, {
        ruleWidth,
        expanded: this.tools.expanded,
        selectedId: this.tools.selected,
      });
      this.totalLines = transcript.lines.length;
      this.tools.sync(transcript.anchors);
      this.body.content = styledTranscript(transcript.lines);
      if (this.tools.selected) this.scrollToSelected();
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

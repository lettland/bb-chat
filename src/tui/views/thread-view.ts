import { BoxRenderable, type KeyEvent, ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import type { BBSdk } from "../../bb/sdk.ts";
import {
  getThreadMeta,
  getTimelineRows,
  sendText,
  type ThreadMeta,
  type Unsubscribe,
  watchThread,
} from "../../bb/threads.ts";
import { InputBuffer } from "../input-buffer.ts";
import type { View, ViewHost } from "../navigator.ts";
import { palette, toneColor } from "../theme.ts";
import { type Block, buildBlocks, isTimelineActive, selectableIds } from "../timeline-model.ts";
import { ToolSelection } from "../tool-selection.ts";
import { helpLegend } from "../transcript-style.ts";
import { errorText, parseSlashCommand } from "../util.ts";
import { type BlockOpts, type MountedBlock, reconcileBlocks } from "./blocks.ts";
import { Screen } from "./chrome.ts";
import { DiffView } from "./diff-view.ts";
import { TerminalsView } from "./terminals-view.ts";

/** Cap on output/patch lines shown when a row is expanded. */
const MAX_OUTPUT_LINES = 200;
/** Hints, most important first (narrow terminals drop from the end). */
function hints(isRoot: boolean): string {
  return `tab select · ctrl+e expand · ${isRoot ? "esc quit" : "esc back"} · /help · ctrl+o diff · ctrl+t terms · ctrl+c quit`;
}

interface ThreadLayout {
  screen: Screen;
  scrollbox: ScrollBoxRenderable;
  /** The column that holds one renderable per timeline block. */
  listBox: BoxRenderable;
  composer: TextRenderable;
}

/** Build the thread view: themed header, scrollable transcript, composer, status bar. */
function buildThreadLayout(
  renderer: ViewHost["renderer"],
  title: string,
  isRoot: boolean,
): ThreadLayout {
  const p = palette();
  const screen = new Screen(renderer, { title, hints: hints(isRoot) });
  screen.setContext(["loading…"]);

  const scrollbox = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    stickyScroll: true,
    stickyStart: "bottom",
    contentOptions: { flexDirection: "column" },
  });
  const listBox = new BoxRenderable(renderer, { flexDirection: "column" });
  scrollbox.add(listBox);
  screen.content.add(scrollbox);

  const composerBox = new BoxRenderable(renderer, {
    border: true,
    borderStyle: "rounded",
    borderColor: p.border.focus,
    title: " message ",
    titleColor: toneColor("system"),
    titleAlignment: "left",
    bottomTitle: " enter send · /help ",
    bottomTitleAlignment: "right",
    height: 3,
    flexShrink: 0,
  });
  const composer = new TextRenderable(renderer, { content: "" });
  composerBox.add(composer);
  screen.content.add(composerBox);

  return { screen, scrollbox, listBox, composer };
}

/** Status-bar context for a thread, most important first. */
function threadContext(meta: ThreadMeta | null): string[] {
  if (!meta) return [];
  return [meta.providerId ?? "", meta.model ?? "", meta.status ?? ""];
}

/**
 * A single thread: a per-role transcript in a scrollable region above a bordered
 * composer. The transcript is a real ScrollBox holding one renderable per timeline
 * block — assistant messages render as markdown cards (highlighted code fences),
 * tool calls / edits / diffs as compact colored rows — reconciled in place across
 * refreshes (see `blocks.ts`). It holds the FULL thread, follows the latest (sticky
 * bottom), and scrolls by mouse wheel, the scrollbar, and PgUp/PgDn/↑/↓/Home/End.
 * A new user turn opens a new exchange (a blank gap above its card). Tool/diff
 * output is a one-line preview by default — Tab/Shift+Tab move a selection cursor
 * across expandable rows and Ctrl+E expands the selected one.
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
  private screen: Screen | null = null;
  private scrollbox: ScrollBoxRenderable | null = null;
  private listBox: BoxRenderable | null = null;
  private composer: TextRenderable | null = null;
  private readonly input = new InputBuffer();
  private unsub: Unsubscribe | null = null;
  private sending = false;
  private refreshing = false;
  private refreshQueued = false;
  /** Tool-output selection/expansion state (cursor + expanded rows). */
  private readonly tools = new ToolSelection();
  /** Mounted block renderables, keyed by block id, for in-place reconciliation. */
  private mounted = new Map<string, MountedBlock>();
  /** Bumped on every mount/unmount; an in-flight refresh from an older generation
   *  discards its result rather than painting stale rows into a fresh mount. */
  private generation = 0;
  /** Blocks from the last successful fetch, so cursor/expand changes re-render locally. */
  private lastBlocks: Block[] | null = null;

  constructor(
    private readonly sdk: BBSdk,
    private readonly threadId: string,
    private readonly threadTitle: string,
  ) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    this.generation += 1;
    const layout = buildThreadLayout(host.renderer, this.threadTitle, host.navigator.depth <= 1);
    this.box = layout.screen.outer;
    this.screen = layout.screen;
    this.scrollbox = layout.scrollbox;
    this.listBox = layout.listBox;
    this.composer = layout.composer;
    host.renderer.root.add(layout.screen.outer);
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
    // Renderables were destroyed with the box tree; drop the stale handles so a
    // re-mount rebuilds from scratch. Bumping the generation and clearing the
    // in-flight flags makes any pending refresh discard its (now stale) result.
    this.mounted = new Map();
    this.listBox = null;
    this.screen = null;
    this.lastBlocks = null;
    this.generation += 1;
    this.refreshing = false;
    this.refreshQueued = false;
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
      this.rerender();
    } else if (key.ctrl && key.name === "e") {
      this.toggleSelectedTool();
    } else {
      return false;
    }
    return true;
  }

  /** Expand/collapse the selected tool, or hint how to select one. */
  private toggleSelectedTool(): void {
    if (this.tools.toggle()) this.rerender();
    else this.screen?.setStatus("select a row with Tab, then Ctrl+E to expand");
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

  /** Scroll so the selected block is in view, by its renderable id. */
  private scrollToSelected(): void {
    const id = this.tools.selected;
    if (this.scrollbox && id) this.scrollbox.scrollChildIntoView(id);
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
    this.screen?.setStatus(helpLegend());
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
    this.screen?.setStatus("sending…");
    try {
      await sendText(this.sdk, this.threadId, trimmed);
      this.screen?.setStatus("");
      await this.refresh();
    } catch (error) {
      this.screen?.setStatus(`send failed: ${errorText(error)}`, "error");
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
    if (!this.listBox) return;
    if (this.refreshing) {
      this.refreshQueued = true;
      return;
    }
    this.refreshing = true;
    // Capture the mount generation: if the view is unmounted/remounted while this
    // fetch is in flight, discard the result rather than paint stale rows.
    const generation = this.generation;
    try {
      // Metadata only decorates the header/status bar, so its failure must not
      // block the transcript.
      const [rows, meta] = await Promise.all([
        getTimelineRows(this.sdk, this.threadId),
        getThreadMeta(this.sdk, this.threadId).catch(() => null),
      ]);
      if (generation !== this.generation || !this.listBox) return;
      this.applyMeta(meta);
      const streaming = isTimelineActive(rows) || meta?.busy === true;
      const blocks = buildBlocks(rows, { streaming });
      this.lastBlocks = blocks;
      this.tools.sync(selectableIds(blocks));
      this.renderBlocks(blocks);
      if (this.tools.selected) this.scrollToSelected();
    } catch (error) {
      if (generation !== this.generation || !this.listBox) return;
      this.renderBlocks([
        { kind: "error", id: "error", text: `error loading timeline: ${errorText(error)}` },
      ]);
    } finally {
      if (generation === this.generation) this.refreshing = false;
    }
    if (this.refreshQueued && this.listBox) {
      this.refreshQueued = false;
      void this.refresh();
    }
  }

  /** Header title/branch and status-bar context from the thread record. */
  private applyMeta(meta: ThreadMeta | null): void {
    if (!this.screen) return;
    this.screen.setTitle(meta?.title ?? this.threadTitle, meta?.branch ?? undefined);
    this.screen.setContext(meta ? threadContext(meta) : []);
  }

  /** Re-render the last fetched blocks after a local cursor/expand change (no refetch). */
  private rerender(): void {
    if (!this.lastBlocks) return;
    this.renderBlocks(this.lastBlocks);
    this.scrollToSelected();
  }

  /** Reconcile the block column to `blocks`, reusing renderables by id. */
  private renderBlocks(blocks: Block[]): void {
    const listBox = this.listBox;
    if (!listBox) return;
    const optsFor = (block: Block): BlockOpts => ({
      selected: block.id === this.tools.selected,
      expanded: this.tools.expanded.has(block.id),
      maxLines: MAX_OUTPUT_LINES,
    });
    this.mounted = reconcileBlocks(this.host.renderer, listBox, this.mounted, blocks, optsFor);
  }
}

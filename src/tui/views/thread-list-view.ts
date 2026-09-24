import type { BoxRenderable, KeyEvent } from "@opentui/core";
import type { BBSdk } from "../../bb/sdk.ts";
import { listThreads, type Unsubscribe, watchProject } from "../../bb/threads.ts";
import type { View, ViewHost } from "../navigator.ts";
import type { SpawnPreset } from "../spawn-wizard.ts";
import { formatThreadRow, renderThreadList, type ThreadRow } from "../thread-list-render.ts";
import { errorText } from "../util.ts";
import { ListPanel, Screen } from "./chrome.ts";
import { SkillsView } from "./skills-view.ts";
import { SpawnWizardView } from "./spawn-wizard-view.ts";
import { ThreadSearchView } from "./thread-search-view.ts";
import { ThreadView } from "./thread-view.ts";

/** Hints, most important first (narrow terminals drop from the end). */
function hints(isRoot: boolean, archived: boolean): string {
  return archived
    ? `↑/↓ move · enter open · u unarchive · v active · ${isRoot ? "q quit" : "q back"}`
    : `↑/↓ move · enter open · n new · s search · i pin · x archive · v archived · ${isRoot ? "q quit" : "q back"}`;
}

/** Status-bar segment for the shorthand-seeded new-thread defaults, or null if none. */
function presetSummary(preset: SpawnPreset | null): string | null {
  if (!preset) return null;
  const parts = [
    preset.providerId,
    preset.model,
    preset.reasoningLevel,
    preset.permissionMode,
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  return parts.length > 0 ? `new thread: ${parts.join(" · ")}` : null;
}

/**
 * A project's thread list: live (re-fetched on `project:changed`), keyboard
 * navigable. Enter opens the selected thread; `n` starts a new one; `q`/esc goes
 * back. The status bar shows the thread count and any shorthand new-thread defaults.
 */
export class ThreadListView implements View {
  readonly title = "threads";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private screen: Screen | null = null;
  private panel: ListPanel | null = null;
  private rows: ThreadRow[] = [];
  private selected = 0;
  private unsub: Unsubscribe | null = null;
  /** Bumped on mount/unmount so a fetch from a previous mount can't paint this one. */
  private generation = 0;
  private archived = false;
  private pendingArchiveId: string | null = null;

  constructor(
    private readonly sdk: BBSdk,
    private readonly project: { id: string; name: string },
    private readonly preset: SpawnPreset | null = null,
  ) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    this.generation += 1;
    const screen = new Screen(host.renderer, {
      title: this.project.name,
      subtitle: "threads",
      hints: hints(host.navigator.depth <= 1, this.archived),
      wordmark: true,
    });
    this.panel = new ListPanel(host.renderer);
    screen.content.add(this.panel.root);
    this.screen = screen;
    this.box = screen.outer;
    this.renderContext();
    host.renderer.root.add(screen.outer);

    await this.refresh();
    this.unsub = watchProject(this.sdk, this.project.id, () => {
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
    this.screen = null;
    this.panel = null;
    this.generation += 1;
  }

  onKey(key: KeyEvent): void {
    if (key.name !== "x") this.pendingArchiveId = null;
    switch (key.name) {
      case "up":
      case "k":
        this.move(-1);
        break;
      case "down":
      case "j":
        this.move(1);
        break;
      case "return":
      case "enter":
        this.open();
        break;
      case "n":
        if (this.archived) break;
        // The project already exists here, so resolving its id is immediate. The
        // shorthand preset (if any) pre-seeds the wizard.
        void this.host.navigator.push(
          new SpawnWizardView(this.sdk, async () => this.project, this.preset, this.project.id),
        );
        break;
      case "p":
        void this.host.navigator.push(new SkillsView(this.sdk, this.project.id));
        break;
      case "s":
        void this.host.navigator.push(new ThreadSearchView(this.sdk, this.project.id));
        break;
      case "v":
        this.archived = !this.archived;
        this.selected = 0;
        this.screen?.setTitle(this.project.name, this.archived ? "archived threads" : "threads");
        this.screen?.setHints(hints(this.host.navigator.depth <= 1, this.archived));
        void this.refresh();
        break;
      case "i":
        if (!this.archived) void this.togglePin();
        break;
      case "x":
        if (!this.archived) void this.archiveSelected();
        break;
      case "u":
        if (this.archived) void this.unarchiveSelected();
        break;
      case "r":
        void this.refresh();
        break;
      case "q":
      case "escape":
        void this.host.navigator.pop();
        break;
      default:
        break;
    }
  }

  private async togglePin(): Promise<void> {
    const row = this.rows[this.selected];
    if (!row) return;
    try {
      if (row.pinned) await this.sdk.threads.unpin({ threadId: row.id });
      else await this.sdk.threads.pin({ threadId: row.id });
      await this.refresh();
    } catch (error) {
      this.screen?.setStatus(`pin failed: ${errorText(error)}`, "error");
    }
  }

  private async archiveSelected(): Promise<void> {
    const row = this.rows[this.selected];
    if (!row) return;
    if (this.pendingArchiveId !== row.id) {
      this.pendingArchiveId = row.id;
      this.screen?.setStatus(`press x again to archive ${row.title}`);
      return;
    }
    this.pendingArchiveId = null;
    try {
      await this.sdk.threads.archive({ threadId: row.id });
      await this.refresh();
      this.screen?.setStatus("thread archived");
    } catch (error) {
      this.screen?.setStatus(`archive failed: ${errorText(error)}`, "error");
    }
  }

  private async unarchiveSelected(): Promise<void> {
    const row = this.rows[this.selected];
    if (!row) return;
    try {
      await this.sdk.threads.unarchive({ threadId: row.id });
      await this.refresh();
      this.screen?.setStatus("thread unarchived");
    } catch (error) {
      this.screen?.setStatus(`unarchive failed: ${errorText(error)}`, "error");
    }
  }

  private move(delta: number): void {
    if (!this.panel || this.rows.length === 0) return;
    this.selected = this.panel.select(this.selected + delta);
  }

  private open(): void {
    const row = this.rows[this.selected];
    if (row) void this.host.navigator.push(new ThreadView(this.sdk, row.id, row.title));
  }

  private async refresh(): Promise<void> {
    if (!this.panel) return;
    const generation = this.generation;
    const archived = this.archived;
    try {
      const entries = await listThreads(this.sdk, this.project.id, undefined, archived);
      if (generation !== this.generation || archived !== this.archived || !this.panel) return;
      this.rows = renderThreadList(entries, archived);
      this.selected = this.panel.setItems(
        this.rows.map(formatThreadRow),
        this.archived ? "no archived threads" : "no threads yet — press n to start one",
        this.selected,
      );
      this.renderContext();
    } catch (error) {
      if (generation !== this.generation) return;
      this.panel?.showMessage(`error loading threads: ${errorText(error)}`, "error");
    }
  }

  private renderContext(): void {
    const count = `${this.rows.length} thread${this.rows.length === 1 ? "" : "s"}`;
    this.screen?.setContext([
      count,
      this.archived ? "archived" : (presetSummary(this.preset) ?? ""),
    ]);
  }
}

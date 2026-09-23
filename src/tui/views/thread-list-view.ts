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
import { ThreadView } from "./thread-view.ts";

/** Hints, most important first (narrow terminals drop from the end). */
function hints(isRoot: boolean): string {
  return `↑/↓ move · enter open · n new · ${isRoot ? "q quit" : "q back"} · p skills · r refresh`;
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
      hints: hints(host.navigator.depth <= 1),
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
        // The project already exists here, so resolving its id is immediate. The
        // shorthand preset (if any) pre-seeds the wizard.
        void this.host.navigator.push(
          new SpawnWizardView(this.sdk, async () => this.project, this.preset),
        );
        break;
      case "p":
        void this.host.navigator.push(new SkillsView(this.sdk, this.project.id));
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
    try {
      const entries = await listThreads(this.sdk, this.project.id);
      if (generation !== this.generation || !this.panel) return; // left or remounted mid-fetch
      this.rows = renderThreadList(entries);
      this.selected = this.panel.setItems(
        this.rows.map(formatThreadRow),
        "no threads yet — press n to start one",
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
    this.screen?.setContext([count, presetSummary(this.preset) ?? ""]);
  }
}

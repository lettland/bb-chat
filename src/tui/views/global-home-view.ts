import type { BoxRenderable, KeyEvent } from "@opentui/core";
import { listProjects } from "../../bb/project.ts";
import type { BBSdk } from "../../bb/sdk.ts";
import type { View, ViewHost } from "../navigator.ts";
import { formatProjectRow, type ProjectRow, toProjectRows } from "../project-list-render.ts";
import { errorText } from "../util.ts";
import { ListPanel, Screen } from "./chrome.ts";
import { PluginsView } from "./plugins-view.ts";
import { ThreadListView } from "./thread-list-view.ts";

/** Hints, most important first (narrow terminals drop from the end). */
function hints(isRoot: boolean): string {
  return `↑/↓ move · enter open · ${isRoot ? "q quit" : "q back"} · p plugins · r refresh`;
}

/**
 * Global home (`bbchat -g`): every project the user can see, newest counts. Enter
 * opens a project's thread list. The all-projects analogue of the web app home.
 */
export class GlobalHomeView implements View {
  readonly title = "projects";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private screen: Screen | null = null;
  private panel: ListPanel | null = null;
  private rows: ProjectRow[] = [];
  private selected = 0;
  /** Bumped on mount/unmount so a fetch from a previous mount can't paint this one. */
  private generation = 0;

  constructor(private readonly sdk: BBSdk) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    this.generation += 1;
    const screen = new Screen(host.renderer, {
      title: "all projects",
      hints: hints(host.navigator.depth <= 1),
      wordmark: true,
    });
    this.panel = new ListPanel(host.renderer);
    screen.content.add(this.panel.root);
    this.screen = screen;
    this.box = screen.outer;
    host.renderer.root.add(screen.outer);
    await this.refresh();
  }

  unmount(): void {
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
      case "p":
        void this.host.navigator.push(new PluginsView(this.sdk));
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
    if (row) {
      void this.host.navigator.push(new ThreadListView(this.sdk, { id: row.id, name: row.name }));
    }
  }

  private async refresh(): Promise<void> {
    if (!this.panel) return;
    const generation = this.generation;
    try {
      const rows = toProjectRows(await listProjects(this.sdk));
      if (generation !== this.generation || !this.panel) return; // left or remounted mid-fetch
      this.rows = rows;
      this.selected = this.panel.setItems(
        rows.map(formatProjectRow),
        "no projects yet",
        this.selected,
      );
      this.screen?.setContext([`${rows.length} project${rows.length === 1 ? "" : "s"}`]);
    } catch (error) {
      if (generation !== this.generation) return;
      this.panel?.showMessage(`error loading projects: ${errorText(error)}`, "error");
    }
  }
}

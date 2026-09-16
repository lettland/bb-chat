import { BoxRenderable, type KeyEvent, TextRenderable } from "@opentui/core";
import { listProjects } from "../../bb/project.ts";
import type { BBSdk } from "../../bb/sdk.ts";
import type { View, ViewHost } from "../navigator.ts";
import { formatProjectRow, type ProjectRow, toProjectRows } from "../project-list-render.ts";
import { clamp, errorText } from "../util.ts";
import { PluginsView } from "./plugins-view.ts";
import { ThreadListView } from "./thread-list-view.ts";

/**
 * Global home (`vch -g`): every project the user can see, newest counts. Enter
 * opens a project's thread list. The all-projects analogue of the web app home.
 */
export class GlobalHomeView implements View {
  readonly title = "projects";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private body: TextRenderable | null = null;
  private rows: ProjectRow[] = [];
  private selected = 0;

  constructor(private readonly sdk: BBSdk) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    const box = new BoxRenderable(host.renderer, { flexDirection: "column", padding: 1, gap: 1 });
    box.add(new TextRenderable(host.renderer, { content: "vch — all projects" }));
    this.body = new TextRenderable(host.renderer, { content: "loading…" });
    box.add(this.body);
    box.add(
      new TextRenderable(host.renderer, {
        content: "↑/↓ move · enter open · p plugins · r refresh · q quit",
      }),
    );
    host.renderer.root.add(box);
    this.box = box;
    await this.refresh();
  }

  unmount(): void {
    if (this.box) {
      this.host.renderer.root.remove(this.box);
      this.box.destroy();
      this.box = null;
    }
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
    if (this.rows.length === 0) return;
    this.selected = clamp(this.selected + delta, 0, this.rows.length - 1);
    this.renderBody();
  }

  private open(): void {
    const row = this.rows[this.selected];
    if (row) {
      void this.host.navigator.push(new ThreadListView(this.sdk, { id: row.id, name: row.name }));
    }
  }

  private async refresh(): Promise<void> {
    if (!this.body) return;
    try {
      this.rows = toProjectRows(await listProjects(this.sdk));
      this.selected = clamp(this.selected, 0, Math.max(0, this.rows.length - 1));
      this.renderBody();
    } catch (error) {
      this.body.content = `error loading projects: ${errorText(error)}`;
    }
  }

  private renderBody(): void {
    if (!this.body) return;
    this.body.content =
      this.rows.length === 0
        ? "no projects yet"
        : this.rows
            .map((row, i) => `${i === this.selected ? ">" : " "} ${formatProjectRow(row)}`)
            .join("\n");
  }
}

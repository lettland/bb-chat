import { BoxRenderable, type KeyEvent, TextRenderable } from "@opentui/core";
import type { BBSdk } from "../../bb/sdk.ts";
import { listThreads, type Unsubscribe, watchProject } from "../../bb/threads.ts";
import type { View, ViewHost } from "../navigator.ts";
import type { SpawnPreset } from "../spawn-wizard.ts";
import { accentColor } from "../theme.ts";
import { formatThreadRow, renderThreadList, type ThreadRow } from "../thread-list-render.ts";
import { clamp, errorText } from "../util.ts";
import { SkillsView } from "./skills-view.ts";
import { SpawnWizardView } from "./spawn-wizard-view.ts";
import { ThreadView } from "./thread-view.ts";

/** One-line summary of the shorthand-seeded new-thread defaults, or null if none. */
function presetSummary(preset: SpawnPreset | null): string | null {
  if (!preset) return null;
  const parts = [
    preset.providerId,
    preset.model,
    preset.reasoningLevel,
    preset.permissionMode,
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  return parts.length > 0 ? `new-thread default: ${parts.join(" · ")}` : null;
}

/**
 * A project's thread list: live (re-fetched on `project:changed`), keyboard
 * navigable. Enter opens the selected thread; `n` starts a new one (spawn wizard
 * lands later); `q`/esc goes back.
 */
export class ThreadListView implements View {
  readonly title = "threads";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private body: TextRenderable | null = null;
  private rows: ThreadRow[] = [];
  private selected = 0;
  private unsub: Unsubscribe | null = null;

  constructor(
    private readonly sdk: BBSdk,
    private readonly project: { id: string; name: string },
    private readonly preset: SpawnPreset | null = null,
  ) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    const box = new BoxRenderable(host.renderer, { flexDirection: "column", padding: 1, gap: 1 });
    box.add(new TextRenderable(host.renderer, { content: `project: ${this.project.name}` }));
    const summary = presetSummary(this.preset);
    if (summary)
      box.add(new TextRenderable(host.renderer, { content: summary, fg: accentColor() }));
    this.body = new TextRenderable(host.renderer, { content: "loading…" });
    box.add(this.body);
    box.add(
      new TextRenderable(host.renderer, {
        content: "↑/↓ move · enter open · n new · p skills · r refresh · q quit",
      }),
    );
    host.renderer.root.add(box);
    this.box = box;

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
    if (this.rows.length === 0) return;
    this.selected = clamp(this.selected + delta, 0, this.rows.length - 1);
    this.renderBody();
  }

  private open(): void {
    const row = this.rows[this.selected];
    if (row) void this.host.navigator.push(new ThreadView(this.sdk, row.id, row.title));
  }

  private async refresh(): Promise<void> {
    if (!this.body) return;
    try {
      const entries = await listThreads(this.sdk, this.project.id);
      this.rows = renderThreadList(entries);
      this.selected = clamp(this.selected, 0, Math.max(0, this.rows.length - 1));
      this.renderBody();
    } catch (error) {
      this.body.content = `error loading threads: ${errorText(error)}`;
    }
  }

  private renderBody(): void {
    if (!this.body) return;
    if (this.rows.length === 0) {
      this.body.content = "no threads yet — press n to start one";
      return;
    }
    this.body.content = this.rows
      .map((row, i) => `${i === this.selected ? ">" : " "} ${formatThreadRow(row)}`)
      .join("\n");
  }
}

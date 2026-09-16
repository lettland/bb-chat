import { BoxRenderable, type KeyEvent, TextRenderable } from "@opentui/core";
import { listSkills } from "../../bb/extensions.ts";
import type { BBSdk } from "../../bb/sdk.ts";
import { formatSkillRow, type SkillRow, toSkillRows } from "../extension-render.ts";
import type { View, ViewHost } from "../navigator.ts";
import { errorText } from "../util.ts";

/** Skills available in a project (read-only listing). */
export class SkillsView implements View {
  readonly title = "skills";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private body: TextRenderable | null = null;
  private rows: SkillRow[] = [];

  constructor(
    private readonly sdk: BBSdk,
    private readonly projectId: string,
  ) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    const box = new BoxRenderable(host.renderer, { flexDirection: "column", padding: 1, gap: 1 });
    box.add(new TextRenderable(host.renderer, { content: "skills" }));
    this.body = new TextRenderable(host.renderer, { content: "loading…" });
    box.add(this.body);
    box.add(new TextRenderable(host.renderer, { content: "r refresh · q back" }));
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
    if (key.name === "q" || key.name === "escape") {
      void this.host.navigator.pop();
    } else if (key.name === "r") {
      void this.refresh();
    }
  }

  private async refresh(): Promise<void> {
    if (!this.body) return;
    try {
      this.rows = toSkillRows(await listSkills(this.sdk, this.projectId));
      this.body.content =
        this.rows.length === 0 ? "no skills available" : this.rows.map(formatSkillRow).join("\n");
    } catch (error) {
      this.body.content = `error loading skills: ${errorText(error)}`;
    }
  }
}

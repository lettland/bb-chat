import type { BoxRenderable, KeyEvent } from "@opentui/core";
import { listSkills } from "../../bb/extensions.ts";
import type { BBSdk } from "../../bb/sdk.ts";
import { formatSkillRow, toSkillRows } from "../extension-render.ts";
import type { View, ViewHost } from "../navigator.ts";
import { errorText } from "../util.ts";
import { ListPanel, Screen } from "./chrome.ts";

/** Skills available in a project (read-only listing; ↑/↓ scroll long lists). */
export class SkillsView implements View {
  readonly title = "skills";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private screen: Screen | null = null;
  private panel: ListPanel | null = null;
  private selected = 0;

  constructor(
    private readonly sdk: BBSdk,
    private readonly projectId: string,
  ) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    const screen = new Screen(host.renderer, {
      title: "skills",
      hints: "↑/↓ scroll · r refresh · q back",
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
  }

  onKey(key: KeyEvent): void {
    if (key.name === "q" || key.name === "escape") {
      void this.host.navigator.pop();
    } else if (key.name === "r") {
      void this.refresh();
    } else if (key.name === "up" || key.name === "k") {
      if (this.panel) this.selected = this.panel.select(this.selected - 1);
    } else if (key.name === "down" || key.name === "j") {
      if (this.panel) this.selected = this.panel.select(this.selected + 1);
    }
  }

  private async refresh(): Promise<void> {
    if (!this.panel) return;
    try {
      const rows = toSkillRows(await listSkills(this.sdk, this.projectId));
      if (!this.panel) return; // left the view mid-fetch
      this.selected = this.panel.setItems(
        rows.map(formatSkillRow),
        "no skills available",
        this.selected,
      );
      this.screen?.setContext([`${rows.length} skill${rows.length === 1 ? "" : "s"}`]);
    } catch (error) {
      this.panel?.showMessage(`error loading skills: ${errorText(error)}`, "error");
    }
  }
}

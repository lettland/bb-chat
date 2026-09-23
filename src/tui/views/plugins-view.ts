import type { BoxRenderable, KeyEvent } from "@opentui/core";
import { listPlugins } from "../../bb/extensions.ts";
import type { BBSdk } from "../../bb/sdk.ts";
import { formatPluginRow, toPluginRows } from "../extension-render.ts";
import type { View, ViewHost } from "../navigator.ts";
import { errorText } from "../util.ts";
import { ListPanel, Screen } from "./chrome.ts";

/**
 * Installed plugins (● enabled / ○ disabled). Read-only listing: a plugin's
 * graphical panel can't render in a terminal, so those open in the BB app;
 * everything else stays available via the SDK and plugin CLI commands.
 */
export class PluginsView implements View {
  readonly title = "plugins";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private screen: Screen | null = null;
  private panel: ListPanel | null = null;
  private selected = 0;

  constructor(private readonly sdk: BBSdk) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    const screen = new Screen(host.renderer, {
      title: "plugins",
      subtitle: "graphical panels open in the BB app",
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
      const rows = toPluginRows(await listPlugins(this.sdk));
      if (!this.panel) return; // left the view mid-fetch
      this.selected = this.panel.setItems(
        rows.map(formatPluginRow),
        "no plugins installed",
        this.selected,
      );
      const enabled = rows.filter((r) => r.enabled).length;
      this.screen?.setContext([`${rows.length} installed`, `${enabled} enabled`]);
    } catch (error) {
      this.panel?.showMessage(`error loading plugins: ${errorText(error)}`, "error");
    }
  }
}

import { BoxRenderable, type KeyEvent, TextRenderable } from "@opentui/core";
import { listPlugins } from "../../bb/extensions.ts";
import type { BBSdk } from "../../bb/sdk.ts";
import { formatPluginRow, type PluginRow, toPluginRows } from "../extension-render.ts";
import type { View, ViewHost } from "../navigator.ts";
import { errorText } from "../util.ts";

/**
 * Installed plugins (● enabled / ○ disabled). Read-only listing: a plugin's
 * graphical panel can't render in a terminal, so those open in the BB app;
 * everything else stays available via the SDK and plugin CLI commands.
 */
export class PluginsView implements View {
  readonly title = "plugins";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private body: TextRenderable | null = null;
  private rows: PluginRow[] = [];

  constructor(private readonly sdk: BBSdk) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    const box = new BoxRenderable(host.renderer, { flexDirection: "column", padding: 1, gap: 1 });
    box.add(new TextRenderable(host.renderer, { content: "plugins" }));
    this.body = new TextRenderable(host.renderer, { content: "loading…" });
    box.add(this.body);
    box.add(
      new TextRenderable(host.renderer, {
        content: "graphical panels open in the BB app · r refresh · q back",
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
    if (key.name === "q" || key.name === "escape") {
      void this.host.navigator.pop();
    } else if (key.name === "r") {
      void this.refresh();
    }
  }

  private async refresh(): Promise<void> {
    if (!this.body) return;
    try {
      this.rows = toPluginRows(await listPlugins(this.sdk));
      this.body.content =
        this.rows.length === 0 ? "no plugins installed" : this.rows.map(formatPluginRow).join("\n");
    } catch (error) {
      this.body.content = `error loading plugins: ${errorText(error)}`;
    }
  }
}

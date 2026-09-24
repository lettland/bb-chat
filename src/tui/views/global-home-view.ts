import type { BoxRenderable, KeyEvent } from "@opentui/core";
import { listProjects } from "../../bb/project.ts";
import {
  type ProjectGroupState,
  readProjectGroups,
  setGroupCollapsed,
  updateProjectGroups,
} from "../../bb/project-groups.ts";
import type { BBSdk } from "../../bb/sdk.ts";
import type { View, ViewHost } from "../navigator.ts";
import { formatHomeRow, type HomeRow, layoutHome, ungroup } from "../project-groups.ts";
import { type ProjectRow, toProjectRows } from "../project-list-render.ts";
import { errorText } from "../util.ts";
import { ListPanel, Screen } from "./chrome.ts";
import { PluginsView } from "./plugins-view.ts";
import { ProjectGroupView } from "./project-group-view.ts";
import { ThreadListView } from "./thread-list-view.ts";
import { ThreadSearchView } from "./thread-search-view.ts";

/** Hints for the selected row, most important first (narrow terminals drop from the end). */
function hints(isRoot: boolean, row: HomeRow | undefined): string {
  const quit = isRoot ? "q quit" : "q back";
  if (row?.kind === "group") {
    const fold = row.collapsed ? "enter expand" : "enter collapse";
    return `↑/↓ move · ${fold} · e rename · u ungroup · ${quit} · r refresh`;
  }
  return `↑/↓ move · enter open · s search · g group · ${quit} · p plugins · r refresh`;
}

const NO_GROUPS: ProjectGroupState = { supported: false, groups: [], collapsed: new Set() };

/**
 * Global home (`bbchat -g`): every project the user can see, gathered under the
 * project groups shared with the BB sidebar. Enter opens a project's thread list
 * or folds a group; `g` moves a project between groups. The all-projects
 * analogue of the web app home.
 */
export class GlobalHomeView implements View {
  readonly title = "projects";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private screen: Screen | null = null;
  private panel: ListPanel | null = null;
  private projects: ProjectRow[] = [];
  private rows: HomeRow[] = [];
  private groups: ProjectGroupState = NO_GROUPS;
  /** The last group read failed (as opposed to this BB not having groups). */
  private groupsFailed = false;
  private selected = 0;
  /** Group writes run one at a time, so fast folds save in the order they were pressed. */
  private writes: Promise<void> = Promise.resolve();
  /** Bumped on mount/unmount so a fetch from a previous mount can't paint this one. */
  private generation = 0;

  constructor(private readonly sdk: BBSdk) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    this.generation += 1;
    const screen = new Screen(host.renderer, {
      title: "all projects",
      hints: hints(host.navigator.depth <= 1, undefined),
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
      case "g":
        this.moveToGroup();
        break;
      case "e":
        this.renameGroup();
        break;
      case "u":
        void this.ungroup();
        break;
      case "p":
        void this.host.navigator.push(new PluginsView(this.sdk));
        break;
      case "s":
        void this.host.navigator.push(new ThreadSearchView(this.sdk));
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
    this.renderHints();
  }

  private open(): void {
    const row = this.rows[this.selected];
    if (row?.kind === "group") {
      void this.toggleGroup(row.group.id, !row.collapsed);
    } else if (row) {
      const { id, name } = row.project;
      void this.host.navigator.push(new ThreadListView(this.sdk, { id, name }));
    }
  }

  /** False (with a status line) when groups can't be edited: unsupported, or failed to load. */
  private groupsSupported(): boolean {
    if (this.groups.supported) return true;
    this.screen?.setStatus(
      this.groupsFailed
        ? "project groups didn't load — press r to retry"
        : "project groups need a BB whose thread-list plugin has them",
      "error",
    );
    return false;
  }

  private moveToGroup(): void {
    const row = this.rows[this.selected];
    if (row?.kind !== "project" || !this.groupsSupported()) return;
    void this.host.navigator.push(
      new ProjectGroupView(this.sdk, { kind: "assign", project: row.project }),
    );
  }

  private renameGroup(): void {
    const row = this.rows[this.selected];
    if (row?.kind !== "group") return;
    void this.host.navigator.push(
      new ProjectGroupView(this.sdk, { kind: "rename", group: row.group }),
    );
  }

  private async ungroup(): Promise<void> {
    const row = this.rows[this.selected];
    if (row?.kind !== "group") return;
    await this.persist(() =>
      updateProjectGroups(this.sdk, (groups) => ungroup(groups, row.group.id)),
    );
  }

  private async toggleGroup(groupId: string, collapsed: boolean): Promise<void> {
    // Fold locally first so the key feels instant, then save it for the BB app too.
    const next = new Set(this.groups.collapsed);
    if (collapsed) next.add(groupId);
    else next.delete(groupId);
    this.groups = { ...this.groups, collapsed: next };
    this.render();
    await this.persist(() => setGroupCollapsed(this.sdk, groupId, collapsed));
  }

  /** Queue a group write, then reload so the list reflects what BB stored. */
  private persist(write: () => Promise<void>): Promise<void> {
    this.writes = this.writes.then(async () => {
      try {
        await write();
        this.screen?.setStatus("");
        await this.refresh();
      } catch (error) {
        this.screen?.setStatus(`error saving groups: ${errorText(error)}`, "error");
      }
    });
    return this.writes;
  }

  private async refresh(): Promise<void> {
    if (!this.panel) return;
    const generation = this.generation;
    try {
      // Groups are optional: a BB without them (or a failed read) still lists every project.
      let groupsError: string | null = null;
      const [entries, groups] = await Promise.all([
        listProjects(this.sdk),
        readProjectGroups(this.sdk).catch((error: unknown) => {
          groupsError = errorText(error);
          return NO_GROUPS;
        }),
      ]);
      if (generation !== this.generation || !this.panel) return; // left or remounted mid-fetch
      this.projects = toProjectRows(entries);
      this.groups = groups;
      this.render();
      this.groupsFailed = groupsError !== null;
      if (groupsError) this.screen?.setStatus(`error loading groups: ${groupsError}`, "error");
    } catch (error) {
      if (generation !== this.generation) return;
      this.panel?.showMessage(`error loading projects: ${errorText(error)}`, "error");
    }
  }

  private render(): void {
    if (!this.panel) return;
    // Keep the highlight on the same project/group across a re-layout.
    const before = this.rows[this.selected];
    this.rows = layoutHome(this.projects, this.groups.groups, this.groups.collapsed);
    const at = before ? this.rows.findIndex((row) => rowKey(row) === rowKey(before)) : -1;
    this.selected = this.panel.setItems(
      this.rows.map(formatHomeRow),
      "no projects yet",
      at === -1 ? this.selected : at,
    );
    const count = this.projects.length;
    const groupCount = this.rows.filter((row) => row.kind === "group").length;
    this.screen?.setContext([
      `${count} project${count === 1 ? "" : "s"}`,
      groupCount > 0 ? `${groupCount} group${groupCount === 1 ? "" : "s"}` : "",
    ]);
    this.renderHints();
  }

  private renderHints(): void {
    this.screen?.setHints(hints(this.host.navigator.depth <= 1, this.rows[this.selected]));
  }
}

function rowKey(row: HomeRow): string {
  return row.kind === "group" ? `group:${row.group.id}` : `project:${row.project.id}`;
}

import { BoxRenderable, type KeyEvent, TextRenderable } from "@opentui/core";
import { readProjectGroups, updateProjectGroups } from "../../bb/project-groups.ts";
import type { BBSdk } from "../../bb/sdk.ts";
import { InputBuffer } from "../input-buffer.ts";
import type { View, ViewHost } from "../navigator.ts";
import {
  assignProject,
  assignProjectToNamedGroup,
  findGroup,
  newGroupId,
  type ProjectGroup,
  renameGroup,
} from "../project-groups.ts";
import type { ProjectRow } from "../project-list-render.ts";
import { sanitizeText } from "../sanitize.ts";
import { palette, toneColor } from "../theme.ts";
import { errorText } from "../util.ts";
import { ListPanel, Screen } from "./chrome.ts";

/** What the view edits: a project's group membership, or a group's name. */
export type ProjectGroupTarget =
  | { kind: "assign"; project: ProjectRow }
  | { kind: "rename"; group: ProjectGroup };

type Choice =
  | { kind: "group"; group: ProjectGroup }
  | { kind: "new" }
  | { kind: "remove"; group: ProjectGroup };

const PICK_HINTS = "↑/↓ move · enter choose · esc back";
const NAME_HINTS = "type a name · enter save · esc back";

function choiceLabel(choice: Choice, current: ProjectGroup | null): string {
  if (choice.kind === "new") return "+ new group…";
  if (choice.kind === "remove") return `− remove from ${choice.group.name}`;
  return `${choice.group.id === current?.id ? "✓" : " "} ${choice.group.name}`;
}

/**
 * Move a project into a group (an existing one, a new one, or none), or rename
 * a group. Changes are saved to BB's shared project groups, then the view pops
 * back to the global home, which re-reads them on remount.
 */
export class ProjectGroupView implements View {
  readonly title = "project group";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private screen: Screen | null = null;
  private panel: ListPanel | null = null;
  private nameBox: BoxRenderable | null = null;
  private nameText: TextRenderable | null = null;
  private readonly input = new InputBuffer();
  private choices: Choice[] = [];
  private current: ProjectGroup | null = null;
  private selected = 0;
  private naming = false;
  private busy = false;

  constructor(
    private readonly sdk: BBSdk,
    private readonly target: ProjectGroupTarget,
  ) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    const p = palette();
    const screen =
      this.target.kind === "assign"
        ? new Screen(host.renderer, {
            title: this.target.project.name,
            subtitle: "move to group",
            hints: PICK_HINTS,
          })
        : new Screen(host.renderer, {
            title: this.target.group.name,
            subtitle: "rename group",
            hints: NAME_HINTS,
          });
    this.panel = new ListPanel(host.renderer);
    screen.content.add(this.panel.root);

    this.nameBox = new BoxRenderable(host.renderer, {
      border: true,
      borderStyle: "rounded",
      borderColor: p.border.focus,
      title: " group name ",
      titleColor: toneColor("system"),
      height: 3,
      flexShrink: 0,
      visible: false,
    });
    this.nameText = new TextRenderable(host.renderer, { content: "" });
    this.nameBox.add(this.nameText);
    screen.content.add(this.nameBox);

    this.screen = screen;
    this.box = screen.outer;
    host.renderer.root.add(screen.outer);

    if (this.target.kind === "rename") {
      this.startNaming(this.target.group.name);
      return;
    }
    try {
      const { groups } = await readProjectGroups(this.sdk);
      if (!this.panel) return; // left mid-fetch
      this.current = findGroup(groups, this.target.project.id);
      const sorted = [...groups].sort((a, b) => a.name.localeCompare(b.name));
      this.choices = [
        ...sorted.map((group): Choice => ({ kind: "group", group })),
        { kind: "new" },
        ...(this.current ? [{ kind: "remove", group: this.current } as Choice] : []),
      ];
      const at = this.choices.findIndex(
        (c) => c.kind === "group" && c.group.id === this.current?.id,
      );
      this.selected = this.panel.setItems(
        this.choices.map((c) => choiceLabel(c, this.current)),
        "no groups yet",
        Math.max(at, 0),
      );
      screen.setContext([this.current ? `in ${this.current.name}` : "ungrouped"]);
    } catch (error) {
      this.panel?.showMessage(`error loading groups: ${errorText(error)}`, "error");
    }
  }

  unmount(): void {
    if (this.box) {
      this.host.renderer.root.remove(this.box);
      this.box.destroy();
      this.box = null;
    }
    this.screen = null;
    this.panel = null;
    this.nameBox = null;
    this.nameText = null;
  }

  onKey(key: KeyEvent): void {
    if (this.busy) return;
    if (this.naming) {
      this.handleName(key);
      return;
    }
    switch (key.name) {
      case "up":
      case "k":
        if (this.panel) this.selected = this.panel.select(this.selected - 1);
        break;
      case "down":
      case "j":
        if (this.panel) this.selected = this.panel.select(this.selected + 1);
        break;
      case "return":
      case "enter":
        this.choose();
        break;
      case "q":
      case "escape":
        void this.host.navigator.pop();
        break;
      default:
        break;
    }
  }

  private choose(): void {
    if (this.target.kind !== "assign") return;
    const choice = this.choices[this.selected];
    if (!choice) return;
    const projectId = this.target.project.id;
    if (choice.kind === "new") {
      this.startNaming("");
    } else if (choice.kind === "remove") {
      void this.save((groups) => assignProject(groups, projectId, null));
    } else {
      void this.save((groups) => assignProject(groups, projectId, choice.group.id));
    }
  }

  private handleName(key: KeyEvent): void {
    if (key.name === "escape") {
      // Renaming has no list to fall back to; a new-group name returns to the picker.
      if (this.target.kind === "rename") {
        void this.host.navigator.pop();
        return;
      }
      this.naming = false;
      this.input.clear();
      if (this.panel) this.panel.root.visible = true;
      if (this.nameBox) this.nameBox.visible = false;
      this.screen?.setHints(PICK_HINTS);
      this.screen?.setStatus("");
      return;
    }
    const action = this.input.handle(key);
    if (action.type === "update") {
      this.renderName();
    } else if (action.type === "submit") {
      // Submit clears the buffer; keep the text so a failed save can be retried.
      this.input.set(action.value);
      const name = action.value.trim();
      if (name.length === 0) {
        this.screen?.setStatus("a group needs a name", "error");
        this.renderName();
        return;
      }
      const target = this.target;
      void this.save((groups) =>
        target.kind === "rename"
          ? renameGroup(groups, target.group.id, name)
          : assignProjectToNamedGroup(groups, target.project.id, name, newGroupId()),
      );
    }
  }

  private startNaming(initial: string): void {
    this.naming = true;
    this.input.set(initial);
    if (this.panel) this.panel.root.visible = false;
    if (this.nameBox) this.nameBox.visible = true;
    this.screen?.setHints(NAME_HINTS);
    this.renderName();
  }

  private renderName(): void {
    // A renamed group's name comes from BB, so scrub it like every other shown string.
    if (this.nameText) this.nameText.content = `❯ ${sanitizeText(this.input.value)}`;
  }

  private async save(edit: (groups: ProjectGroup[]) => ProjectGroup[]): Promise<void> {
    this.busy = true;
    this.screen?.setStatus("saving…");
    try {
      await updateProjectGroups(this.sdk, edit);
      await this.host.navigator.pop();
    } catch (error) {
      this.screen?.setStatus(`save failed: ${errorText(error)}`, "error");
    } finally {
      this.busy = false;
    }
  }
}

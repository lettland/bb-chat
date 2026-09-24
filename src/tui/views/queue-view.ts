import { type BoxRenderable, type KeyEvent, TextRenderable } from "@opentui/core";
import type { BBSdk } from "../../bb/sdk.ts";
import { InputBuffer } from "../input-buffer.ts";
import type { View, ViewHost } from "../navigator.ts";
import { sanitizeText } from "../sanitize.ts";
import { errorText } from "../util.ts";
import { ListPanel, Screen } from "./chrome.ts";

type QueuedMessage = Awaited<ReturnType<BBSdk["threads"]["queuedMessages"]["list"]>>[number];

function preview(row: QueuedMessage): string {
  const text = row.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ");
  return `${row.failureReason ? "failed" : (row.waitingOn?.kind ?? "queued")} · ${text.slice(0, 90) || row.payload.kind}`;
}

/** Inspect, edit and dispatch messages waiting on a thread. */
export class QueueView implements View {
  readonly title = "queue";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private screen: Screen | null = null;
  private panel: ListPanel | null = null;
  private details: TextRenderable | null = null;
  private editor: TextRenderable | null = null;
  private rows: QueuedMessage[] = [];
  private selected = 0;
  private readonly input = new InputBuffer();
  private editing = false;
  private pendingDelete: string | null = null;
  private busy = false;
  private generation = 0;

  constructor(
    private readonly sdk: BBSdk,
    private readonly threadId: string,
  ) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    this.generation++;
    const screen = new Screen(host.renderer, {
      title: "queued messages",
      hints: "↑/↓ select · e edit · n send now · d delete · r refresh · esc back",
    });
    this.panel = new ListPanel(host.renderer, { height: 7, flexGrow: 0 });
    this.details = new TextRenderable(host.renderer, { content: "" });
    this.editor = new TextRenderable(host.renderer, { content: "", visible: false });
    screen.content.add(this.panel.root);
    screen.content.add(this.details);
    screen.content.add(this.editor);
    this.screen = screen;
    this.box = screen.outer;
    host.renderer.root.add(screen.outer);
    await this.refresh();
  }

  unmount(): void {
    if (this.box) {
      this.host.renderer.root.remove(this.box);
      this.box.destroy();
    }
    this.box = null;
    this.screen = null;
    this.panel = null;
    this.details = null;
    this.editor = null;
    this.generation++;
  }

  onKey(key: KeyEvent): void {
    if (key.name === "escape") {
      if (this.editing) {
        this.editing = false;
        this.input.clear();
        this.render();
      } else void this.host.navigator.pop();
      return;
    }
    if (this.busy) return;
    if (this.editing) {
      const action = this.input.handle(key);
      if (action.type === "submit") void this.saveEdit(action.value);
      else if (action.type === "update") this.render();
      return;
    }
    if (key.name !== "d") this.pendingDelete = null;
    if (key.name === "up" || key.name === "k")
      this.selected = this.panel?.select(this.selected - 1) ?? 0;
    else if (key.name === "down" || key.name === "j")
      this.selected = this.panel?.select(this.selected + 1) ?? 0;
    else if (key.name === "e") this.startEdit();
    else if (key.name === "n") void this.sendNow();
    else if (key.name === "d") void this.deleteSelected();
    else if (key.name === "r") void this.refresh();
    else if (key.name === "q") void this.host.navigator.pop();
    this.render();
  }

  private current(): QueuedMessage | undefined {
    return this.rows[this.selected];
  }

  private render(): void {
    const row = this.current();
    if (this.details)
      this.details.content = row
        ? sanitizeText(
            `${row.failureReason ?? row.waitingOn?.kind ?? "queued"}\n${row.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n")}`,
          )
        : "";
    if (this.editor) {
      this.editor.visible = this.editing;
      this.editor.content = this.editing ? sanitizeText(`❯ ${this.input.value}`) : "";
    }
    this.screen?.setHints(
      this.editing
        ? "enter save · shift+enter newline · esc cancel"
        : "↑/↓ select · e edit · n send now · d delete · r refresh · esc back",
    );
    this.screen?.setContext([`${this.rows.length} queued`]);
  }

  private async refresh(): Promise<void> {
    const generation = this.generation;
    try {
      const rows = await this.sdk.threads.queuedMessages.list({ threadId: this.threadId });
      if (generation !== this.generation || !this.panel) return;
      this.rows = rows;
      this.selected = this.panel.setItems(rows.map(preview), "no queued messages", this.selected);
      this.render();
    } catch (error) {
      this.screen?.setStatus(`queue failed: ${errorText(error)}`, "error");
    }
  }

  private startEdit(): void {
    const row = this.current();
    const textParts = row?.content.filter((part) => part.type === "text") ?? [];
    if (!row?.editable || textParts.length !== 1 || (textParts[0]?.mentions.length ?? 0) > 0) {
      this.screen?.setStatus(
        "only editable messages with one plain text part can be edited here",
        "error",
      );
      return;
    }
    this.input.set(textParts[0]?.text ?? "");
    this.editing = true;
  }

  private async saveEdit(text: string): Promise<void> {
    const row = this.current();
    if (!row || !text.trim()) return;
    this.busy = true;
    try {
      const input = row.content.map((part) =>
        part.type === "text" ? { ...part, text, mentions: [] } : part,
      );
      await this.sdk.threads.queuedMessages.update({
        threadId: this.threadId,
        queuedMessageId: row.id,
        expectedUpdatedAt: row.updatedAt,
        input,
      });
      this.editing = false;
      this.input.clear();
      await this.refresh();
    } catch (error) {
      this.screen?.setStatus(`edit failed: ${errorText(error)}`, "error");
    } finally {
      this.busy = false;
    }
  }

  private async sendNow(): Promise<void> {
    const row = this.current();
    if (!row) return;
    this.busy = true;
    try {
      await this.sdk.threads.queuedMessages.send({
        threadId: this.threadId,
        queuedMessageId: row.id,
        mode: "auto",
      });
      await this.refresh();
      this.screen?.setStatus("queued message dispatched");
    } catch (error) {
      this.screen?.setStatus(`dispatch failed: ${errorText(error)}`, "error");
    } finally {
      this.busy = false;
    }
  }

  private async deleteSelected(): Promise<void> {
    const row = this.current();
    if (!row) return;
    if (this.pendingDelete !== row.id) {
      this.pendingDelete = row.id;
      this.screen?.setStatus("press d again to discard this queued message");
      return;
    }
    this.pendingDelete = null;
    this.busy = true;
    try {
      await this.sdk.threads.queuedMessages.delete({
        threadId: this.threadId,
        queuedMessageId: row.id,
      });
      await this.refresh();
      this.screen?.setStatus("queued message deleted");
    } catch (error) {
      this.screen?.setStatus(`delete failed: ${errorText(error)}`, "error");
    } finally {
      this.busy = false;
    }
  }
}

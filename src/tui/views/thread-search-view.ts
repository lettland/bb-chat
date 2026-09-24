import { type BoxRenderable, type KeyEvent, TextRenderable } from "@opentui/core";
import type { BBSdk } from "../../bb/sdk.ts";
import { InputBuffer } from "../input-buffer.ts";
import type { View, ViewHost } from "../navigator.ts";
import { sanitizeText } from "../sanitize.ts";
import { errorText } from "../util.ts";
import { ListPanel, Screen } from "./chrome.ts";
import { ThreadView } from "./thread-view.ts";

type SearchResult = Awaited<ReturnType<BBSdk["threads"]["search"]>>;
type SearchHit = SearchResult["active"]["results"][number];

/** Search thread titles and message text through BB's indexed search. */
export class ThreadSearchView implements View {
  readonly title = "search";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private screen: Screen | null = null;
  private panel: ListPanel | null = null;
  private queryText: TextRenderable | null = null;
  private excerpt: TextRenderable | null = null;
  private readonly input = new InputBuffer();
  private editing = true;
  private hits: SearchHit[] = [];
  private selected = 0;
  private generation = 0;

  constructor(
    private readonly sdk: BBSdk,
    private readonly projectId: string | null = null,
  ) {}

  mount(host: ViewHost): void {
    this.host = host;
    this.generation++;
    const screen = new Screen(host.renderer, {
      title: "search BB",
      hints: "type query · enter search · esc back",
    });
    this.queryText = new TextRenderable(host.renderer, { content: "" });
    this.panel = new ListPanel(host.renderer);
    this.panel.showMessage("type a query and press Enter");
    this.excerpt = new TextRenderable(host.renderer, { content: "" });
    screen.content.add(this.queryText);
    screen.content.add(this.panel.root);
    screen.content.add(this.excerpt);
    this.screen = screen;
    this.box = screen.outer;
    host.renderer.root.add(screen.outer);
    this.render();
  }

  unmount(): void {
    if (this.box) {
      this.host.renderer.root.remove(this.box);
      this.box.destroy();
    }
    this.box = null;
    this.panel = null;
    this.queryText = null;
    this.excerpt = null;
    this.screen = null;
    this.generation++;
  }

  onKey(key: KeyEvent): void {
    if (key.name === "escape") {
      if (this.editing && this.hits.length > 0) this.editing = false;
      else void this.host.navigator.pop();
      this.render();
      return;
    }
    if (this.editing) {
      const action = this.input.handle(key);
      if (action.type === "submit") void this.search();
      else if (action.type === "update") this.render();
      return;
    }
    if (key.name === "up" || key.name === "k")
      this.selected = this.panel?.select(this.selected - 1) ?? 0;
    else if (key.name === "down" || key.name === "j")
      this.selected = this.panel?.select(this.selected + 1) ?? 0;
    else if (key.name === "return" || key.name === "enter") {
      const hit = this.hits[this.selected];
      if (hit)
        void this.host.navigator.push(
          new ThreadView(
            this.sdk,
            hit.thread.id,
            hit.thread.title ?? hit.thread.titleFallback ?? hit.thread.id,
          ),
        );
    } else if (key.name === "s") this.editing = true;
    else if (key.name === "r") void this.search();
    else if (key.name === "q") void this.host.navigator.pop();
    this.render();
  }

  private render(): void {
    if (this.queryText)
      this.queryText.content = sanitizeText(
        `Search: ${this.input.value}${this.editing ? "▏" : ""}`,
      );
    const hit = this.hits[this.selected];
    if (this.excerpt) this.excerpt.content = hit ? sanitizeText(hit.matches[0]?.text ?? "") : "";
    this.screen?.setHints(
      this.editing
        ? "enter search · esc back"
        : "↑/↓ move · enter open · s edit query · r refresh · q back",
    );
  }

  private async search(): Promise<void> {
    const query = this.input.value.trim();
    if (!query) return;
    const generation = this.generation;
    this.screen?.setStatus("searching…");
    try {
      const result = await this.sdk.threads.search({ query, limitPerGroup: "50" });
      if (generation !== this.generation || !this.panel) return;
      this.hits = [...result.active.results, ...result.archived.results].filter(
        (hit) => !this.projectId || hit.thread.projectId === this.projectId,
      );
      this.selected = this.panel.setItems(
        this.hits.map(
          (hit) =>
            `${hit.thread.archivedAt ? "[archived] " : ""}${hit.thread.title ?? hit.thread.titleFallback ?? hit.thread.id}`,
        ),
        this.projectId
          ? "no matches in the returned results (BB limits each group to 50)"
          : "no matching threads",
      );
      this.editing = false;
      this.screen?.setStatus("");
      this.screen?.setContext([
        `${this.hits.length} shown`,
        this.projectId ? "this project" : "all projects",
      ]);
      this.render();
    } catch (error) {
      this.screen?.setStatus(`search failed: ${errorText(error)}`, "error");
    }
  }
}

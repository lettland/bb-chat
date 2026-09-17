import type { ToolAnchor } from "./timeline-render.ts";

/**
 * The transcript's tool-output selection state: which expandable tool rows exist
 * (anchors), which one carries the cursor, and which are expanded. Pure and
 * testable — the view drives it from key events and reads back what to render.
 */
export class ToolSelection {
  private readonly expandedIds = new Set<string>();
  private selectedId: string | null = null;
  private anchors: ToolAnchor[] = [];

  /** Ids whose full output should render (passed to `renderTranscript`). */
  get expanded(): ReadonlySet<string> {
    return this.expandedIds;
  }

  /** Id under the cursor, or null when nothing is selected. */
  get selected(): string | null {
    return this.selectedId;
  }

  /** Adopt the latest anchors; forget a selection whose tool has vanished. */
  sync(anchors: ToolAnchor[]): void {
    this.anchors = anchors;
    if (this.selectedId && !anchors.some((a) => a.id === this.selectedId)) {
      this.selectedId = null;
    }
  }

  /** Move the cursor; from no selection, +1 picks the last tool, -1 the first. */
  move(delta: number): void {
    if (this.anchors.length === 0) return;
    const ids = this.anchors.map((a) => a.id);
    const current = this.selectedId ? ids.indexOf(this.selectedId) : -1;
    const next =
      current === -1
        ? delta > 0
          ? ids.length - 1
          : 0
        : Math.min(Math.max(current + delta, 0), ids.length - 1);
    this.selectedId = ids[next] ?? null;
  }

  /** Toggle the selected tool's expansion; returns false when nothing is selected. */
  toggle(): boolean {
    if (!this.selectedId) return false;
    if (this.expandedIds.has(this.selectedId)) this.expandedIds.delete(this.selectedId);
    else this.expandedIds.add(this.selectedId);
    return true;
  }

  /** Transcript line of the selected tool's call, or null — for scroll-into-view. */
  selectedLine(): number | null {
    const anchor = this.anchors.find((a) => a.id === this.selectedId);
    return anchor ? anchor.line : null;
  }
}

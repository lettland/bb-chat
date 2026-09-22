/**
 * The transcript's tool/diff selection state: which expandable rows exist (by
 * block id), which one carries the cursor, and which are expanded. Pure and
 * testable — the view drives it from key events and reads back what to render, and
 * scrolls the selected block into view via its id.
 */
export class ToolSelection {
  private readonly expandedIds = new Set<string>();
  private selectedId: string | null = null;
  private ids: string[] = [];

  /** Ids whose full output should render (passed as the expanded set to the view). */
  get expanded(): ReadonlySet<string> {
    return this.expandedIds;
  }

  /** Block id under the cursor, or null when nothing is selected. */
  get selected(): string | null {
    return this.selectedId;
  }

  /** Adopt the latest selectable block ids; forget a selection that has vanished. */
  sync(ids: string[]): void {
    this.ids = ids;
    if (this.selectedId && !ids.includes(this.selectedId)) {
      this.selectedId = null;
    }
  }

  /** Move the cursor; from no selection, +1 picks the last row, -1 the first. */
  move(delta: number): void {
    if (this.ids.length === 0) return;
    const current = this.selectedId ? this.ids.indexOf(this.selectedId) : -1;
    const next =
      current === -1
        ? delta > 0
          ? this.ids.length - 1
          : 0
        : Math.min(Math.max(current + delta, 0), this.ids.length - 1);
    this.selectedId = this.ids[next] ?? null;
  }

  /** Toggle the selected row's expansion; returns false when nothing is selected. */
  toggle(): boolean {
    if (!this.selectedId) return false;
    if (this.expandedIds.has(this.selectedId)) this.expandedIds.delete(this.selectedId);
    else this.expandedIds.add(this.selectedId);
    return true;
  }
}

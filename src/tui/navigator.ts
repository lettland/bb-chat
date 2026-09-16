import type { CliRenderer, KeyEvent } from "@opentui/core";

/** Services a mounted view can use. */
export interface ViewHost {
  readonly renderer: CliRenderer;
  readonly navigator: Navigator;
  /** Request a clean exit of the whole application. */
  exit(): void;
}

/**
 * A screen in the view stack. A view owns its renderable subtree: `mount` builds
 * and attaches it, `unmount` tears it down (removing renderables, unsubscribing
 * realtime, clearing timers). Views may be mounted more than once (on pop), so
 * `mount` must build fresh and `unmount` must fully clean up.
 */
export interface View {
  readonly title: string;
  mount(host: ViewHost): void | Promise<void>;
  unmount(): void;
  onKey(key: KeyEvent): void;
}

export interface NavigatorDeps {
  renderer: CliRenderer;
  exit: () => void;
}

/**
 * A stack-based navigator: global home → project thread list → thread, plus any
 * pushed overlay. Only the top view is mounted; pushing unmounts the previous
 * and mounts the new, popping does the reverse. Keys route to the top view.
 */
export class Navigator {
  private readonly stack: View[] = [];

  constructor(private readonly deps: NavigatorDeps) {}

  get depth(): number {
    return this.stack.length;
  }

  get current(): View | null {
    return this.stack.at(-1) ?? null;
  }

  private host(): ViewHost {
    return { renderer: this.deps.renderer, navigator: this, exit: this.deps.exit };
  }

  /** Push a new top view, unmounting the current one. */
  async push(view: View): Promise<void> {
    this.current?.unmount();
    this.stack.push(view);
    await this.mountTop();
  }

  /** Replace the current top view with another. */
  async replace(view: View): Promise<void> {
    this.current?.unmount();
    if (this.stack.length > 0) this.stack.pop();
    this.stack.push(view);
    await this.mountTop();
  }

  /** Pop the top view; if the stack empties, exit the app. */
  async pop(): Promise<void> {
    this.stack.pop()?.unmount();
    await this.mountTop();
  }

  /**
   * Mount the current top view, rolling back on failure: a view whose `mount`
   * throws is discarded (never left as a half-built top that would receive
   * keys), and the view it revealed is mounted instead — recursing down to an
   * empty stack, which exits. Terminal UIs can't safely log to a corrupted
   * screen, so the failed view is dropped rather than surfaced inline.
   */
  private async mountTop(): Promise<void> {
    const view = this.current;
    if (!view) {
      this.deps.exit();
      return;
    }
    try {
      await view.mount(this.host());
    } catch {
      this.stack.pop();
      await this.mountTop();
    }
  }

  /** Route a keypress to the top view. */
  handleKey(key: KeyEvent): void {
    this.current?.onKey(key);
  }
}

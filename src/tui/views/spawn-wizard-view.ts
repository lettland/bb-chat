import { BoxRenderable, type KeyEvent, TextRenderable } from "@opentui/core";
import { listModels, listProviders, spawnThread } from "../../bb/providers.ts";
import type { BBSdk } from "../../bb/sdk.ts";
import { InputBuffer } from "../input-buffer.ts";
import type { View, ViewHost } from "../navigator.ts";
import {
  buildSpawnParams,
  chooseMode,
  chooseModel,
  chooseProvider,
  highlighted,
  initWizard,
  moveCursor,
  type PermissionMode,
  setModels,
  setPrompt,
  stepChoices,
  toModelChoices,
  toProviderChoices,
  type WizardState,
} from "../spawn-wizard.ts";
import { errorText } from "../util.ts";
import { ThreadView } from "./thread-view.ts";

/**
 * The new-thread spawn wizard: provider → model → mode → prompt, then
 * `threads.spawn`. Selection steps use the pure wizard state machine; the prompt
 * step uses the shared input buffer. On success the wizard replaces itself with
 * the new thread's view.
 */
export class SpawnWizardView implements View {
  readonly title = "new thread";
  private host!: ViewHost;
  private box: BoxRenderable | null = null;
  private header: TextRenderable | null = null;
  private body: TextRenderable | null = null;
  private footer: TextRenderable | null = null;
  private status: TextRenderable | null = null;
  private state: WizardState | null = null;
  private readonly input = new InputBuffer();
  private busy = false;

  constructor(
    private readonly sdk: BBSdk,
    private readonly project: { id: string; name: string },
  ) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    const box = new BoxRenderable(host.renderer, { flexDirection: "column", padding: 1, gap: 1 });
    this.header = new TextRenderable(host.renderer, { content: "new thread" });
    this.body = new TextRenderable(host.renderer, { content: "loading providers…" });
    this.status = new TextRenderable(host.renderer, { content: "" });
    this.footer = new TextRenderable(host.renderer, {
      content: "↑/↓ move · enter select · esc back",
    });
    box.add(this.header);
    box.add(this.body);
    box.add(this.status);
    box.add(this.footer);
    host.renderer.root.add(box);
    this.box = box;

    try {
      const providers = toProviderChoices(await listProviders(this.sdk));
      this.state = initWizard(providers);
      this.render();
    } catch (error) {
      if (this.body) this.body.content = `error loading providers: ${errorText(error)}`;
    }
  }

  unmount(): void {
    if (this.box) {
      this.host.renderer.root.remove(this.box);
      this.box.destroy();
      this.box = null;
    }
  }

  onKey(key: KeyEvent): void {
    if (key.name === "escape") {
      void this.host.navigator.pop();
      return;
    }
    if (!this.state || this.busy) return;

    if (this.state.step === "prompt") {
      this.handlePrompt(key);
      return;
    }

    switch (key.name) {
      case "up":
      case "k":
        this.state = moveCursor(this.state, -1);
        this.render();
        break;
      case "down":
      case "j":
        this.state = moveCursor(this.state, 1);
        this.render();
        break;
      case "return":
      case "enter":
        void this.advance();
        break;
      default:
        break;
    }
  }

  private handlePrompt(key: KeyEvent): void {
    const action = this.input.handle(key);
    if (action.type === "submit") {
      void this.submit(action.value);
    } else if (action.type === "update" && this.state) {
      this.state = setPrompt(this.state, this.input.value);
      this.render();
    }
  }

  private async advance(): Promise<void> {
    const state = this.state;
    if (!state) return;
    const choice = highlighted(state);
    if (!choice) return;

    if (state.step === "provider") {
      this.state = chooseProvider(state, choice);
      this.render();
      try {
        const models = toModelChoices(await listModels(this.sdk, choice.id));
        if (this.state) this.state = setModels(this.state, models);
      } catch (error) {
        if (this.status) this.status.content = `error loading models: ${errorText(error)}`;
      }
      this.render();
    } else if (state.step === "model") {
      this.state = chooseModel(state, choice);
      this.render();
    } else if (state.step === "mode") {
      this.state = chooseMode(state, choice.id as PermissionMode);
      this.render();
    }
  }

  private async submit(text: string): Promise<void> {
    if (text.trim().length === 0 || this.busy || !this.state) return;
    this.busy = true;
    if (this.status) this.status.content = "creating thread…";
    try {
      const params = buildSpawnParams(setPrompt(this.state, text), this.project.id);
      const threadId = await spawnThread(this.sdk, params);
      if (threadId) {
        await this.host.navigator.replace(new ThreadView(this.sdk, threadId, "new thread"));
        return;
      }
      if (this.status) this.status.content = "spawn returned no thread id";
    } catch (error) {
      if (this.status) this.status.content = `spawn failed: ${errorText(error)}`;
    } finally {
      this.busy = false;
    }
  }

  private render(): void {
    const state = this.state;
    if (!state || !this.header || !this.body || !this.footer) return;

    const summary = [
      state.provider ? `provider ${state.provider.label}` : null,
      state.model ? `model ${state.model.label}` : null,
      state.mode ? `mode ${state.mode}` : null,
    ]
      .filter((s): s is string => s !== null)
      .join("  ·  ");
    this.header.content = `new thread — ${state.step}${summary ? `   [${summary}]` : ""}`;

    if (state.step === "prompt") {
      this.body.content = `> ${state.prompt}`;
      this.footer.content = "type your first message · enter send · esc back";
      return;
    }

    const choices = stepChoices(state);
    this.body.content =
      choices.length === 0
        ? "loading…"
        : choices.map((c, i) => `${i === state.cursor ? ">" : " "} ${c.label}`).join("\n");
    this.footer.content = "↑/↓ move · enter select · esc back";
  }
}

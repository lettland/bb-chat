import { BoxRenderable, type KeyEvent, TextRenderable } from "@opentui/core";
import { listModels, listProviders, spawnThread } from "../../bb/providers.ts";
import type { BBSdk } from "../../bb/sdk.ts";
import { InputBuffer } from "../input-buffer.ts";
import type { View, ViewHost } from "../navigator.ts";
import {
  applyPreset,
  buildSpawnParams,
  chooseMode,
  chooseModel,
  chooseProvider,
  highlighted,
  initWizard,
  moveCursor,
  type PermissionMode,
  type SpawnPreset,
  setModels,
  setPrompt,
  stepChoices,
  toModelChoices,
  toProviderChoices,
  type WizardState,
} from "../spawn-wizard.ts";
import { palette, toneColor } from "../theme.ts";
import { errorText } from "../util.ts";
import { ListPanel, Screen } from "./chrome.ts";
import { ThreadView } from "./thread-view.ts";

const STEPS = ["provider", "model", "mode", "prompt"] as const;
const SELECT_HINTS = "↑/↓ move · enter select · esc back";
const PROMPT_HINTS = "type your first message · enter send · esc back";

/**
 * Fast-forward a fresh wizard to the shorthand preset: fetch the preset provider's
 * models, then `applyPreset`. A missing provider or a models-fetch failure leaves
 * the wizard un-seeded (plain flow), reporting the failure via the returned error.
 */
async function seedWizardPreset(
  sdk: BBSdk,
  base: WizardState,
  preset: SpawnPreset | null,
): Promise<{ state: WizardState; error?: string }> {
  if (!preset || !base.providers.some((p) => p.id === preset.providerId)) return { state: base };
  try {
    const models = toModelChoices(await listModels(sdk, preset.providerId));
    return { state: applyPreset(base, models, preset) };
  } catch (error) {
    return { state: base, error: `error loading models: ${errorText(error)}` };
  }
}

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
  private screen: Screen | null = null;
  private panel: ListPanel | null = null;
  private promptBox: BoxRenderable | null = null;
  private promptText: TextRenderable | null = null;
  private state: WizardState | null = null;
  private readonly input = new InputBuffer();
  private busy = false;

  constructor(
    private readonly sdk: BBSdk,
    // The project id is resolved lazily on submit so the wizard opening (and
    // cancelling) never creates a project — only actually spawning a thread does.
    private readonly resolveProjectId: () => Promise<{ id: string; name: string }>,
    // New-thread defaults from the `bbchat <provider> …` shorthand, pre-seeded on mount.
    private readonly preset: SpawnPreset | null = null,
  ) {}

  async mount(host: ViewHost): Promise<void> {
    this.host = host;
    const p = palette();
    const screen = new Screen(host.renderer, { title: "new thread", hints: SELECT_HINTS });
    this.panel = new ListPanel(host.renderer);
    this.panel.showMessage("loading providers…");
    screen.content.add(this.panel.root);

    // The prompt step's composer; hidden until the selection steps are done.
    this.promptBox = new BoxRenderable(host.renderer, {
      border: true,
      borderStyle: "rounded",
      borderColor: p.border.focus,
      title: " first message ",
      titleColor: toneColor("system"),
      height: 3,
      flexShrink: 0,
      visible: false,
    });
    this.promptText = new TextRenderable(host.renderer, { content: "" });
    this.promptBox.add(this.promptText);
    screen.content.add(this.promptBox);

    this.screen = screen;
    this.box = screen.outer;
    host.renderer.root.add(screen.outer);

    try {
      const providers = toProviderChoices(await listProviders(this.sdk));
      const seeded = await seedWizardPreset(this.sdk, initWizard(providers), this.preset);
      this.state = seeded.state;
      if (seeded.error) this.screen?.setStatus(seeded.error, "error");
      this.render();
    } catch (error) {
      this.panel?.showMessage(`error loading providers: ${errorText(error)}`, "error");
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
    this.promptBox = null;
    this.promptText = null;
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
        this.screen?.setStatus(`error loading models: ${errorText(error)}`, "error");
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
    this.screen?.setStatus("creating thread…");
    try {
      const project = await this.resolveProjectId();
      const params = buildSpawnParams(setPrompt(this.state, text), project.id);
      const threadId = await spawnThread(this.sdk, params);
      if (threadId) {
        await this.host.navigator.replace(new ThreadView(this.sdk, threadId, "new thread"));
        return;
      }
      this.screen?.setStatus("spawn returned no thread id", "error");
    } catch (error) {
      this.screen?.setStatus(`spawn failed: ${errorText(error)}`, "error");
    } finally {
      this.busy = false;
    }
  }

  private render(): void {
    const state = this.state;
    const { screen, panel, promptBox, promptText } = this;
    if (!state || !screen || !panel || !promptBox || !promptText) return;

    const stepNo = STEPS.indexOf(state.step) + 1;
    screen.setTitle("new thread", `step ${stepNo}/${STEPS.length} · ${state.step}`);
    screen.setContext([
      state.provider?.label ?? "",
      state.model?.label ?? "",
      state.reasoning ?? "",
      state.mode ?? "",
    ]);

    if (state.step === "prompt") {
      panel.root.visible = false;
      promptBox.visible = true;
      promptText.content = `❯ ${state.prompt}`;
      screen.setHints(PROMPT_HINTS);
      return;
    }

    panel.root.visible = true;
    promptBox.visible = false;
    screen.setHints(SELECT_HINTS);
    const choices = stepChoices(state);
    if (choices.length === 0) {
      panel.showMessage("loading…");
      return;
    }
    panel.setItems(
      choices.map((c) => c.label),
      "nothing to choose",
      state.cursor,
    );
  }
}

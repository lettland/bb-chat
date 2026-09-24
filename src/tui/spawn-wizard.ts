/**
 * Pure state machine for the new-thread spawn wizard: provider → model → mode →
 * prompt. Holds no SDK or renderer state; the view fetches models between the
 * provider and model steps and feeds them in. All transitions are pure and
 * testable.
 */

export const PERMISSION_MODES = ["accept-edits", "auto", "full"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/**
 * Reasoning levels BB accepts on spawn. Mirrors bb-app's `reasoningLevelSchema`
 * (node_modules/bb-app/dist/index.d.ts) — re-sync this list if BB's enum changes;
 * BB still validates the value server-side, so drift only affects local errors.
 */
export const REASONING_LEVELS = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "ultracode",
  "max",
  "ultra",
] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export interface Choice {
  /** The value passed to the SDK (provider id / model id / mode). */
  id: string;
  /** Human-readable label shown in the list. */
  label: string;
}

export type WizardStep = "provider" | "model" | "mode" | "environment" | "prompt";

export interface WizardState {
  step: WizardStep;
  cursor: number;
  providers: Choice[];
  models: Choice[];
  environments: Choice[];
  provider: Choice | null;
  model: Choice | null;
  mode: PermissionMode | null;
  environmentId: string | null;
  /** Reasoning level, carried from a shorthand preset (no interactive step yet). */
  reasoning: string | null;
  prompt: string;
}

export const MODE_CHOICES: Choice[] = PERMISSION_MODES.map((mode) => ({ id: mode, label: mode }));

export interface SpawnParams {
  projectId: string;
  providerId: string | null;
  model: string | null;
  permissionMode: PermissionMode | null;
  reasoningLevel: string | null;
  prompt: string;
  environmentId?: string;
}

/** Pre-selected new-thread options resolved from the `bbchat <provider> …` shorthand. */
export interface SpawnPreset {
  providerId: string;
  model: string | null;
  reasoningLevel: string | null;
  permissionMode: PermissionMode | null;
}

function str(rec: Record<string, unknown>, key: string): string {
  const value = rec[key];
  return typeof value === "string" ? value : "";
}

/** Normalize `providers.list()` entries into selectable choices (defensive). */
export function toProviderChoices(list: readonly unknown[]): Choice[] {
  const out: Choice[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    if (rec.available === false) continue;
    const id = str(rec, "id") || str(rec, "providerId");
    if (!id) continue;
    out.push({ id, label: str(rec, "name") || str(rec, "displayName") || id });
  }
  return out;
}

/** Normalize `providers.models().models` entries into selectable choices (defensive). */
export function toModelChoices(models: readonly unknown[]): Choice[] {
  const out: Choice[] = [];
  for (const entry of models) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const id = str(rec, "id") || str(rec, "model");
    if (!id) continue;
    out.push({ id, label: str(rec, "displayName") || str(rec, "model") || id });
  }
  return out;
}

export function initWizard(providers: Choice[]): WizardState {
  return {
    step: "provider",
    cursor: 0,
    providers,
    models: [],
    environments: [],
    provider: null,
    model: null,
    mode: null,
    environmentId: null,
    reasoning: null,
    prompt: "",
  };
}

/**
 * Fast-forward a fresh wizard to a shorthand preset. Unlike chooseModel/chooseMode
 * (which couple set-value with advance-step), this sets every matched field
 * unconditionally and computes the landing step independently, so a mode-without-
 * model preset still lands on the model step. Missing ids (a stale/removed provider
 * or model) are skipped, degrading to the plain wizard rather than crashing.
 */
export function applyPreset(base: WizardState, models: Choice[], preset: SpawnPreset): WizardState {
  const provider = base.providers.find((p) => p.id === preset.providerId);
  if (!provider) return base;
  const model = preset.model !== null ? (models.find((m) => m.id === preset.model) ?? null) : null;
  const mode = preset.permissionMode;
  const step: WizardStep = model === null ? "model" : mode === null ? "mode" : "prompt";
  return {
    ...base,
    provider,
    models,
    model,
    mode,
    reasoning: preset.reasoningLevel,
    step,
    cursor: 0,
  };
}

/** The selectable choices for the current step (empty on the free-text prompt step). */
export function stepChoices(state: WizardState): Choice[] {
  switch (state.step) {
    case "provider":
      return state.providers;
    case "model":
      return state.models;
    case "mode":
      return MODE_CHOICES;
    case "environment":
      return state.environments;
    case "prompt":
      return [];
  }
}

export function moveCursor(state: WizardState, delta: number): WizardState {
  const choices = stepChoices(state);
  if (choices.length === 0) return state;
  const cursor = Math.max(0, Math.min(choices.length - 1, state.cursor + delta));
  return { ...state, cursor };
}

/** The choice under the cursor for the current step, or null. */
export function highlighted(state: WizardState): Choice | null {
  return stepChoices(state)[state.cursor] ?? null;
}

export function chooseProvider(state: WizardState, provider: Choice): WizardState {
  return { ...state, provider, step: "model", cursor: 0, models: [] };
}

export function setModels(state: WizardState, models: Choice[]): WizardState {
  return { ...state, models, cursor: 0 };
}

export function chooseModel(state: WizardState, model: Choice): WizardState {
  return { ...state, model, step: "mode", cursor: 0 };
}

export function chooseMode(state: WizardState, mode: PermissionMode): WizardState {
  return {
    ...state,
    mode,
    step: state.environments.length > 1 ? "environment" : "prompt",
    cursor: 0,
  };
}

/** Add existing BB environments without creating a project or workspace. */
export function setEnvironments(state: WizardState, environments: Choice[]): WizardState {
  return {
    ...state,
    environments,
    step: state.step === "prompt" && environments.length > 1 ? "environment" : state.step,
    cursor: 0,
  };
}

export function chooseEnvironment(state: WizardState, choice: Choice): WizardState {
  return {
    ...state,
    environmentId: choice.id === "default" ? null : choice.id,
    step: "prompt",
    cursor: 0,
  };
}

export function setPrompt(state: WizardState, prompt: string): WizardState {
  return { ...state, prompt };
}

/** Whether the wizard has everything it needs to spawn. */
export function isComplete(state: WizardState): boolean {
  return state.step === "prompt" && state.prompt.trim().length > 0;
}

/** Build spawn params from a completed wizard. */
export function buildSpawnParams(state: WizardState, projectId: string): SpawnParams {
  return {
    projectId,
    providerId: state.provider?.id ?? null,
    model: state.model?.id ?? null,
    permissionMode: state.mode,
    reasoningLevel: state.reasoning,
    prompt: state.prompt.trim(),
    ...(state.environmentId ? { environmentId: state.environmentId } : {}),
  };
}

/**
 * Pure state machine for the new-thread spawn wizard: provider → model → mode →
 * prompt. Holds no SDK or renderer state; the view fetches models between the
 * provider and model steps and feeds them in. All transitions are pure and
 * testable.
 */

export const PERMISSION_MODES = ["accept-edits", "auto", "full"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export interface Choice {
  /** The value passed to the SDK (provider id / model id / mode). */
  id: string;
  /** Human-readable label shown in the list. */
  label: string;
}

export type WizardStep = "provider" | "model" | "mode" | "prompt";

export interface WizardState {
  step: WizardStep;
  cursor: number;
  providers: Choice[];
  models: Choice[];
  provider: Choice | null;
  model: Choice | null;
  mode: PermissionMode | null;
  prompt: string;
}

export const MODE_CHOICES: Choice[] = PERMISSION_MODES.map((mode) => ({ id: mode, label: mode }));

export interface SpawnParams {
  projectId: string;
  providerId: string | null;
  model: string | null;
  permissionMode: PermissionMode | null;
  prompt: string;
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
    provider: null,
    model: null,
    mode: null,
    prompt: "",
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
  return { ...state, mode, step: "prompt", cursor: 0 };
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
    prompt: state.prompt.trim(),
  };
}

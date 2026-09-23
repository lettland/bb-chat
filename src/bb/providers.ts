import type { ReasoningLevel } from "bb-app";
import type { PermissionMode, SpawnParams } from "../tui/spawn-wizard.ts";
import type { BBSdk } from "./sdk.ts";

/** List available providers for the host. */
export function listProviders(sdk: BBSdk): Promise<unknown[]> {
  return sdk.providers.list({}) as Promise<unknown[]>;
}

/** List a provider's models (from the execution-options response). */
export async function listModels(sdk: BBSdk, providerId: string): Promise<unknown[]> {
  const response = await sdk.providers.models({ providerId });
  const models = (response as { models?: unknown }).models;
  return Array.isArray(models) ? models : [];
}

function permissionModeArg(mode: PermissionMode | null): { permissionMode?: PermissionMode } {
  return mode ? { permissionMode: mode } : {};
}

/**
 * Spawn a new thread from wizard/CLI params. Uses the project's default
 * environment (`{ type: "project-default" }`); richer environment selection lands
 * later. Returns the new thread id, or null if the response shape was unexpected.
 *
 * providerId and model are omitted when null: BB resolves them server-side
 * (verified in bb's thread-default-policy resolveCreateThreadExecutionDefaults —
 * requested ?? project stored default ?? first available provider; it errors only
 * when no provider exists at all). So `bbchat new "prompt"` with no flags is valid.
 */
export async function spawnThread(sdk: BBSdk, params: SpawnParams): Promise<string | null> {
  const response = await sdk.threads.spawn({
    projectId: params.projectId,
    ...(params.providerId ? { providerId: params.providerId } : {}),
    ...(params.model ? { model: params.model } : {}),
    ...permissionModeArg(params.permissionMode),
    ...(params.reasoningLevel ? { reasoningLevel: params.reasoningLevel as ReasoningLevel } : {}),
    environment: { type: "project-default" },
    prompt: params.prompt,
  });
  const rec = response as { threadId?: unknown; id?: unknown };
  const id = typeof rec.threadId === "string" ? rec.threadId : rec.id;
  return typeof id === "string" ? id : null;
}

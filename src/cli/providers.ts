import { ensureServer } from "../bb/ensure-server.ts";
import { listModels, listProviders } from "../bb/providers.ts";
import { createSdk } from "../bb/sdk.ts";
import { resolveConfig } from "../config.ts";
import {
  PERMISSION_MODES,
  REASONING_LEVELS,
  toModelChoices,
  toProviderChoices,
} from "../tui/spawn-wizard.ts";

/**
 * `vch providers` — list the providers, their models, the reasoning levels, and
 * the permission modes: the valid values for `vch new` and the `vch <provider> …`
 * shorthand. Read-only.
 */
export async function runProviders(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const config = await resolveConfig(env);
  const server = await ensureServer(config);
  const sdk = createSdk(server.serverUrl);

  const providers = toProviderChoices(await listProviders(sdk));
  const lines: string[] = ["Providers and models (for vch new):", ""];
  if (providers.length === 0) {
    lines.push("  (no providers available)");
  }
  for (const provider of providers) {
    lines.push(`  --provider ${provider.id}   (${provider.label})`);
    try {
      const models = toModelChoices(await listModels(sdk, provider.id));
      lines.push(
        models.length > 0
          ? `      --model ${models.map((m) => m.id).join(" | ")}`
          : "      (no models)",
      );
    } catch {
      lines.push("      (models unavailable)");
    }
  }
  lines.push(
    "",
    `Reasoning levels: --reasoning ${REASONING_LEVELS.join(" | ")}`,
    `Permission modes: --mode ${PERMISSION_MODES.join(" | ")}`,
  );
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

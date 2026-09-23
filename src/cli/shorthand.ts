/**
 * Resolves the `bbchat <provider> [model] [reasoning] [mode]` shorthand. Argv tokens
 * are fuzzy-matched against the server's live provider/model lists and the fixed
 * reasoning/mode enums; every resolved field is a value drawn from those lists, so
 * a raw token never reaches `threads.spawn`. Matching is case-insensitive and
 * rejects empty tokens (guarding `"".endsWith`/`"".includes`, which are always
 * true). Bad tokens produce a `BbchatError` with the valid options enumerated.
 */

import { listModels, listProviders } from "../bb/providers.ts";
import type { BBSdk } from "../bb/sdk.ts";
import { BbchatError } from "../errors.ts";
import {
  type Choice,
  PERMISSION_MODES,
  type PermissionMode,
  REASONING_LEVELS,
  type SpawnPreset,
  toModelChoices,
  toProviderChoices,
} from "../tui/spawn-wizard.ts";

export type Match<T> = { ok: true; value: T } | { ok: false; error: string };

function ok<T>(value: T): Match<T> {
  return { ok: true, value };
}
function fail(error: string): Match<never> {
  return { ok: false, error };
}
function norm(token: string): string {
  return token.trim().toLowerCase();
}
function ids(list: Choice[]): string {
  const out: string[] = [];
  for (const c of list) out.push(c.id);
  return out.join(", ");
}

/** One winner from a candidate tier: the single entry, else the single non-`acp-` one. */
function pickUnique(list: Choice[]): Choice | null {
  if (list.length === 1) return list[0] ?? null;
  if (list.length > 1) {
    const nonAcp = list.filter((c) => !c.id.startsWith("acp-"));
    if (nonAcp.length === 1) return nonAcp[0] ?? null;
  }
  return null;
}

/**
 * Resolve a provider alias. Priority: exact id → unique raw-id prefix → `acp-`
 * stripped exact → unique stripped-id/label prefix. Raw-id prefix comes before the
 * stripped tier so `claude` resolves to `claude-code` without `acp-claude-work`
 * (raw id starts with `acp`) making it ambiguous.
 */
export function matchProvider(providers: Choice[], token: string): Match<Choice> {
  const t = norm(token);
  if (t.length === 0) return fail("empty provider token");
  const strip = (id: string) => id.replace(/^acp-/, "");

  const exact = providers.find((p) => norm(p.id) === t);
  if (exact) return ok(exact);

  const rawPrefix = providers.filter((p) => norm(p.id).startsWith(t));
  const raw = pickUnique(rawPrefix);
  if (raw) return ok(raw);

  const strippedExact = providers.filter((p) => strip(norm(p.id)) === t);
  const se = pickUnique(strippedExact);
  if (se) return ok(se);

  const other = providers.filter(
    (p) => strip(norm(p.id)).startsWith(t) || norm(p.label).startsWith(t),
  );
  const oth = pickUnique(other);
  if (oth) return ok(oth);

  const candidates =
    rawPrefix.length > 0 ? rawPrefix : strippedExact.length > 0 ? strippedExact : other;
  if (candidates.length > 1) {
    return fail(`ambiguous provider "${token}": ${ids(candidates)} — be more specific`);
  }
  return fail(
    `unknown provider "${token}". available: ${ids(providers)} (see 'bbchat providers'; for a command see 'bbchat help')`,
  );
}

/** Resolve a model alias within a provider: exact id → unique suffix → unique substring. */
export function matchModel(models: Choice[], token: string): Match<Choice> {
  const t = norm(token);
  if (t.length === 0) return fail("empty model token");

  const exact = models.find((m) => norm(m.id) === t);
  if (exact) return ok(exact);

  const ends = models.filter((m) => norm(m.id).endsWith(t));
  if (ends.length === 1 && ends[0]) return ok(ends[0]);

  const contains = models.filter((m) => norm(m.id).includes(t));
  if (contains.length === 1 && contains[0]) return ok(contains[0]);

  const cands = ends.length > 1 ? ends : contains;
  if (cands.length > 1) return fail(`ambiguous model "${token}": ${ids(cands)}`);
  return fail(`unknown model "${token}". models: ${ids(models)} (see 'bbchat providers')`);
}

export interface ResolvedOptions {
  model: string | null;
  reasoningLevel: string | null;
  permissionMode: PermissionMode | null;
}

/**
 * Classify each post-provider token as a reasoning level, a permission mode, or a
 * model (order-independent). Each dimension may be set once; a second model,
 * reasoning, or mode token is an error, as is an unmatched token.
 */
export function resolveOptions(tokens: string[], models: Choice[]): Match<ResolvedOptions> {
  let model: string | null = null;
  let reasoningLevel: string | null = null;
  let permissionMode: PermissionMode | null = null;

  for (const raw of tokens) {
    const t = norm(raw);
    if (t.length === 0) return fail("empty option token");

    if ((REASONING_LEVELS as readonly string[]).includes(t)) {
      if (reasoningLevel) return fail(`two reasoning levels given: ${reasoningLevel} and ${t}`);
      reasoningLevel = t;
      continue;
    }
    if ((PERMISSION_MODES as readonly string[]).includes(t)) {
      if (permissionMode) return fail(`two modes given: ${permissionMode} and ${t}`);
      permissionMode = t as PermissionMode;
      continue;
    }
    const m = matchModel(models, raw);
    if (!m.ok) {
      return fail(
        `${m.error}; or a reasoning level (${REASONING_LEVELS.join("|")}) or mode (${PERMISSION_MODES.join("|")})`,
      );
    }
    if (model) return fail(`two models given: ${model} and ${m.value.id}`);
    model = m.value.id;
  }

  return ok({ model, reasoningLevel, permissionMode });
}

/**
 * Resolve shorthand tokens against the live server. Bad tokens throw `BbchatError`
 * (the command should abort with the message). A transport/API failure fetching
 * the provider or model lists returns `null` so the caller falls back to the plain
 * thread list — preserving parity with bare `bbchat` when BB briefly blips.
 */
export async function resolveSpawnShorthand(
  sdk: BBSdk,
  tokens: string[],
): Promise<SpawnPreset | null> {
  const [providerToken, ...optionTokens] = tokens;
  if (!providerToken) return null;

  let providers: Choice[];
  try {
    providers = toProviderChoices(await listProviders(sdk));
  } catch {
    return null;
  }
  const prov = matchProvider(providers, providerToken);
  if (!prov.ok) throw new BbchatError(prov.error);

  let models: Choice[];
  try {
    models = toModelChoices(await listModels(sdk, prov.value.id));
  } catch {
    return null;
  }
  const opt = resolveOptions(optionTokens, models);
  if (!opt.ok) throw new BbchatError(opt.error);

  return {
    providerId: prov.value.id,
    model: opt.value.model,
    reasoningLevel: opt.value.reasoningLevel,
    permissionMode: opt.value.permissionMode,
  };
}

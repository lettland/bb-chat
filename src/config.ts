import { homedir } from "node:os";
import { join } from "node:path";
import type { PartialVchConfig, VchConfig } from "./types.ts";

/** Default BB server URL (the launcher's default loopback bind). */
export const DEFAULT_SERVER_URL = "http://127.0.0.1:38886";

/** Directory holding `config.json`, honoring `XDG_CONFIG_HOME`. */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "vch");
}

/** Absolute path of the `vch` config file. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), "config.json");
}

/** The baseline config used when nothing else is specified. */
export function defaultConfig(): VchConfig {
  return {
    serverUrl: DEFAULT_SERVER_URL,
    bbCommand: null,
    startCommand: null,
    autoStart: false,
  };
}

/**
 * Interpret an environment value as an argv array: a JSON array (`["bb","start"]`)
 * is parsed as-is; any other non-empty string is split on whitespace. Empty or
 * whitespace-only yields `null`.
 */
export function parseCommand(raw: string | undefined): string[] | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
        return (parsed as string[]).filter((v) => v.length > 0);
      }
    } catch {
      // Fall through to whitespace splitting.
    }
  }
  const parts = value.split(/\s+/).filter((v) => v.length > 0);
  return parts.length > 0 ? parts : null;
}

function parseBool(raw: string | undefined): boolean | undefined {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value.length === 0) return undefined;
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  return undefined;
}

/** Overrides sourced from the process environment. `VCH_*` wins over `BB_*`. */
export function envOverrides(env: NodeJS.ProcessEnv = process.env): PartialVchConfig {
  const out: PartialVchConfig = {};
  const url = env.VCH_SERVER_URL?.trim() || env.BB_SERVER_URL?.trim();
  if (url) out.serverUrl = url;
  const bbCommand = parseCommand(env.VCH_BB_COMMAND);
  if (bbCommand) out.bbCommand = bbCommand;
  const startCommand = parseCommand(env.VCH_START_COMMAND);
  if (startCommand) out.startCommand = startCommand;
  const autoStart = parseBool(env.VCH_AUTO_START);
  if (autoStart !== undefined) out.autoStart = autoStart;
  return out;
}

/** Coerce arbitrary parsed JSON into a `PartialVchConfig`, ignoring unknown/invalid fields. */
export function normalizeConfig(raw: unknown): PartialVchConfig {
  if (!raw || typeof raw !== "object") return {};
  const rec = raw as Record<string, unknown>;
  const out: PartialVchConfig = {};
  if (typeof rec.serverUrl === "string" && rec.serverUrl.trim().length > 0) {
    out.serverUrl = rec.serverUrl.trim();
  }
  const bbCommand = normalizeStringArray(rec.bbCommand);
  if (bbCommand) out.bbCommand = bbCommand;
  const startCommand = normalizeStringArray(rec.startCommand);
  if (startCommand) out.startCommand = startCommand;
  if (typeof rec.autoStart === "boolean") out.autoStart = rec.autoStart;
  return out;
}

function normalizeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const parts = value.filter((v): v is string => typeof v === "string" && v.length > 0);
  return parts.length > 0 ? parts : null;
}

/** Merge layers in precedence order: defaults < file < env. */
export function mergeConfig(...layers: PartialVchConfig[]): VchConfig {
  let out = defaultConfig();
  for (const layer of layers) {
    out = { ...out, ...layer };
  }
  return out;
}

/** Read + normalize the config file. Returns `{}` when the file is absent or unreadable. */
export async function loadConfigFile(path: string): Promise<PartialVchConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  try {
    return normalizeConfig(await file.json());
  } catch {
    return {};
  }
}

/** Resolve the effective config from file + environment. */
export async function resolveConfig(env: NodeJS.ProcessEnv = process.env): Promise<VchConfig> {
  const fromFile = await loadConfigFile(configPath(env));
  return mergeConfig(fromFile, envOverrides(env));
}

/** Persist a config to `config.json`, creating the directory if needed. */
export async function writeConfigFile(
  config: VchConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const path = configPath(env);
  await Bun.write(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}

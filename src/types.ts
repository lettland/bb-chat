/**
 * Fully-resolved `bbchat` configuration. Every field is concrete after resolution
 * (defaults < config file < environment). Commands are argv arrays, never shell
 * strings, so they are executed without a shell.
 */
export interface BbchatConfig {
  /** Base URL of the BB server to connect to. */
  serverUrl: string;
  /** Path/argv of a `bb`-family executable, for detection/reference. `null` if unknown. */
  bbCommand: string[] | null;
  /** argv used to launch BB when it is down and `autoStart` is enabled. `null` = never launch. */
  startCommand: string[] | null;
  /** Whether `bbchat` may launch BB via `startCommand` when the server is unreachable. */
  autoStart: boolean;
}

/** A config with any subset of fields present (file contents, env overrides). */
export type PartialBbchatConfig = Partial<BbchatConfig>;

/** Parsed response of `GET {serverUrl}/health`. */
export interface HealthStatus {
  ok: boolean;
  launchId: string | null;
}

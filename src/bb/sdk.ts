import { BBSdk } from "bb-app";

/**
 * Construct a BB SDK client bound to a server URL. `bbchat` consumes only the
 * published `bb-app` public SDK — it never hand-rolls BB URLs or schemas. This
 * is the single seam where the SDK is instantiated, so swapping the underlying
 * client later is a one-file change.
 */
export function createSdk(baseUrl: string): BBSdk {
  return new BBSdk({ baseUrl });
}

export type { BBSdk };

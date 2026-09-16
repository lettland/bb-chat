import type { HealthStatus } from "../types.ts";

/** Build the `/health` URL for a server base URL. */
export function healthUrl(serverUrl: string): string {
  return new URL("/health", serverUrl).toString();
}

/** Interpret a parsed `/health` JSON body defensively. */
export function parseHealth(body: unknown): HealthStatus {
  if (body && typeof body === "object") {
    const rec = body as Record<string, unknown>;
    return {
      ok: rec.ok === true,
      launchId: typeof rec.launchId === "string" ? rec.launchId : null,
    };
  }
  return { ok: false, launchId: null };
}

export interface ProbeOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Probe `GET {serverUrl}/health`. Never throws: any network error, timeout, or
 * non-2xx response resolves to `{ ok: false, launchId: null }`. This is a
 * read-only reachability check and must never disturb a running server.
 */
export async function probeHealth(
  serverUrl: string,
  opts: ProbeOptions = {},
): Promise<HealthStatus> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 2000);
  try {
    const res = await fetchImpl(healthUrl(serverUrl), { signal: controller.signal });
    if (!res.ok) return { ok: false, launchId: null };
    return parseHealth(await res.json());
  } catch {
    return { ok: false, launchId: null };
  } finally {
    clearTimeout(timer);
  }
}

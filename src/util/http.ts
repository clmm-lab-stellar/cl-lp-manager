// SPDX-License-Identifier: Apache-2.0
// Read-only HTTP helper: per-host minimum interval (session rule 7: <= 2 req/s on
// public endpoints), retries with backoff on 429/5xx, and an optional on-disk cache
// keyed by sha256(method + url + body) so captures can be re-run without re-fetching.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface FetchOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** Directory for the response cache. Omit to disable caching. */
  cacheDir?: string;
  /** Minimum milliseconds between requests to the same host. Default 600. */
  minIntervalMs?: number;
  retries?: number;
}

const lastCall = new Map<string, number>();

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function throttle(host: string, minIntervalMs: number): Promise<void> {
  const now = Date.now();
  const last = lastCall.get(host) ?? 0;
  const wait = last + minIntervalMs - now;
  if (wait > 0) await sleep(wait);
  lastCall.set(host, Date.now());
}

export function cacheKey(method: string, url: string, body: unknown): string {
  return createHash("sha256")
    .update(`${method} ${url} ${body === undefined ? "" : JSON.stringify(body)}`)
    .digest("hex");
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const key = cacheKey(method, url, opts.body);
  if (opts.cacheDir) {
    const p = join(opts.cacheDir, `${key}.json`);
    if (existsSync(p)) return (JSON.parse(readFileSync(p, "utf8")) as { response: T }).response;
  }
  const host = new URL(url).host;
  const retries = opts.retries ?? 7;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host, opts.minIntervalMs ?? 600);
    try {
      const init: RequestInit = {
        method,
        headers: { accept: "application/json", "user-agent": "sik-cl-lp-manager/0.0 (read-only research)" },
      };
      if (opts.body !== undefined) {
        init.body = JSON.stringify(opts.body);
        init.headers = { ...init.headers, "content-type": "application/json" };
      }
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) {
        // 4xx other than 429 is not retryable: surface it at once (callers may split ranges on 413).
        const err = new Error(`HTTP ${res.status} for ${url}: ${(await res.text()).slice(0, 200)}`);
        (err as Error & { fatal?: boolean }).fatal = true;
        throw err;
      }
      const json = (await res.json()) as T;
      if (opts.cacheDir) {
        mkdirSync(opts.cacheDir, { recursive: true });
        writeFileSync(
          join(opts.cacheDir, `${key}.json`),
          JSON.stringify({ url, method, body: opts.body ?? null, fetchedAt: new Date().toISOString(), response: json }),
        );
      }
      return json;
    } catch (e) {
      if ((e as Error & { fatal?: boolean }).fatal) throw e;
      lastErr = e;
      if (attempt < retries) await sleep(Math.min(1500 * 2 ** attempt, 60_000));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

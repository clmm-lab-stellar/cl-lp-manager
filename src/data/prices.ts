// SPDX-License-Identifier: Apache-2.0
// Spot USD prices from DefiLlama's coins API (keys "stellar:<contract>"). Used only to express
// results in USD at capture time; backtests run in pool token units.
import { fetchJson } from "../util/http.ts";

export async function usdPrices(contracts: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < contracts.length; i += 40) {
    const keys = contracts.slice(i, i + 40).map((c) => `stellar:${c}`);
    const d = await fetchJson<{ coins: Record<string, { price: number }> }>(
      `https://coins.llama.fi/prices/current/${keys.join(",")}`,
      { minIntervalMs: 1000 },
    );
    for (const [k, v] of Object.entries(d.coins)) out.set(k.replace(/^stellar:/, ""), v.price);
  }
  return out;
}

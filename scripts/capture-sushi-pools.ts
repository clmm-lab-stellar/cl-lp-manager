// SPDX-License-Identifier: Apache-2.0
// CLP-002: list every Sushi Stellar V3 pool from the factory's pool_created events, read token
// metadata and reserves by read-only RPC simulation, value reserves at DefiLlama spot prices.
// Output: fixtures/sushi/pools.json (+ .provenance.json). Read-only; nothing is signed or sent.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listSushiPools, SUSHI_FACTORY } from "../src/data/sushi.ts";
import { MAINNET_RPC, STELLAR_EXPERT, tokenBalance, tokenMeta } from "../src/data/stellar.ts";
import { usdPrices } from "../src/data/prices.ts";

const root = new URL("..", import.meta.url).pathname;
const outDir = join(root, "fixtures", "sushi");
const cacheDir = join(root, ".cache", "http");
mkdirSync(outDir, { recursive: true });

const { pools, protocolFeeEvents } = await listSushiPools(cacheDir);
process.stderr.write(`pools: ${pools.length}\n`);
const tokens = [...new Set(pools.flatMap((p) => [p.token0, p.token1]))];
const meta = new Map<string, { symbol: string; decimals: number }>();
for (const t of tokens) {
  try {
    meta.set(t, await tokenMeta(t));
  } catch (e) {
    meta.set(t, { symbol: "?", decimals: 7 });
    process.stderr.write(`meta ${t}: ${(e as Error).message}\n`);
  }
}
const prices = await usdPrices(tokens);

const rows = [];
for (const p of pools) {
  const m0 = meta.get(p.token0)!;
  const m1 = meta.get(p.token1)!;
  let r0 = 0n;
  let r1 = 0n;
  try {
    r0 = await tokenBalance(p.token0, p.pool);
    r1 = await tokenBalance(p.token1, p.pool);
  } catch (e) {
    process.stderr.write(`balance ${p.pool}: ${(e as Error).message}\n`);
  }
  const h0 = Number(r0) / 10 ** m0.decimals;
  const h1 = Number(r1) / 10 ** m1.decimals;
  const p0 = prices.get(p.token0);
  const p1 = prices.get(p.token1);
  const tvl = p0 !== undefined && p1 !== undefined ? h0 * p0 + h1 * p1 : null;
  rows.push({
    ...p,
    symbol0: m0.symbol,
    symbol1: m1.symbol,
    decimals0: m0.decimals,
    decimals1: m1.decimals,
    reserve0: h0,
    reserve1: h1,
    usd0: p0 ?? null,
    usd1: p1 ?? null,
    tvlUsd: tvl,
  });
}
rows.sort((a, b) => (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1));
const capturedAt = new Date().toISOString();
writeFileSync(join(outDir, "pools.json"), JSON.stringify({ capturedAt, factory: SUSHI_FACTORY, protocolFeeEvents, pools: rows }, null, 1));
writeFileSync(
  join(outDir, "pools.provenance.json"),
  JSON.stringify(
    {
      capturedAt,
      script: "scripts/capture-sushi-pools.ts",
      sources: [
        `${STELLAR_EXPERT}/contract/${SUSHI_FACTORY}/events (pool_created, set_protocol_fee)`,
        `${MAINNET_RPC} simulateTransaction: token.symbol/decimals/balance(pool) (read-only, not submitted)`,
        "https://coins.llama.fi/prices/current/stellar:<contract> (spot USD at capture)",
        "Factory address: https://github.com/DefiLlama/DefiLlama-Adapters/blob/main/projects/sushi-stellar/index.js (FACTORY)",
      ],
      notes: ["TVL = reserve0*usd0 + reserve1*usd1 at capture time; null when DefiLlama has no price for a token."],
    },
    null,
    1,
  ),
);
const total = rows.reduce((s, r) => s + (r.tvlUsd ?? 0), 0);
process.stdout.write(`total priced TVL $${total.toFixed(0)}\n`);
for (const r of rows.slice(0, 15)) {
  process.stdout.write(`${r.pool} ${r.symbol0}/${r.symbol1} fee=${r.feePpm} tvl=${r.tvlUsd?.toFixed(0)}\n`);
}

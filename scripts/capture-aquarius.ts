// SPDX-License-Identifier: Apache-2.0
// CLP-002: Aquarius concentrated pools. Captures (1) the pool list, (2) 30 days of hourly
// volume/liquidity per pool, (3) swap events for the same window from the GeckoTerminal feed,
// for pools above MIN_TVL_USD. Also reads get_active_liquidity() now by read-only simulation to
// cross-check the inferred L. Usage: node scripts/capture-aquarius.ts [days=30] [minTvlUsd=10000]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AQUA_API,
  AQUA_USD_SCALE,
  geckoEvents,
  geckoToSwaps,
  latestBlock,
  listConcentratedPools,
  poolHourlyStats,
  type AquaHourStat,
  type GeckoEvent,
} from "../src/data/aquarius.ts";
import { MAINNET_RPC, simulateView, tokenMeta } from "../src/data/stellar.ts";
import { usdPrices } from "../src/data/prices.ts";
import { toFile, type PoolHistory } from "../src/types.ts";

const root = new URL("..", import.meta.url).pathname;
const days = Number(process.argv[2] ?? 30);
const minTvl = Number(process.argv[3] ?? 10_000);
const outDir = join(root, "fixtures", "aquarius");
mkdirSync(outDir, { recursive: true });
const capturedAt = new Date().toISOString();

const pools = await listConcentratedPools();
const statsByPool: Record<string, { hours: number; volumeUsd30d: number; liquidityUsdLast: number }> = {};
for (const p of pools) {
  // Resumable: reuse an hourly file captured within the last 6 hours.
  const hf = join(outDir, `${p.address}.hourly.json`);
  const cached = existsSync(hf) ? (JSON.parse(readFileSync(hf, "utf8")) as { capturedAt: string; items: AquaHourStat[] }) : null;
  const fresh = cached !== null && Date.now() - Date.parse(cached.capturedAt) < 6 * 3600_000;
  const hs = fresh ? cached.items : await poolHourlyStats(p.address);
  const vol = hs.reduce((s, h) => s + Number(h.volume_usd) / AQUA_USD_SCALE, 0);
  statsByPool[p.address] = {
    hours: hs.length,
    volumeUsd30d: vol,
    liquidityUsdLast: Number(hs[0]?.liquidity_usd ?? 0) / AQUA_USD_SCALE,
  };
  if (!fresh) writeFileSync(hf, JSON.stringify({ capturedAt, source: `${AQUA_API}/statistics/pool/${p.address}/`, items: hs }));
}
writeFileSync(
  join(outDir, "pools.json"),
  JSON.stringify({ capturedAt, source: `${AQUA_API}/pools/?pool_type=concentrated&size=100`, usdScale: AQUA_USD_SCALE, items: pools, stats: statsByPool }, null, 1),
);
process.stderr.write(`pools: ${pools.length}, hourly stats captured\n`);

const selected = pools.filter((p) => Number(p.liquidity_usd) / AQUA_USD_SCALE >= minTvl);
const selectedSet = new Set(selected.map((p) => p.address));
const clSet = new Set(pools.map((p) => p.address));
const chunkDir = join(root, ".cache", "aqua-chunks");
mkdirSync(chunkDir, { recursive: true });
// Chunk boundaries are aligned to multiples of 5000 so cached chunks are reusable across runs.
const latest = await latestBlock();
const span = Math.round((days * 86400) / 5); // ~5 s ledgers
const from = Math.floor((latest.blockNumber - span) / 5000) * 5000;
const byPool = new Map<string, GeckoEvent[]>();
let total = 0;
for (let a = from; a <= latest.blockNumber; a += 5000) {
  const b = Math.min(a + 4999, latest.blockNumber);
  // Resumable: each 5000-ledger chunk is cached (CL-pool events only) under .cache/aqua-chunks.
  const chunkFile = join(chunkDir, `${a}-${b}.json`);
  let evs: GeckoEvent[];
  if (existsSync(chunkFile)) evs = JSON.parse(readFileSync(chunkFile, "utf8")) as GeckoEvent[];
  else {
    evs = (await geckoEvents(a, b)).filter((e) => clSet.has(e.pairId));
    writeFileSync(chunkFile, JSON.stringify(evs));
  }
  total += evs.length;
  for (const e of evs) {
    if (!selectedSet.has(e.pairId)) continue;
    const arr = byPool.get(e.pairId) ?? [];
    arr.push(e);
    byPool.set(e.pairId, arr);
  }
  process.stderr.write(`  ledgers ${a}-${b}: ${evs.length} events (total ${total})\n`);
}

const tokens = [...new Set(selected.flatMap((p) => p.tokens_addresses))];
const prices = await usdPrices(tokens);
for (const p of selected) {
  const evs = (byPool.get(p.address) ?? []).sort(
    (x, y) =>
      x.block.blockNumber - y.block.blockNumber || (x.txnIndex ?? 0) - (y.txnIndex ?? 0) || (x.eventIndex ?? 0) - (y.eventIndex ?? 0),
  );
  const fee = Number(p.fee);
  const swaps = geckoToSwaps(evs, fee);
  const [a0, a1] = p.tokens_addresses as [string, string];
  const m0 = await tokenMeta(a0).catch(() => ({ symbol: p.tokens_str[0]?.split(":")[0] ?? "?", decimals: 7 }));
  const m1 = await tokenMeta(a1).catch(() => ({ symbol: p.tokens_str[1]?.split(":")[0] ?? "?", decimals: 7 }));
  let activeL: string = "unread";
  try {
    activeL = String(await simulateView(p.address, "get_active_liquidity"));
  } catch (e) {
    activeL = `error: ${(e as Error).message.split("\n")[0]}`;
  }
  const counts = { swap: 0, join: 0, exit: 0 } as Record<string, number>;
  for (const e of evs) counts[e.eventType] = (counts[e.eventType] ?? 0) + 1;
  const h: PoolHistory = {
    schema: "clp.pool-history.v1",
    venue: "aquarius-cl",
    pool: p.address,
    token0: { address: a0, ...m0 },
    token1: { address: a1, ...m1 },
    feePpm: Math.round(fee * 1e6),
    protocolFeeShare: 0,
    tickSpacing: null,
    window: { fromTs: latest.blockTimestamp - days * 86400, toTs: latest.blockTimestamp, fromLedger: from, toLedger: latest.blockNumber },
    token1UsdAtCapture: prices.get(a1) ?? null,
    tvlUsdAtCapture: Number(p.liquidity_usd) / AQUA_USD_SCALE,
    swaps,
    provenance: {
      capturedAt,
      script: "scripts/capture-aquarius.ts",
      sources: [
        `${AQUA_API}/api/external/gecko-terminal/events/?fromBlock=${from}&toBlock=${latest.blockNumber} (5000-ledger chunks)`,
        `${AQUA_API}/pools/?pool_type=concentrated`,
        `${MAINNET_RPC} simulateTransaction get_active_liquidity (read-only)`,
      ],
      notes: [
        `event counts: ${JSON.stringify(counts)}`,
        `get_active_liquidity() raw at capture: ${activeL}`,
        "liquidity per swap is INFERRED from consecutive prices (src/data/aquarius.ts geckoToSwaps)",
        "protocolFeeShare assumed 0 [U]: Aquarius fee split not read",
      ],
    },
  };
  writeFileSync(join(outDir, `${p.address}.history.json`), JSON.stringify(toFile(h)));
  process.stdout.write(`${p.address} ${m0.symbol}/${m1.symbol} fee=${fee}: ${swaps.length} swaps, activeL=${activeL}\n`);
}

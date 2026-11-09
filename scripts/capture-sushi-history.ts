// SPDX-License-Identifier: Apache-2.0
// CLP-002: capture swap history for the top Sushi Stellar pools (by TVL in fixtures/sushi/pools.json)
// from StellarExpert contract events, over the last DAYS days (default 30).
// Usage: node scripts/capture-sushi-history.ts [topN=7] [days=30]
// Output: fixtures/sushi/<pool>.history.json (PoolHistoryFile, provenance embedded).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeSushiSwap } from "../src/data/sushi.ts";
import { expertContractEvents, simulateView, STELLAR_EXPERT } from "../src/data/stellar.ts";
import { toFile, type PoolHistory, type Swap } from "../src/types.ts";

const root = new URL("..", import.meta.url).pathname;
const topN = Number(process.argv[2] ?? 7);
const days = Number(process.argv[3] ?? 30);
const cacheDir = join(root, ".cache", "http");
const poolsFile = JSON.parse(readFileSync(join(root, "fixtures", "sushi", "pools.json"), "utf8")) as {
  pools: {
    pool: string;
    token0: string;
    token1: string;
    symbol0: string;
    symbol1: string;
    decimals0: number;
    decimals1: number;
    feePpm: number;
    tickSpacing: number;
    usd1: number | null;
    tvlUsd: number | null;
  }[];
};

const nowTs = Math.floor(Date.now() / 1000);
const sinceTs = nowTs - days * 86400;
for (const p of poolsFile.pools.slice(0, topN)) {
  const t0 = { address: p.token0, symbol: p.symbol0, decimals: p.decimals0 };
  const t1 = { address: p.token1, symbol: p.symbol1, decimals: p.decimals1 };
  const evs = await expertContractEvents(p.pool, {
    order: "desc",
    sinceTs,
    cacheDir,
    onPage: (n) => {
      if (n % 10 === 0) process.stderr.write(`  ${p.pool} page ${n}\n`);
    },
  });
  const topicCounts: Record<string, number> = {};
  for (const e of evs) topicCounts[e.topics[0] ?? "?"] = (topicCounts[e.topics[0] ?? "?"] ?? 0) + 1;
  const swaps = evs
    .map((e) => decodeSushiSwap(e, t0, t1))
    .filter((s): s is Swap => s !== null)
    .sort((a, b) => a.ledger - b.ledger || a.ts - b.ts);
  // Protocol fee: Uniswap V3 semantics, protocol takes 1/feeProtocol of the swap fee (0 = off).
  let protocolFeeShare = 0;
  let protoNote = "";
  try {
    const fp = Number(await simulateView(p.pool, "get_protocol_fee_0"));
    protocolFeeShare = fp > 0 ? 1 / fp : 0;
    protoNote = `get_protocol_fee_0() = ${fp} -> protocol share 1/${fp} [I: Uniswap V3 semantics assumed]`;
  } catch (e) {
    protoNote = `get_protocol_fee_0 failed: ${(e as Error).message.split("\n")[0]}; assumed 0`;
  }
  const first = swaps[0];
  const last = swaps[swaps.length - 1];
  const h: PoolHistory = {
    schema: "clp.pool-history.v1",
    venue: "sushi-v3",
    pool: p.pool,
    token0: t0,
    token1: t1,
    feePpm: p.feePpm,
    protocolFeeShare,
    tickSpacing: p.tickSpacing,
    window: {
      fromTs: sinceTs,
      toTs: nowTs,
      fromLedger: first?.ledger ?? 0,
      toLedger: last?.ledger ?? 0,
    },
    token1UsdAtCapture: p.usd1,
    tvlUsdAtCapture: p.tvlUsd,
    swaps,
    provenance: {
      capturedAt: new Date().toISOString(),
      script: "scripts/capture-sushi-history.ts",
      sources: [`${STELLAR_EXPERT}/contract/${p.pool}/events?order=desc`, "fixtures/sushi/pools.json"],
      notes: [`event topic counts in window: ${JSON.stringify(topicCounts)}`, protoNote],
    },
  };
  writeFileSync(join(root, "fixtures", "sushi", `${p.pool}.history.json`), JSON.stringify(toFile(h)));
  process.stdout.write(`${p.pool} ${p.symbol0}/${p.symbol1}: ${swaps.length} swaps; ${JSON.stringify(topicCounts)}; ${protoNote}\n`);
}

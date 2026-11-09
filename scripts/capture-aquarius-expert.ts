// SPDX-License-Identifier: Apache-2.0
// CLP-002 (fallback path): Aquarius CL swap history from StellarExpert contract events, used when
// the Aquarius API's event feed is unreachable. Carries the pool's real active liquidity
// (pool_state events), so no inference is needed.
// Usage: node scripts/capture-aquarius-expert.ts <days> <pool>...
// Needs fixtures/aquarius/pools.json (from capture-aquarius.ts) for token order, fee and TVL.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AQUA_USD_SCALE, expertAquaToSwaps, type AquaPool } from "../src/data/aquarius.ts";
import { decodeBody, expertContractEvents, ledgerFromPagingToken, MAINNET_RPC, simulateView, STELLAR_EXPERT, tokenMeta } from "../src/data/stellar.ts";
import { usdPrices } from "../src/data/prices.ts";
import { toFile, type PoolHistory } from "../src/types.ts";

const root = new URL("..", import.meta.url).pathname;
const days = Number(process.argv[2] ?? 30);
const wanted = process.argv.slice(3);
const poolsFile = JSON.parse(readFileSync(join(root, "fixtures", "aquarius", "pools.json"), "utf8")) as { capturedAt: string; items: AquaPool[] };
const nowTs = Math.floor(Date.now() / 1000);
const sinceTs = nowTs - days * 86400;
const cacheDir = join(root, ".cache", "http");

for (const addr of wanted) {
  const p = poolsFile.items.find((x) => x.address === addr);
  if (!p) throw new Error(`${addr} not in fixtures/aquarius/pools.json`);
  const [a0, a1] = p.tokens_addresses as [string, string];
  // Token metadata by RPC; if RPC is unreachable, fall back to the Aquarius list's codes and the
  // SAC default of 7 decimals (noted in provenance).
  const metaNotes: string[] = [];
  const meta = async (a: string, i: number) =>
    tokenMeta(a).catch(() => {
      metaNotes.push(`token${i} meta from Aquarius list, decimals assumed 7 (RPC unreachable)`);
      return { symbol: p.tokens_str[i]?.split(":")[0] ?? "?", decimals: 7 };
    });
  const m0 = await meta(a0, 0);
  const m1 = await meta(a1, 1);
  const evs = await expertContractEvents(addr, {
    order: "desc",
    sinceTs,
    cacheDir,
    onPage: (n) => {
      if (n % 25 === 0) process.stderr.write(`  ${addr} page ${n}\n`);
    },
  });
  evs.reverse(); // chronological
  const counts: Record<string, number> = {};
  for (const e of evs) counts[e.topics[0] ?? "?"] = (counts[e.topics[0] ?? "?"] ?? 0) + 1;
  const decoded = evs
    .filter((e) => e.topics[0] === "trade" || e.topics[0] === "pool_state")
    .map((e) => ({ ts: e.ts, paging_token: e.paging_token, topics: e.topics, body: decodeBody(e.bodyXdr) }));
  const swaps = expertAquaToSwaps(decoded, a0, a1, m0.decimals, m1.decimals, ledgerFromPagingToken);
  let activeL = "unread";
  try {
    activeL = String(await simulateView(addr, "get_active_liquidity"));
  } catch (e) {
    activeL = `error: ${(e as Error).message.split("\n")[0]}`;
  }
  const prices = await usdPrices([a1]).catch(() => new Map<string, number>());
  const h: PoolHistory = {
    schema: "clp.pool-history.v1",
    venue: "aquarius-cl",
    pool: addr,
    token0: { address: a0, ...m0 },
    token1: { address: a1, ...m1 },
    feePpm: Math.round(Number(p.fee) * 1e6),
    protocolFeeShare: 0,
    tickSpacing: null,
    window: { fromTs: sinceTs, toTs: nowTs, fromLedger: swaps[0]?.ledger ?? 0, toLedger: swaps[swaps.length - 1]?.ledger ?? 0 },
    token1UsdAtCapture: prices.get(a1) ?? null,
    tvlUsdAtCapture: Number(p.liquidity_usd) / AQUA_USD_SCALE,
    swaps,
    provenance: {
      capturedAt: new Date().toISOString(),
      script: "scripts/capture-aquarius-expert.ts",
      sources: [`${STELLAR_EXPERT}/contract/${addr}/events?order=desc`, `fixtures/aquarius/pools.json (captured ${poolsFile.capturedAt})`, `${MAINNET_RPC} simulateTransaction (token meta, get_active_liquidity)`],
      notes: [
        `event topic counts in window: ${JSON.stringify(counts)}`,
        `get_active_liquidity() raw at capture: ${activeL}`,
        "liquidity per swap from pool_state events (real, not inferred)",
        "protocolFeeShare assumed 0 [U]: Aquarius LP/protocol split not read (CLP-007)",
        "tvlUsdAtCapture from the Aquarius pools list, not from this capture's time",
        ...metaNotes,
      ],
    },
  };
  writeFileSync(join(root, "fixtures", "aquarius", `${addr}.history.json`), JSON.stringify(toFile(h)));
  process.stdout.write(`${addr} ${m0.symbol}/${m1.symbol}: ${swaps.length} swaps; ${JSON.stringify(counts)}; activeL=${activeL}\n`);
}

// SPDX-License-Identifier: Apache-2.0
// CLP-002 data check: re-read a Sushi pool's swap events from public RPC getEvents (7-day
// retention) and compare count and volume with the StellarExpert-derived fixture over the same
// ledger range. Usage: node scripts/crosscheck-rpc.ts <fixtures/sushi/<pool>.history.json>
// Output: fixtures/sushi/<pool>.rpc-crosscheck.json
import { readFileSync, writeFileSync } from "node:fs";
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { fetchJson } from "../src/util/http.ts";
import { MAINNET_RPC } from "../src/data/stellar.ts";
import { priceFromSqrtX96 } from "../src/data/sushi.ts";
import { fromFile, type PoolHistoryFile } from "../src/types.ts";

const file = process.argv[2];
if (!file) throw new Error("usage: crosscheck-rpc.ts <history.json>");
const h = fromFile(JSON.parse(readFileSync(file, "utf8")) as PoolHistoryFile);

interface RpcEvent {
  ledger: number;
  topic: string[];
  value: string;
  txHash: string;
}
interface RpcRes {
  result?: { events: RpcEvent[]; cursor: string; oldestLedger: number; latestLedger: number };
  error?: { message: string };
}
const call = (params: unknown) =>
  fetchJson<RpcRes>(MAINNET_RPC, { method: "POST", body: { jsonrpc: "2.0", id: 1, method: "getEvents", params }, minIntervalMs: 700 });

const swapTopic = xdr.ScVal.scvSymbol("swap").toXDR("base64");
const health = await fetchJson<{ result: { oldestLedger: number; latestLedger: number } }>(MAINNET_RPC, {
  method: "POST",
  body: { jsonrpc: "2.0", id: 1, method: "getHealth" },
});
const start = health.result.oldestLedger + 10;
const end = Math.min(health.result.latestLedger, h.window.toLedger);
const rpcSwaps: { ledger: number; amount0: number; amount1: number; price: number }[] = [];
let cursor: string | undefined;
for (let i = 0; i < 2000; i++) {
  const params = cursor
    ? { filters: [{ type: "contract", contractIds: [h.pool], topics: [[swapTopic]] }], pagination: { cursor, limit: 1000 } }
    : { startLedger: start, filters: [{ type: "contract", contractIds: [h.pool], topics: [[swapTopic]] }], pagination: { limit: 1000 } };
  const r = await call(params);
  if (!r.result) throw new Error(r.error?.message ?? "rpc error");
  for (const e of r.result.events) {
    if (e.ledger > end) continue;
    const v = scValToNative(xdr.ScVal.fromXDR(e.value, "base64")) as Record<string, bigint>;
    rpcSwaps.push({
      ledger: e.ledger,
      amount0: Number(v.amount0) / 10 ** h.token0.decimals,
      amount1: Number(v.amount1) / 10 ** h.token1.decimals,
      price: priceFromSqrtX96(BigInt(v.sqrt_price_x96 as bigint), h.token0.decimals, h.token1.decimals),
    });
  }
  // RPC scans a bounded ledger window per request (10,000 ledgers observed), so a short page does
  // not mean the end: continue until the cursor passes the end ledger.
  cursor = r.result.cursor;
  const cursorLedger = Number(BigInt(cursor.split("-")[0] ?? "0") >> 32n);
  if (cursorLedger >= end || cursorLedger >= r.result.latestLedger) break;
}
const fx = h.swaps.filter((s) => s.ledger >= start && s.ledger <= end);
const vol = (xs: { amount0: number; amount1: number; price: number }[]) =>
  xs.reduce((t, s) => t + (s.amount0 > 0 ? s.amount0 * s.price : 0) + (s.amount1 > 0 ? s.amount1 : 0), 0);
const out = {
  pool: h.pool,
  checkedAt: new Date().toISOString(),
  rpc: MAINNET_RPC,
  ledgerRange: [start, end],
  rpcSwapCount: rpcSwaps.length,
  fixtureSwapCount: fx.length,
  rpcVolumeToken1: vol(rpcSwaps),
  fixtureVolumeToken1: vol(fx),
  match: rpcSwaps.length === fx.length && Math.abs(vol(rpcSwaps) - vol(fx)) <= 1e-6 * Math.max(1, vol(fx)),
};
writeFileSync(file.replace(/\.history\.json$/, ".rpc-crosscheck.json"), JSON.stringify(out, null, 1));
process.stdout.write(JSON.stringify(out) + "\n");

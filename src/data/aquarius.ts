// SPDX-License-Identifier: Apache-2.0
// Aquarius concentrated pools. Public API (OpenAPI at https://amm-api.aqua.network/api/schema/):
//  - /pools/?pool_type=concentrated          pool list (USD figures scaled by 1e7, see SPEC.md 2.3)
//  - /statistics/pool/{address}/             hourly volume/liquidity, 720 hours retained
//  - /api/external/gecko-terminal/events/    swap/join/exit events by ledger range
import type { Swap } from "../types.ts";
import { fetchJson } from "../util/http.ts";

export const AQUA_API = "https://amm-api.aqua.network";

export interface AquaPool {
  address: string;
  tokens_addresses: string[];
  tokens_str: string[];
  fee: string;
  pool_type: string;
  liquidity_usd: string;
  volume_usd: string;
  apy: string;
  total_apy: string;
}

export interface AquaHourStat {
  datetime_str: string;
  volume_usd: string;
  liquidity_usd: string;
  volume: string;
  liquidity: string;
}

export interface GeckoEvent {
  block: { blockNumber: number; blockTimestamp: number };
  eventType: "swap" | "join" | "exit";
  txnId: string;
  txnIndex?: number;
  eventIndex?: number;
  pairId: string;
  priceNative?: string;
  asset0In?: string;
  asset1In?: string;
  asset0Out?: string;
  asset1Out?: string;
  reserves?: { asset0: string; asset1: string };
}

/** Aquarius reports USD values in 1e-7 USD units (checked against reserves x price, SPEC.md 2.3). */
export const AQUA_USD_SCALE = 1e7;

export async function listConcentratedPools(): Promise<AquaPool[]> {
  const d = await fetchJson<{ items: AquaPool[] }>(`${AQUA_API}/pools/?pool_type=concentrated&size=100`);
  return d.items;
}

export async function poolHourlyStats(address: string, cacheDir?: string): Promise<AquaHourStat[]> {
  const out: AquaHourStat[] = [];
  for (let page = 1; page <= 20; page++) {
    const d = await fetchJson<{ items: AquaHourStat[]; next: string | null }>(
      `${AQUA_API}/statistics/pool/${address}/?size=100&page=${page}`,
      cacheDir ? { cacheDir, minIntervalMs: 600 } : { minIntervalMs: 600 },
    );
    out.push(...d.items);
    if (!d.next) break;
  }
  return out;
}

export async function latestBlock(): Promise<{ blockNumber: number; blockTimestamp: number }> {
  const d = await fetchJson<{ block: { blockNumber: number; blockTimestamp: number } }>(
    `${AQUA_API}/api/external/gecko-terminal/latest-block/`,
  );
  return d.block;
}

export async function geckoEvents(fromBlock: number, toBlock: number, cacheDir?: string): Promise<GeckoEvent[]> {
  try {
    const d = await fetchJson<{ events: GeckoEvent[] }>(
      `${AQUA_API}/api/external/gecko-terminal/events/?fromBlock=${fromBlock}&toBlock=${toBlock}`,
      cacheDir ? { cacheDir, minIntervalMs: 600 } : { minIntervalMs: 600 },
    );
    return d.events;
  } catch (e) {
    // The feed answers 413 "too many events" for busy ranges: split the range and retry.
    if (/HTTP 413/.test((e as Error).message) && toBlock > fromBlock) {
      const mid = Math.floor((fromBlock + toBlock) / 2);
      return [...(await geckoEvents(fromBlock, mid, cacheDir)), ...(await geckoEvents(mid + 1, toBlock, cacheDir))];
    }
    throw e;
  }
}

/**
 * Convert one pool's gecko swap events (chronological) into Swaps. Aquarius does not report
 * active liquidity per swap, so it is inferred from the price move between consecutive swaps:
 * token1 in:  L = dy_net / (sqrtP_after - sqrtP_before)
 * token0 in:  L = dx_net / (1/sqrtP_after - 1/sqrtP_before)
 * where the net input excludes the fee. CL joins/exits do not move price, so the previous swap's
 * post-price is this swap's pre-price. Swaps that cross initialised ticks give an average L.
 * Returns null L when the move is too small to resolve or the first swap has no predecessor.
 */
export function geckoToSwaps(events: GeckoEvent[], feeFraction: number): Swap[] {
  const swaps: Swap[] = [];
  let prevPrice: number | null = null;
  for (const e of events) {
    if (e.eventType !== "swap" || e.priceNative === undefined) continue;
    const in0 = Number(e.asset0In ?? 0);
    const in1 = Number(e.asset1In ?? 0);
    const out0 = Number(e.asset0Out ?? 0);
    const out1 = Number(e.asset1Out ?? 0);
    const price = Number(e.priceNative);
    let L: number | null = null;
    if (prevPrice !== null && price > 0 && prevPrice > 0) {
      const sa = Math.sqrt(price);
      const sb = Math.sqrt(prevPrice);
      if (in1 > 0 && sa - sb > sb * 1e-9) L = (in1 * (1 - feeFraction)) / (sa - sb);
      else if (in0 > 0 && 1 / sa - 1 / sb > (1 / sb) * 1e-9) L = (in0 * (1 - feeFraction)) / (1 / sa - 1 / sb);
    }
    swaps.push({
      ts: e.block.blockTimestamp,
      ledger: e.block.blockNumber,
      amount0: in0 - out0,
      amount1: in1 - out1,
      price,
      liquidity: L !== null && Number.isFinite(L) && L > 0 ? L : null,
    });
    prevPrice = price;
  }
  return swaps;
}

/**
 * Aquarius pool events as indexed by StellarExpert (topics read from mainnet 2026-11-03):
 *   trade(token_in, token_out, trader) -> [sold_amount, bought_amount, fee]   (sold is gross of fee)
 *   pool_state()                       -> [sqrt_price_x96, tick, active_liquidity]
 *   update_reserves()                  -> [reserve0, reserve1]
 * A swap emits trade, update_reserves and pool_state in the same operation, so each trade is
 * paired with the pool_state that shares its operation id (paging token before the "-").
 * Unlike the gecko feed this carries the real active liquidity. Events must be chronological.
 */
export function expertAquaToSwaps(
  events: { ts: number; paging_token: string; topics: string[]; body: unknown }[],
  token0: string,
  token1: string,
  dec0: number,
  dec1: number,
  ledgerOf: (pagingToken: string) => number,
): Swap[] {
  const out: Swap[] = [];
  const pending = new Map<string, { ts: number; ledger: number; a0: number; a1: number }>();
  for (const e of events) {
    const op = e.paging_token.split("-")[0] ?? "";
    if (e.topics[0] === "trade") {
      const [sold, bought] = e.body as [bigint, bigint, bigint];
      const tin = e.topics[1];
      const s0 = Number(sold);
      const b0 = Number(bought);
      const a0 = tin === token0 ? s0 / 10 ** dec0 : -b0 / 10 ** dec0;
      const a1 = tin === token1 ? s0 / 10 ** dec1 : -b0 / 10 ** dec1;
      pending.set(op, { ts: e.ts, ledger: ledgerOf(e.paging_token), a0, a1 });
    } else if (e.topics[0] === "pool_state") {
      const p = pending.get(op);
      if (!p) continue;
      pending.delete(op);
      const [sqrt, , liq] = e.body as [bigint, number, bigint];
      const s = Number(sqrt) / 2 ** 96;
      out.push({
        ts: p.ts,
        ledger: p.ledger,
        amount0: p.a0,
        amount1: p.a1,
        price: s * s * 10 ** (dec0 - dec1),
        liquidity: Number(liq) / 10 ** ((dec0 + dec1) / 2),
      });
    }
  }
  return out;
}

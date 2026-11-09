// SPDX-License-Identifier: Apache-2.0
// Sushi Stellar (Uniswap-V3-style) pools. Factory address source: DefiLlama adapter
// projects/sushi-stellar/index.js (FACTORY constant), read 2026-11-03. Pools come from the
// factory's `pool_created` events; swap history from each pool's `swap` events.
import type { Swap, TokenInfo } from "../types.ts";
import { decodeBody, expertContractEvents, ledgerFromPagingToken, type ExpertEvent } from "./stellar.ts";

export const SUSHI_FACTORY = "CD3KRKGDRVWPXVB3VXLUMQKMX6XZ6Q2H334IVZD4XXNAMKSRVQL5GLYF";

export interface SushiPoolCreated {
  pool: string;
  token0: string;
  token1: string;
  feePpm: number;
  tickSpacing: number;
  createdTs: number;
}

export function decodePoolCreated(e: ExpertEvent): SushiPoolCreated {
  const v = decodeBody(e.bodyXdr) as Record<string, unknown>;
  return {
    pool: String(v.pool_address),
    token0: String(v.token0),
    token1: String(v.token1),
    feePpm: Number(v.fee),
    tickSpacing: Number(v.tick_spacing),
    createdTs: e.ts,
  };
}

export async function listSushiPools(cacheDir?: string): Promise<{ pools: SushiPoolCreated[]; protocolFeeEvents: unknown[] }> {
  const evs = await expertContractEvents(SUSHI_FACTORY, { order: "asc", ...(cacheDir ? { cacheDir } : {}) });
  return {
    pools: evs.filter((e) => e.topics[0] === "pool_created").map(decodePoolCreated),
    protocolFeeEvents: evs.filter((e) => e.topics[0] === "set_protocol_fee").map((e) => ({ ts: e.ts, body: decodeBody(e.bodyXdr) })),
  };
}

const Q96 = 2n ** 96n;

/** sqrtPriceX96 (raw) to human price token1/token0. */
export function priceFromSqrtX96(sqrtPriceX96: bigint, dec0: number, dec1: number): number {
  // Split to keep precision: (sqrt / 2^96)^2 with sqrt up to 2^160.
  const s = Number(sqrtPriceX96) / Number(Q96);
  return s * s * 10 ** (dec0 - dec1);
}

/** Decode one Sushi `swap` event body into a Swap (human units). Returns null for other topics. */
export function decodeSushiSwap(e: ExpertEvent, t0: TokenInfo, t1: TokenInfo): Swap | null {
  if (e.topics[0] !== "swap") return null;
  const v = decodeBody(e.bodyXdr) as Record<string, unknown>;
  const a0 = BigInt(v.amount0 as bigint);
  const a1 = BigInt(v.amount1 as bigint);
  const sqrt = BigInt(v.sqrt_price_x96 as bigint);
  const liq = BigInt(v.liquidity as bigint);
  return {
    ts: e.ts,
    ledger: ledgerFromPagingToken(e.paging_token),
    amount0: Number(a0) / 10 ** t0.decimals,
    amount1: Number(a1) / 10 ** t1.decimals,
    price: priceFromSqrtX96(sqrt, t0.decimals, t1.decimals),
    liquidity: Number(liq) / 10 ** ((t0.decimals + t1.decimals) / 2),
  };
}

// SPDX-License-Identifier: Apache-2.0
// Realised volume and fee statistics from a pool history (SPEC.md section 3.4).
import type { PoolHistory } from "../types.ts";

export interface FeeStats {
  pool: string;
  venue: string;
  pair: string;
  feePpm: number;
  protocolFeeShare: number;
  swaps: number;
  days: number;
  /** Sum over swaps of input value in token1 at the swap price. */
  volumeToken1: number;
  volumeUsd: number | null;
  totalFeesUsd: number | null;
  lpFeesUsd: number | null;
  lpFeesUsdPerDay: number | null;
  tvlUsd: number | null;
  /** LP fees annualised over TVL at capture (pool-wide passive fee APR). */
  poolFeeApr: number | null;
  firstTs: number | null;
  lastTs: number | null;
}

export function feeStats(h: PoolHistory): FeeStats {
  let vol = 0;
  for (const s of h.swaps) {
    const in0 = s.amount0 > 0 ? s.amount0 : 0;
    const in1 = s.amount1 > 0 ? s.amount1 : 0;
    vol += in0 * s.price + in1;
  }
  const days = (h.window.toTs - h.window.fromTs) / 86400;
  const usd = h.token1UsdAtCapture;
  const fee = h.feePpm / 1e6;
  const volumeUsd = usd === null ? null : vol * usd;
  const totalFeesUsd = volumeUsd === null ? null : volumeUsd * fee;
  const lpFeesUsd = totalFeesUsd === null ? null : totalFeesUsd * (1 - h.protocolFeeShare);
  return {
    pool: h.pool,
    venue: h.venue,
    pair: `${h.token0.symbol}/${h.token1.symbol}`,
    feePpm: h.feePpm,
    protocolFeeShare: h.protocolFeeShare,
    swaps: h.swaps.length,
    days,
    volumeToken1: vol,
    volumeUsd,
    totalFeesUsd,
    lpFeesUsd,
    lpFeesUsdPerDay: lpFeesUsd === null ? null : lpFeesUsd / days,
    tvlUsd: h.tvlUsdAtCapture,
    poolFeeApr: lpFeesUsd !== null && h.tvlUsdAtCapture ? (lpFeesUsd / h.tvlUsdAtCapture) * (365 / days) : null,
    firstTs: h.swaps[0]?.ts ?? null,
    lastTs: h.swaps[h.swaps.length - 1]?.ts ?? null,
  };
}

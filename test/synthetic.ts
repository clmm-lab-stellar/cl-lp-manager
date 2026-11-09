// SPDX-License-Identifier: Apache-2.0
// Synthetic pool histories for closed-form tests.
import type { PoolHistory, Swap } from "../src/types.ts";

export function synthetic(swaps: Swap[], feePpm = 3000, protocolFeeShare = 0): PoolHistory {
  const first = swaps[0]!;
  const last = swaps[swaps.length - 1]!;
  return {
    schema: "clp.pool-history.v1",
    venue: "sushi-v3",
    pool: "SYNTHETIC",
    token0: { address: "T0", symbol: "X", decimals: 7 },
    token1: { address: "T1", symbol: "Y", decimals: 7 },
    feePpm,
    protocolFeeShare,
    tickSpacing: 60,
    window: { fromTs: first.ts, toTs: last.ts, fromLedger: first.ledger, toLedger: last.ledger },
    token1UsdAtCapture: 1,
    tvlUsdAtCapture: null,
    swaps,
    provenance: { capturedAt: "synthetic", script: "test/synthetic.ts", sources: [], notes: [] },
  };
}

/** Swap moving price p0 -> p1 through constant pool liquidity L (exact CL amounts, fee on input). */
export function swapStep(ts: number, p0: number, p1: number, L: number, fee: number): Swap {
  const s0 = Math.sqrt(p0);
  const s1 = Math.sqrt(p1);
  if (s1 >= s0) {
    const dyNet = L * (s1 - s0);
    const dxOut = L * (1 / s0 - 1 / s1);
    return { ts, ledger: ts, amount0: -dxOut, amount1: dyNet / (1 - fee), price: p1, liquidity: L };
  }
  const dxNet = L * (1 / s1 - 1 / s0);
  const dyOut = L * (s0 - s1);
  return { ts, ledger: ts, amount0: dxNet / (1 - fee), amount1: -dyOut, price: p1, liquidity: L };
}

// SPDX-License-Identifier: Apache-2.0
// Shared data shapes. Normative description: SPEC.md section 2.

export type Venue = "sushi-v3" | "aquarius-cl";

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
}

/**
 * One swap, in human units (decimals applied).
 * amount0/amount1 are from the pool's point of view: positive = paid into the pool.
 * price is token1 per token0 after the swap.
 * liquidity is the pool's active liquidity L after the swap in HUMAN units, i.e. the L for which
 * delta(amount1) = L * delta(sqrt(price)) with price in human units. Raw venue liquidity converts as
 * L_human = L_raw / 10^((decimals0 + decimals1) / 2). Reported by the venue (Sushi) or inferred
 * from the price move (Aquarius); null if unknown.
 */
export interface Swap {
  ts: number;
  ledger: number;
  amount0: number;
  amount1: number;
  price: number;
  liquidity: number | null;
}

export interface Provenance {
  capturedAt: string;
  script: string;
  sources: string[];
  notes: string[];
}

export interface PoolHistory {
  schema: "clp.pool-history.v1";
  venue: Venue;
  pool: string;
  token0: TokenInfo;
  token1: TokenInfo;
  /** Swap fee in parts per million (Uniswap units: 3000 = 0.30%). */
  feePpm: number;
  /** Share of the swap fee that goes to the protocol, not LPs (0..1). */
  protocolFeeShare: number;
  tickSpacing: number | null;
  window: { fromTs: number; toTs: number; fromLedger: number; toLedger: number };
  /** USD price of token1 at capture time, used only to express results in USD. */
  token1UsdAtCapture: number | null;
  /** Pool TVL in USD at capture time (both reserves), if known. */
  tvlUsdAtCapture: number | null;
  swaps: Swap[];
  provenance: Provenance;
}

/** Compact on-disk form: swaps as tuples to keep fixtures small. */
export interface PoolHistoryFile extends Omit<PoolHistory, "swaps"> {
  swapColumns: ["ts", "ledger", "amount0", "amount1", "price", "liquidity"];
  swaps: [number, number, number, number, number, number | null][];
}

export function toFile(h: PoolHistory): PoolHistoryFile {
  const { swaps, ...rest } = h;
  return {
    ...rest,
    swapColumns: ["ts", "ledger", "amount0", "amount1", "price", "liquidity"],
    swaps: swaps.map((s) => [s.ts, s.ledger, s.amount0, s.amount1, s.price, s.liquidity]),
  };
}

export function fromFile(f: PoolHistoryFile): PoolHistory {
  const { swaps, swapColumns: _cols, ...rest } = f;
  return {
    ...rest,
    swaps: swaps.map(([ts, ledger, amount0, amount1, price, liquidity]) => ({ ts, ledger, amount0, amount1, price, liquidity })),
  };
}

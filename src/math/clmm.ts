// SPDX-License-Identifier: Apache-2.0
// Concentrated-liquidity position math in human units (floating point). Price P is token1 per
// token0; a position is (L, sqrtA, sqrtB) with sqrtA < sqrtB. Full range is sqrtA = 0,
// sqrtB = Infinity. Formulas: Uniswap V3 whitepaper, section 6.2.

export interface Range {
  /** sqrt of the lower price bound (0 for full range). */
  sqrtA: number;
  /** sqrt of the upper price bound (Infinity for full range). */
  sqrtB: number;
}

export const FULL_RANGE: Range = { sqrtA: 0, sqrtB: Number.POSITIVE_INFINITY };

/** Symmetric multiplicative range around price p: [p/(1+w), p*(1+w)]. w = 0.01 means "+/-1%". */
export function rangeAround(p: number, w: number): Range {
  if (!(w > 0)) throw new Error(`width must be > 0, got ${w}`);
  return { sqrtA: Math.sqrt(p / (1 + w)), sqrtB: Math.sqrt(p * (1 + w)) };
}

/** Token amounts held by liquidity L at price p. */
export function amountsForLiquidity(L: number, p: number, r: Range): { x: number; y: number } {
  const s = Math.sqrt(p);
  if (s <= r.sqrtA) return { x: L * (1 / r.sqrtA - 1 / r.sqrtB), y: 0 };
  if (s >= r.sqrtB) return { x: 0, y: L * (r.sqrtB - r.sqrtA) };
  const x = L * (1 / s - (Number.isFinite(r.sqrtB) ? 1 / r.sqrtB : 0));
  const y = L * (s - r.sqrtA);
  return { x, y };
}

/** Position value in token1 at price p. */
export function positionValue(L: number, p: number, r: Range): number {
  const { x, y } = amountsForLiquidity(L, p, r);
  return x * p + y;
}

/** Liquidity bought by `value` (token1 units) at price p, split in the range's ratio. */
export function liquidityForValue(value: number, p: number, r: Range): number {
  const perL = positionValue(1, p, r);
  if (!(perL > 0)) throw new Error("degenerate range");
  return value / perL;
}

export function inRange(p: number, r: Range): boolean {
  const s = Math.sqrt(p);
  return s >= r.sqrtA && s <= r.sqrtB;
}

/**
 * Fraction of a swap's input that traded inside range r, for a swap moving price from p0 to p1
 * under locally constant liquidity. token1 input moves sqrtP linearly in dy; token0 input moves
 * 1/sqrtP linearly in dx. If the move is zero, returns 1 when p0 is in range, else 0.
 */
export function inRangeFraction(p0: number, p1: number, r: Range): number {
  const s0 = Math.sqrt(p0);
  const s1 = Math.sqrt(p1);
  if (s0 === s1) return inRange(p0, r) ? 1 : 0;
  if (s1 > s0) {
    const lo = Math.max(s0, r.sqrtA);
    const hi = Math.min(s1, r.sqrtB);
    return hi > lo ? (hi - lo) / (s1 - s0) : 0;
  }
  // price falling: work in 1/sqrtP, which rises
  const u0 = 1 / s0;
  const u1 = 1 / s1;
  const uLo = Math.max(u0, Number.isFinite(r.sqrtB) ? 1 / r.sqrtB : 0);
  const uHi = Math.min(u1, r.sqrtA > 0 ? 1 / r.sqrtA : Number.POSITIVE_INFINITY);
  return uHi > uLo ? (uHi - uLo) / (u1 - u0) : 0;
}

/** Uniswap tick for a human price (raw-price adjustment is the caller's job). */
export function priceToTick(p: number): number {
  return Math.floor(Math.log(p) / Math.log(1.0001));
}

export function tickToPrice(t: number): number {
  return 1.0001 ** t;
}

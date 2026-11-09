// SPDX-License-Identifier: Apache-2.0
// Swap-by-swap LP backtester. Model (SPEC.md section 3):
//  - Price-taker: our liquidity does not change the observed price path.
//  - Fee share per swap = poolFee * (1 - protocolShare) * |input| * inRangeFraction * L/(L + L_pool).
//    L_pool is the pool's active liquidity reported with (Sushi) or inferred from (Aquarius) the
//    swap; when unknown, the last known value is carried forward; swaps before any known value
//    earn nothing and are counted in `swapsWithoutLiquidity`.
//  - Fees are held aside and reinvested at each rebalance (auto-compound on rebalance only).
//  - Rebalance: withdraw, re-centre the range on the current price, swap the imbalance paying
//    (poolFee + slippage) on the traded value, plus a fixed cost per rebalance.
//  - LVR is the exact discrete loss-versus-rebalancing on the observed path:
//    sum over steps of x(P_prev) * (P - P_prev) - (V(P) - V(P_prev)), which is >= 0 for concave V.
import {
  FULL_RANGE,
  amountsForLiquidity,
  inRange,
  inRangeFraction,
  liquidityForValue,
  positionValue,
  rangeAround,
  type Range,
} from "../math/clmm.ts";
import type { PoolHistory } from "../types.ts";

export type RebalanceRule =
  | { kind: "none" }
  /** Rebalance once price has been outside the range for at least delaySec. */
  | { kind: "out-of-range"; delaySec: number }
  /** Rebalance when price moves more than `trigger` (0..1) of the half-width from the centre. */
  | { kind: "threshold"; trigger: number }
  | { kind: "periodic"; periodSec: number };

export interface StrategyConfig {
  /** Half-width w for the range [p/(1+w), p(1+w)], or "full". */
  width: number | "full";
  rule: RebalanceRule;
}

export interface CostModel {
  /** Extra slippage on rebalance swaps, as a fraction of traded value (pool fee is added). */
  slippage: number;
  /** Fixed cost per rebalance, in token1 units (Stellar tx fees + keeper). */
  fixedPerRebalance: number;
  /** Fraction of the pool fee paid on rebalance swaps; 1 = swap through the same pool. */
  swapFeeMultiplier: number;
}

export const DEFAULT_COSTS: CostModel = { slippage: 0.0005, fixedPerRebalance: 0.05, swapFeeMultiplier: 1 };

/** One sample of the position over time (CLP-016), for charts. Values in token1 units. */
export interface TracePoint {
  ts: number;
  price: number;
  /** LP position value plus fees held aside, after costs so far. */
  value: number;
  /** Buy-and-hold of the initial token split. */
  hodl: number;
  /** Cumulative fee income. */
  fees: number;
  /** Current range bounds in price (0 and Infinity for full range: serialised as null). */
  lower: number | null;
  upper: number | null;
}

export interface BacktestOptions {
  /** Emit a trace point at most every `traceEverySec` seconds (plus first and last swap). */
  traceEverySec?: number;
}

export interface BacktestResult {
  config: StrategyConfig;
  initialValue: number;
  finalValue: number;
  /** Fees earned over the window, valued at the price of each swap, token1 units. */
  feeIncome: number;
  /** Value of a buy-and-hold of the initial token split, token1 units. */
  hodlValue: number;
  /** LP value excluding fees and costs minus HODL (negative = impermanent loss). */
  impermanentLoss: number;
  lvr: number;
  rebalances: number;
  rebalanceCost: number;
  /** Fraction of swaps (by count) during which price was inside the range. */
  timeInRange: number;
  swapsWithoutLiquidity: number;
  /** Time-weighted average capital share of pool active liquidity while in range. */
  avgPoolShare: number;
  years: number;
  feeApr: number;
  /** (final - initial) / initial, annualised. Includes the drift of token0's price. */
  netApr: number;
  /** (final - HODL) / initial, annualised: what LPing added over just holding the start tokens. */
  excessVsHodlApr: number;
  /** Present only when `traceEverySec` was given. */
  trace?: TracePoint[];
}

function initialRange(cfg: StrategyConfig, p: number): Range {
  return cfg.width === "full" ? FULL_RANGE : rangeAround(p, cfg.width);
}

export function backtest(
  h: PoolHistory,
  cfg: StrategyConfig,
  initialValue: number,
  costs: CostModel = DEFAULT_COSTS,
  opts: BacktestOptions = {},
): BacktestResult {
  const swaps = h.swaps;
  const first = swaps[0];
  const last = swaps[swaps.length - 1];
  if (!first || !last) throw new Error(`pool ${h.pool}: no swaps`);
  const feeFrac = (h.feePpm / 1e6) * (1 - h.protocolFeeShare);
  const poolFee = h.feePpm / 1e6;

  let p = first.price;
  let range = initialRange(cfg, p);
  let L = liquidityForValue(initialValue, p, range);
  const start = amountsForLiquidity(L, p, range);
  const hodl0 = start.x;
  const hodl1 = start.y;

  let fee0 = 0;
  let fee1 = 0;
  let feeIncome = 0;
  let lvr = 0;
  let rebalances = 0;
  let rebalanceCost = 0;
  // Running HODL baseline for IL across rebalances: each segment compares against holding the
  // tokens that the segment started with.
  let ilAccum = 0;
  let segHodl0 = start.x;
  let segHodl1 = start.y;
  let lastL: number | null = null;
  let swapsWithoutLiquidity = 0;
  let inRangeCount = 0;
  let shareSum = 0;
  let shareN = 0;
  let outSince: number | null = null;
  let lastRebalanceTs = first.ts;
  let centre = p;
  const trace: TracePoint[] | undefined = opts.traceEverySec !== undefined ? [] : undefined;
  let lastTraceTs = Number.NEGATIVE_INFINITY;
  const sample = (ts: number, force: boolean): void => {
    if (!trace || (!force && ts - lastTraceTs < opts.traceEverySec!)) return;
    lastTraceTs = ts;
    const lo = range.sqrtA * range.sqrtA;
    const hi = range.sqrtB * range.sqrtB;
    trace.push({
      ts,
      price: p,
      value: positionValue(L, p, range) + fee0 * p + fee1,
      hodl: hodl0 * p + hodl1,
      fees: feeIncome,
      lower: lo > 0 ? lo : null,
      upper: Number.isFinite(hi) ? hi : null,
    });
  };

  for (let i = 0; i < swaps.length; i++) {
    const s = swaps[i]!;
    const pPrev = i === 0 ? s.price : p;
    const pNow = s.price;
    if (s.liquidity !== null && s.liquidity > 0) lastL = s.liquidity;

    // LVR on this step, with the position held over the step.
    const before = amountsForLiquidity(L, pPrev, range);
    const vPrev = before.x * pPrev + before.y;
    const vNow = positionValue(L, pNow, range);
    lvr += before.x * (pNow - pPrev) - (vNow - vPrev);

    // Fees on this swap.
    const in0 = s.amount0 > 0 ? s.amount0 : 0;
    const in1 = s.amount1 > 0 ? s.amount1 : 0;
    const frac = inRangeFraction(pPrev, pNow, range);
    if (frac > 0) {
      if (lastL === null) swapsWithoutLiquidity++;
      else {
        const share = L / (L + lastL);
        shareSum += share;
        shareN++;
        const f0 = in0 * feeFrac * frac * share;
        const f1 = in1 * feeFrac * frac * share;
        fee0 += f0;
        fee1 += f1;
        feeIncome += f0 * pNow + f1;
      }
    }
    p = pNow;
    if (inRange(p, range)) {
      inRangeCount++;
      outSince = null;
    } else if (outSince === null) outSince = s.ts;

    // Rebalance decision.
    let doRebalance = false;
    const rule = cfg.rule;
    if (cfg.width !== "full") {
      if (rule.kind === "out-of-range") doRebalance = outSince !== null && s.ts - outSince >= rule.delaySec;
      else if (rule.kind === "threshold") {
        const w = cfg.width;
        const dev = Math.abs(Math.log(p / centre));
        doRebalance = dev > rule.trigger * Math.log(1 + w);
      } else if (rule.kind === "periodic") doRebalance = s.ts - lastRebalanceTs >= rule.periodSec;
    }
    if (doRebalance) {
      const held = amountsForLiquidity(L, p, range);
      // IL of the closing segment vs holding its starting tokens.
      ilAccum += held.x * p + held.y - (segHodl0 * p + segHodl1);
      const x = held.x + fee0;
      const y = held.y + fee1;
      fee0 = 0;
      fee1 = 0;
      const value = x * p + y;
      const newRange = rangeAround(p, cfg.width as number);
      const target = amountsForLiquidity(liquidityForValue(value, p, newRange), p, newRange);
      const traded = Math.abs(target.x - x) * p; // value moved from one token to the other
      const cost = traded * (poolFee * costs.swapFeeMultiplier + costs.slippage) + costs.fixedPerRebalance;
      const net = Math.max(value - cost, 0);
      rebalanceCost += cost;
      range = newRange;
      L = liquidityForValue(net, p, range);
      const seg = amountsForLiquidity(L, p, range);
      segHodl0 = seg.x;
      segHodl1 = seg.y;
      centre = p;
      rebalances++;
      lastRebalanceTs = s.ts;
      outSince = null;
    }
    sample(s.ts, i === 0);
  }

  const held = amountsForLiquidity(L, p, range);
  const lpValue = held.x * p + held.y;
  ilAccum += lpValue - (segHodl0 * p + segHodl1);
  const finalValue = lpValue + fee0 * p + fee1;
  const hodlValue = hodl0 * p + hodl1;
  const years = Math.max((last.ts - first.ts) / (365 * 86400), 1e-9);
  if (trace) {
    const tail = trace[trace.length - 1];
    if (tail && tail.ts === last.ts) trace.pop();
    lastTraceTs = Number.NEGATIVE_INFINITY;
    sample(last.ts, true);
  }
  return {
    config: cfg,
    initialValue,
    finalValue,
    feeIncome,
    hodlValue,
    impermanentLoss: ilAccum,
    lvr,
    rebalances,
    rebalanceCost,
    timeInRange: inRangeCount / swaps.length,
    swapsWithoutLiquidity,
    avgPoolShare: shareN > 0 ? shareSum / shareN : 0,
    years,
    feeApr: feeIncome / initialValue / years,
    netApr: (finalValue - initialValue) / initialValue / years,
    excessVsHodlApr: (finalValue - hodlValue) / initialValue / years,
    ...(trace ? { trace } : {}),
  };
}

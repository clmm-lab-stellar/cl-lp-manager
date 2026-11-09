// SPDX-License-Identifier: Apache-2.0
// Grid of range widths x rebalance rules against two baselines (passive full range, HODL),
// plus a walk-forward check: pick the best config on the first half, score it on the second.
import type { PoolHistory } from "../types.ts";
import { backtest, DEFAULT_COSTS, type BacktestResult, type CostModel, type RebalanceRule, type StrategyConfig } from "./engine.ts";

export const DEFAULT_WIDTHS = [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25];
export const DEFAULT_RULES: RebalanceRule[] = [
  { kind: "none" },
  { kind: "out-of-range", delaySec: 0 },
  { kind: "out-of-range", delaySec: 3600 },
  { kind: "threshold", trigger: 0.8 },
];

/** Largest average share of pool active liquidity for a config to count as "best". */
export const MAX_POOL_SHARE = 0.2;

export function ruleLabel(r: RebalanceRule): string {
  switch (r.kind) {
    case "none":
      return "none";
    case "out-of-range":
      return `oor+${r.delaySec}s`;
    case "threshold":
      return `thr${r.trigger}`;
    case "periodic":
      return `every${r.periodSec}s`;
  }
}

export function parseRule(s: string): RebalanceRule {
  if (s === "none") return { kind: "none" };
  let m = /^oor(?:\+?(\d+)s?)?$/.exec(s);
  if (m) return { kind: "out-of-range", delaySec: Number(m[1] ?? 0) };
  m = /^thr([0-9.]+)$/.exec(s);
  if (m) return { kind: "threshold", trigger: Number(m[1]) };
  m = /^every(\d+)s?$/.exec(s);
  if (m) return { kind: "periodic", periodSec: Number(m[1]) };
  throw new Error(`bad rule ${s} (use none | oor | oor+3600s | thr0.8 | every86400s)`);
}

export interface GridRow extends BacktestResult {
  label: string;
  excessVsPassive: number;
  excessVsHodl: number;
}

export interface GridReport {
  pool: string;
  venue: string;
  pair: string;
  capitalToken1: number;
  costs: CostModel;
  passive: BacktestResult;
  rows: GridRow[];
  best: GridRow | null;
  /** True when the best CL config ends above the passive full-range LP after costs. */
  beatsPassive: boolean;
  walkForward: {
    chosenOnFirstHalf: string | null;
    secondHalfExcessVsPassive: number | null;
    secondHalfBeatsPassive: boolean | null;
  };
}

function runGrid(h: PoolHistory, capital: number, widths: number[], rules: RebalanceRule[], costs: CostModel) {
  const passive = backtest(h, { width: "full", rule: { kind: "none" } }, capital, costs);
  const rows: GridRow[] = [];
  for (const w of widths) {
    for (const r of rules) {
      const cfg: StrategyConfig = { width: w, rule: r };
      const res = backtest(h, cfg, capital, costs);
      rows.push({
        ...res,
        label: `w=${(w * 100).toFixed(2)}% ${ruleLabel(r)}`,
        excessVsPassive: res.finalValue - passive.finalValue,
        excessVsHodl: res.finalValue - res.hodlValue,
      });
    }
  }
  // Configs whose position would be over MAX_POOL_SHARE of active liquidity break the
  // price-taker assumption and are not eligible as "best".
  const best = rows
    .filter((r) => r.avgPoolShare <= MAX_POOL_SHARE)
    .reduce<GridRow | null>((b, r) => (b === null || r.finalValue > b.finalValue ? r : b), null);
  return { passive, rows, best };
}

function sliceHistory(h: PoolHistory, fromTs: number, toTs: number): PoolHistory {
  const swaps = h.swaps.filter((s) => s.ts >= fromTs && s.ts < toTs);
  return { ...h, swaps, window: { ...h.window, fromTs, toTs } };
}

export function gridReport(
  h: PoolHistory,
  capitalToken1: number,
  widths = DEFAULT_WIDTHS,
  rules = DEFAULT_RULES,
  costs: CostModel = DEFAULT_COSTS,
): GridReport {
  const { passive, rows, best } = runGrid(h, capitalToken1, widths, rules, costs);
  const mid = (h.window.fromTs + h.window.toTs) / 2;
  const a = sliceHistory(h, h.window.fromTs, mid);
  const b = sliceHistory(h, mid, h.window.toTs + 1);
  let wf: GridReport["walkForward"] = { chosenOnFirstHalf: null, secondHalfExcessVsPassive: null, secondHalfBeatsPassive: null };
  if (a.swaps.length >= 10 && b.swaps.length >= 10) {
    const ga = runGrid(a, capitalToken1, widths, rules, costs);
    if (ga.best) {
      const cfg = ga.best.config;
      const pb = backtest(b, { width: "full", rule: { kind: "none" } }, capitalToken1, costs);
      const rb = backtest(b, cfg, capitalToken1, costs);
      wf = {
        chosenOnFirstHalf: ga.best.label,
        secondHalfExcessVsPassive: rb.finalValue - pb.finalValue,
        secondHalfBeatsPassive: rb.finalValue > pb.finalValue,
      };
    }
  }
  return {
    pool: h.pool,
    venue: h.venue,
    pair: `${h.token0.symbol}/${h.token1.symbol}`,
    capitalToken1,
    costs,
    passive,
    rows,
    best,
    beatsPassive: best !== null && best.finalValue > passive.finalValue,
    walkForward: wf,
  };
}

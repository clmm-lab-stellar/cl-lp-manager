// SPDX-License-Identifier: Apache-2.0
// Markdown rendering for fee stats and grid reports.
import type { FeeStats } from "../backtest/fees.ts";
import type { GridReport } from "../backtest/grid.ts";

const usd = (v: number | null): string => (v === null ? "n/a" : `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
const pct = (v: number | null): string => (v === null ? "n/a" : `${(v * 100).toFixed(2)}%`);
const num = (v: number, d = 2): string => v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

export function feeTable(rows: FeeStats[]): string {
  const out = [
    "| Venue | Pool | Pair | Fee | Swaps | Days | Volume (USD) | LP fees (USD) | LP fees/day | TVL (USD) | Pool fee APR |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    out.push(
      `| ${r.venue} | \`${r.pool.slice(0, 8)}…\` | ${r.pair} | ${(r.feePpm / 1e4).toFixed(2)}% | ${r.swaps} | ${r.days.toFixed(1)} | ${usd(r.volumeUsd)} | ${usd(r.lpFeesUsd)} | ${usd(r.lpFeesUsdPerDay)} | ${usd(r.tvlUsd)} | ${pct(r.poolFeeApr)} |`,
    );
  }
  return out.join("\n");
}

export function gridMarkdown(g: GridReport, token1Usd: number | null): string {
  const toUsd = (v: number): string => (token1Usd === null ? `${num(v)} t1` : usd(v * token1Usd));
  const lines = [
    `### ${g.pair} (${g.venue}, \`${g.pool}\`)`,
    "",
    `Capital ${num(g.capitalToken1)} token1${token1Usd !== null ? ` (${usd(g.capitalToken1 * token1Usd)})` : ""}. Costs per rebalance: pool fee x ${g.costs.swapFeeMultiplier} + ${pct(g.costs.slippage)} slippage on traded value + ${g.costs.fixedPerRebalance} token1 fixed.`,
    "",
    `Passive full range: final ${toUsd(g.passive.finalValue)}, fees ${toUsd(g.passive.feeIncome)} (fee APR ${pct(g.passive.feeApr)}), IL ${toUsd(g.passive.impermanentLoss)}, LVR ${toUsd(g.passive.lvr)}, HODL ${toUsd(g.passive.hodlValue)}.`,
    "",
    "| Config | Fees | Fee APR | IL | LVR | Rebal. | Rebal. cost | In range | Pool share | Final | vs passive | vs HODL | vs HODL APR |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of g.rows) {
    lines.push(
      `| ${r.label} | ${toUsd(r.feeIncome)} | ${pct(r.feeApr)} | ${toUsd(r.impermanentLoss)} | ${toUsd(r.lvr)} | ${r.rebalances} | ${toUsd(r.rebalanceCost)} | ${pct(r.timeInRange)} | ${pct(r.avgPoolShare)} | ${toUsd(r.finalValue)} | ${toUsd(r.excessVsPassive)} | ${toUsd(r.excessVsHodl)} | ${pct(r.excessVsHodlApr)} |`,
    );
  }
  lines.push("");
  const crowded = g.rows.filter((r) => r.avgPoolShare > 0.2).length;
  if (crowded > 0)
    lines.push(
      `Warning: ${crowded} configs would hold over 20% of the pool's active liquidity; the price-taker model is weak there (fees are a share of observed volume, see SPEC.md 3.2).`,
      "",
    );
  lines.push(
    g.best
      ? `Best in-sample: **${g.best.label}**, ${toUsd(g.best.excessVsPassive)} vs passive (${g.beatsPassive ? "beats" : "does not beat"} passive after costs).`
      : "No eligible config: every config is over the 20% pool-share limit or none ran.",
  );
  const wf = g.walkForward;
  lines.push(
    wf.chosenOnFirstHalf
      ? `Walk-forward: chosen on first half = ${wf.chosenOnFirstHalf}; second half vs passive ${toUsd(wf.secondHalfExcessVsPassive ?? 0)} (${wf.secondHalfBeatsPassive ? "beats" : "does not beat"}).`
      : "Walk-forward: not enough swaps in one half.",
  );
  return lines.join("\n");
}

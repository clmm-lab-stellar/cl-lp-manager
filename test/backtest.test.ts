// SPDX-License-Identifier: Apache-2.0
// Closed-form checks for the backtester on synthetic price paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { backtest } from "../src/backtest/engine.ts";
import { feeStats } from "../src/backtest/fees.ts";
import { gridReport, parseRule } from "../src/backtest/grid.ts";
import { amountsForLiquidity, rangeAround } from "../src/math/clmm.ts";
import { swapStep, synthetic } from "./synthetic.ts";

const close = (a: number, b: number, rel = 1e-9) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const NO_COSTS = { slippage: 0, fixedPerRebalance: 0, swapFeeMultiplier: 1 };

test("full-range impermanent loss matches 2*sqrt(r)/(1+r) - 1", () => {
  for (const r of [0.25, 0.5, 1.5, 4]) {
    const h = synthetic([swapStep(0, 1, 1, 1e9, 0), swapStep(86400, 1, r, 1e9, 0)], 0);
    const res = backtest(h, { width: "full", rule: { kind: "none" } }, 1000, NO_COSTS);
    close(res.finalValue / res.hodlValue - 1, (2 * Math.sqrt(r)) / (1 + r) - 1, 1e-12);
    close(res.impermanentLoss, res.finalValue - res.hodlValue);
    assert.equal(res.feeIncome, 0);
  }
});

test("concentrated position that exits above holds L(sqrtB - sqrtA) of token1", () => {
  const w = 0.02;
  const h = synthetic([swapStep(0, 1, 1, 1e9, 0), swapStep(3600, 1, 1.1, 1e9, 0)], 0);
  const res = backtest(h, { width: w, rule: { kind: "none" } }, 1000, NO_COSTS);
  const r = rangeAround(1, w);
  const L = 1000 / 2 / (1 - 1 / Math.sqrt(1 + w)); // value = 2 L sqrtP (1 - 1/k) at P=1
  close(res.finalValue, L * (r.sqrtB - r.sqrtA), 1e-9);
  const start = amountsForLiquidity(L, 1, r);
  close(res.hodlValue, start.x * 1.1 + start.y, 1e-9);
  assert.equal(res.timeInRange, 0.5);
});

test("fees: share L/(L+Lpool) of fee on input, minus protocol share", () => {
  const Lpool = 1e6;
  const fee = 0.003;
  const swaps = [swapStep(0, 1, 1, Lpool, fee)];
  for (let i = 1; i <= 20; i++) swaps.push(swapStep(i * 60, i % 2 ? 1 : 1.001, i % 2 ? 1.001 : 1, Lpool, fee));
  const h = synthetic(swaps, 3000, 0.25);
  const res = backtest(h, { width: "full", rule: { kind: "none" } }, 1000, NO_COSTS);
  const Lme = 1000 / 2; // value 2 L sqrtP at P = 1
  const share = Lme / (Lme + Lpool);
  let expected = 0;
  for (const s of swaps) {
    const in0 = Math.max(s.amount0, 0);
    const in1 = Math.max(s.amount1, 0);
    expected += (in0 * s.price + in1) * fee * 0.75 * share;
  }
  close(res.feeIncome, expected, 1e-9);
  close(res.avgPoolShare, share, 1e-12);
  const fs = feeStats(h);
  close(fs.lpFeesUsd!, fs.volumeUsd! * fee * 0.75, 1e-12);
});

test("LVR on an alternating path equals the closed form L*sqrtP*(sqrt r - 1)^2 per up-move plus mirror", () => {
  const r = 1.01;
  const n = 50;
  const swaps = [swapStep(0, 1, 1, 1e12, 0)];
  for (let i = 1; i <= 2 * n; i++) swaps.push(swapStep(i, i % 2 ? 1 : r, i % 2 ? r : 1, 1e12, 0));
  const h = synthetic(swaps, 0);
  const res = backtest(h, { width: "full", rule: { kind: "none" } }, 2000, NO_COSTS);
  const L = 1000; // 2 L sqrt(1) = 2000
  const up = L * 1 * (Math.sqrt(r) - 1) ** 2;
  const down = L * Math.sqrt(r) * (1 / Math.sqrt(r) - 1) ** 2;
  close(res.lvr, n * (up + down), 1e-9);
  assert.ok(res.lvr > 0);
});

test("out-of-range rebalance re-centres 50/50 and pays fee+slippage on half the value plus fixed", () => {
  const w = 0.01;
  const h = synthetic([swapStep(0, 1, 1, 1e9, 0), swapStep(60, 1, 1.05, 1e9, 0)], 0);
  const costs = { slippage: 0.001, fixedPerRebalance: 0.5, swapFeeMultiplier: 1 };
  const res = backtest(h, { width: w, rule: { kind: "out-of-range", delaySec: 0 } }, 1000, costs);
  const r = rangeAround(1, w);
  const L = 1000 / 2 / (1 - 1 / Math.sqrt(1 + w));
  const v = L * (r.sqrtB - r.sqrtA);
  const cost = (v / 2) * 0.001 + 0.5;
  assert.equal(res.rebalances, 1);
  close(res.rebalanceCost, cost, 1e-9);
  close(res.finalValue, v - cost, 1e-9);
});

test("out-of-range delay waits until price has been outside for delaySec", () => {
  const w = 0.01;
  const swaps = [swapStep(0, 1, 1, 1e9, 0), swapStep(60, 1, 1.05, 1e9, 0), swapStep(1000, 1.05, 1.05, 1e9, 0), swapStep(4000, 1.05, 1.05, 1e9, 0)];
  const res = backtest(synthetic(swaps, 0), { width: w, rule: { kind: "out-of-range", delaySec: 3600 } }, 1000, NO_COSTS);
  assert.equal(res.rebalances, 1); // triggers at ts=4000 (3940 s after leaving at ts=60)... only once
  const none = backtest(synthetic(swaps.slice(0, 3), 0), { width: w, rule: { kind: "out-of-range", delaySec: 3600 } }, 1000, NO_COSTS);
  assert.equal(none.rebalances, 0);
});

test("constant price: no IL, no LVR, HODL equals initial", () => {
  const swaps = [swapStep(0, 2, 2, 1e6, 0.003), swapStep(10, 2, 2, 1e6, 0.003)];
  const res = backtest(synthetic(swaps), { width: 0.05, rule: { kind: "none" } }, 1000, NO_COSTS);
  close(res.impermanentLoss, 0);
  close(res.lvr, 0);
  close(res.hodlValue, 1000);
});

test("grid runs widths x rules and reports a walk-forward pick", () => {
  const swaps = [swapStep(0, 1, 1, 1e6, 0.003)];
  let p = 1;
  let seed = 7;
  for (let i = 1; i < 400; i++) {
    seed = (seed * 16807) % 2147483647;
    const q = p * (1 + ((seed / 2147483647) - 0.5) * 0.004);
    swaps.push(swapStep(i * 600, p, q, 1e6, 0.003));
    p = q;
  }
  const g = gridReport(synthetic(swaps), 1000, [0.001, 0.01], [parseRule("none"), parseRule("oor+600s"), parseRule("thr0.8")]);
  assert.equal(g.rows.length, 6);
  assert.ok(g.best);
  assert.ok(g.walkForward.chosenOnFirstHalf);
  assert.throws(() => parseRule("bogus"));
});

test("trace (CLP-016): off by default; samples end at finalValue and track range bounds", () => {
  const Lpool = 1e6;
  const swaps = [swapStep(0, 1, 1, Lpool, 0.003)];
  for (let i = 1; i <= 50; i++) swaps.push(swapStep(i * 600, 1 + (i - 1) * 0.002, 1 + i * 0.002, Lpool, 0.003));
  const h = synthetic(swaps, 0);
  const cfg = { width: 0.01, rule: { kind: "out-of-range" as const, delaySec: 0 } };
  const plain = backtest(h, cfg, 1000);
  assert.equal(plain.trace, undefined);
  const res = backtest(h, cfg, 1000, undefined, { traceEverySec: 3600 });
  const t = res.trace!;
  assert.ok(t.length >= 2 && t.length <= 2 + Math.ceil((50 * 600) / 3600));
  assert.equal(t[0]!.ts, 0);
  const tail = t[t.length - 1]!;
  assert.equal(tail.ts, 50 * 600);
  close(tail.value, res.finalValue, 1e-12);
  close(tail.hodl, res.hodlValue, 1e-12);
  close(tail.fees, res.feeIncome, 1e-12);
  for (let i = 1; i < t.length; i++) assert.ok(t[i]!.ts > t[i - 1]!.ts, "strictly increasing time");
  assert.ok(res.rebalances > 0);
  assert.ok(t.some((p) => p.lower !== null && p.lower > 1.01), "range moved up after rebalances");
  assert.ok(t.every((p) => p.lower !== null && p.upper !== null && p.lower < p.upper));
  // results identical with or without tracing
  close(res.finalValue, plain.finalValue, 1e-15);
  const full = backtest(h, { width: "full", rule: { kind: "none" } }, 1000, undefined, { traceEverySec: 3600 });
  assert.ok(full.trace!.every((p) => p.lower === null && p.upper === null));
});

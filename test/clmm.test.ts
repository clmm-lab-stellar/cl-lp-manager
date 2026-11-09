// SPDX-License-Identifier: Apache-2.0
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FULL_RANGE,
  amountsForLiquidity,
  inRangeFraction,
  liquidityForValue,
  positionValue,
  priceToTick,
  rangeAround,
  tickToPrice,
} from "../src/math/clmm.ts";

const close = (a: number, b: number, rel = 1e-9) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${a} != ${b}`);

test("full range holds L/sqrtP of token0 and L*sqrtP of token1; value 2L*sqrtP", () => {
  const { x, y } = amountsForLiquidity(100, 4, FULL_RANGE);
  close(x, 50);
  close(y, 200);
  close(positionValue(100, 4, FULL_RANGE), 400);
});

test("symmetric multiplicative range splits value 50/50 at its centre", () => {
  const r = rangeAround(2.5, 0.03);
  const L = liquidityForValue(1000, 2.5, r);
  const { x, y } = amountsForLiquidity(L, 2.5, r);
  close(x * 2.5, 500);
  close(y, 500);
});

test("above the range the position is all token1: L(sqrtB - sqrtA)", () => {
  const r = rangeAround(1, 0.01);
  const L = 1e6;
  const { x, y } = amountsForLiquidity(L, 1.5, r);
  assert.equal(x, 0);
  close(y, L * (r.sqrtB - r.sqrtA));
  const below = amountsForLiquidity(L, 0.5, r);
  assert.equal(below.y, 0);
  close(below.x, L * (1 / r.sqrtA - 1 / r.sqrtB));
});

test("inRangeFraction measures overlap in sqrtP (up) and 1/sqrtP (down)", () => {
  const r = { sqrtA: 1, sqrtB: 2 };
  close(inRangeFraction(1, 4, r), 1);
  close(inRangeFraction(2.25, 9, r), (2 - 1.5) / (3 - 1.5)); // sqrtP 1.5 -> 3, inside up to 2
  close(inRangeFraction(9, 2.25, r), (1 / 1.5 - 1 / 2) / (1 / 1.5 - 1 / 3)); // falling 3 -> 1.5
  assert.equal(inRangeFraction(9, 16, r), 0);
  assert.equal(inRangeFraction(2, 2, r), 1);
  assert.equal(inRangeFraction(5, 5, r), 0);
});

test("tick <-> price round trip (1.0001^t)", () => {
  close(tickToPrice(0), 1);
  assert.equal(priceToTick(tickToPrice(-16193) * 1.00000001), -16193);
});

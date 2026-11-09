// SPDX-License-Identifier: Apache-2.0
// Decoders and fixture integrity.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { expertAquaToSwaps, geckoToSwaps, type GeckoEvent } from "../src/data/aquarius.ts";
import { decodeSushiSwap, priceFromSqrtX96 } from "../src/data/sushi.ts";
import { ledgerFromPagingToken, type ExpertEvent } from "../src/data/stellar.ts";
import { fromFile, toFile, type PoolHistoryFile } from "../src/types.ts";
import { feeStats } from "../src/backtest/fees.ts";
import { swapStep, synthetic } from "./synthetic.ts";

const close = (a: number, b: number, rel = 1e-9) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const root = new URL("..", import.meta.url).pathname;

test("priceFromSqrtX96 applies decimals", () => {
  close(priceFromSqrtX96(2n ** 96n, 7, 7), 1);
  close(priceFromSqrtX96(2n ** 96n, 7, 6), 10);
  close(priceFromSqrtX96(2n ** 97n, 7, 7), 4);
});

test("ledgerFromPagingToken reads the TOID ledger", () => {
  const ledger = 65290132;
  const toid = (BigInt(ledger) << 32n) | 4097n;
  assert.equal(ledgerFromPagingToken(`${toid}-0003`), ledger);
});

test("decodeSushiSwap turns an event body into human units", () => {
  const body = nativeToScVal(
    {
      amount0: 1_000_000n,
      amount1: -198_899n,
      liquidity: 94_196_680n,
      recipient: "CCKXBE5GKJOCE7IKL64HLYKW3IJSUPVOLC4CS77GQT5QQHDZLDYV3DFT",
      sender: "CCKXBE5GKJOCE7IKL64HLYKW3IJSUPVOLC4CS77GQT5QQHDZLDYV3DFT",
      sqrt_price_x96: 35259544915266058490181219709n,
      tick: -16193,
    },
    {
      type: {
        amount0: ["symbol", "i128"],
        amount1: ["symbol", "i128"],
        liquidity: ["symbol", "u128"],
        recipient: ["symbol", "address"],
        sender: ["symbol", "address"],
        sqrt_price_x96: ["symbol", "u256"],
        tick: ["symbol", "i32"],
      },
    },
  );
  const e: ExpertEvent = {
    id: "x",
    ts: 1791575372,
    contract: "C",
    topics: ["swap"],
    topicsXdr: [],
    bodyXdr: (body as xdr.ScVal).toXDR("base64"),
    paging_token: `${(65000000n << 32n) | 1n}-0000`,
  };
  const t = { address: "", symbol: "", decimals: 7 };
  const s = decodeSushiSwap(e, t, t)!;
  close(s.amount0, 0.1);
  close(s.amount1, -0.0198899);
  close(s.price, (35259544915266058490181219709 / 2 ** 96) ** 2, 1e-12);
  close(s.liquidity!, 9.419668);
  assert.equal(s.ledger, 65000000);
  assert.equal(decodeSushiSwap({ ...e, topics: ["mint"] }, t, t), null);
});

test("geckoToSwaps recovers active liquidity from consecutive prices", () => {
  const L = 123456.789;
  const fee = 0.001;
  const path = [1, 1.002, 0.999, 1.0005, 0.98];
  const events: GeckoEvent[] = [];
  for (let i = 1; i < path.length; i++) {
    const s = swapStep(i, path[i - 1]!, path[i]!, L, fee);
    const e: GeckoEvent = {
      block: { blockNumber: i, blockTimestamp: i },
      eventType: "swap",
      txnId: String(i),
      pairId: "P",
      priceNative: String(path[i]),
    };
    if (s.amount0 > 0) {
      e.asset0In = String(s.amount0);
      e.asset1Out = String(-s.amount1);
    } else {
      e.asset1In = String(s.amount1);
      e.asset0Out = String(-s.amount0);
    }
    events.push(e);
  }
  events.splice(2, 0, { block: { blockNumber: 2, blockTimestamp: 2 }, eventType: "join", txnId: "j", pairId: "P" });
  const swaps = geckoToSwaps(events, fee);
  assert.equal(swaps.length, 4);
  assert.equal(swaps[0]!.liquidity, null); // no predecessor price
  for (const s of swaps.slice(1)) close(s.liquidity!, L, 1e-6);
});

test("PoolHistory file round trip", () => {
  const h = synthetic([swapStep(0, 1, 1.01, 1e6, 0.003), swapStep(5, 1.01, 1, 1e6, 0.003)]);
  assert.deepEqual(fromFile(JSON.parse(JSON.stringify(toFile(h))) as PoolHistoryFile), h);
});

test("captured fixtures parse, are chronological, and carry provenance", () => {
  let n = 0;
  for (const venue of ["sushi", "aquarius"]) {
    const dir = join(root, "fixtures", venue);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".history.json"))) {
      const h = fromFile(JSON.parse(readFileSync(join(dir, f), "utf8")) as PoolHistoryFile);
      assert.equal(h.schema, "clp.pool-history.v1");
      assert.ok(h.provenance.sources.length > 0 && h.provenance.capturedAt, `${f} provenance`);
      for (let i = 1; i < h.swaps.length; i++) assert.ok(h.swaps[i]!.ledger >= h.swaps[i - 1]!.ledger, `${f} order at ${i}`);
      for (const s of h.swaps) assert.ok(s.price > 0 && Number.isFinite(s.price), `${f} price`);
      const fs = feeStats(h);
      assert.ok(fs.volumeToken1 >= 0);
      n++;
    }
  }
  assert.ok(n >= 0);
});

test("expertAquaToSwaps pairs trade with pool_state of the same operation", () => {
  const q = 2n ** 96n;
  const evs = [
    { ts: 10, paging_token: "100-0002", topics: ["trade", "T1", "T0", "G"], body: [2_000_000n, 1_990_000n, 2_000n] },
    { ts: 10, paging_token: "100-0003", topics: ["update_reserves"], body: [1n, 1n] },
    { ts: 10, paging_token: "100-0004", topics: ["pool_state"], body: [q, 0, 50_000_000n] },
    { ts: 20, paging_token: "200-0001", topics: ["pool_state"], body: [q * 2n, 5, 1n] }, // no trade: ignored
    { ts: 30, paging_token: "300-0002", topics: ["trade", "T0", "T1", "G"], body: [10_000_000n, 9_000_000n, 10_000n] },
    { ts: 30, paging_token: "300-0004", topics: ["pool_state"], body: [q, 0, 70_000_000n] },
  ];
  const s = expertAquaToSwaps(evs, "T0", "T1", 7, 7, (t) => Number(t.split("-")[0]));
  assert.equal(s.length, 2);
  close(s[0]!.amount1, 0.2);
  close(s[0]!.amount0, -0.199);
  close(s[0]!.price, 1);
  close(s[0]!.liquidity!, 5);
  assert.equal(s[0]!.ledger, 100);
  close(s[1]!.amount0, 1);
  close(s[1]!.amount1, -0.9);
  close(s[1]!.liquidity!, 7);
});

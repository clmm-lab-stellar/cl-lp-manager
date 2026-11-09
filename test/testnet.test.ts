// SPDX-License-Identifier: Apache-2.0
// Encoders for the testnet vault demo (CLP-018) and the recorded run, if present.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { Keypair, scValToNative, xdr } from "@stellar/stellar-sdk";
import {
  configScVal,
  contractErrorCode,
  isqrt,
  poolPriceScaled,
  sqrtPriceX96,
  stateFromInstanceStorage,
  stellarAsset,
  structScVal,
  sym,
  u32,
  vaultErrorName,
} from "../src/testnet/encode.ts";

test("isqrt and sqrtPriceX96", () => {
  assert.equal(isqrt(0n), 0n);
  assert.equal(isqrt(15n), 3n);
  assert.equal(isqrt(16n), 4n);
  assert.equal(isqrt(10n ** 40n), 10n ** 20n);
  assert.equal(sqrtPriceX96(1n, 1n), 2n ** 96n);
  assert.equal(sqrtPriceX96(4n, 1n), 2n ** 97n);
});

test("pool price from sqrt matches the vault's fixed point within 1 unit in 1e9", () => {
  assert.equal(poolPriceScaled(2n ** 96n), 1_000_000_000n);
  const p = poolPriceScaled(sqrtPriceX96(1004n, 1000n));
  assert.ok(p >= 1_003_999_990n && p <= 1_004_000_000n, String(p));
});

test("contract error parsing", () => {
  const msg = "HostError: Error(Contract, #4)\n\nEvent log (newest first): ...";
  assert.equal(contractErrorCode(msg), 4);
  assert.equal(vaultErrorName(msg), "PriceDeviation");
  assert.equal(vaultErrorName("Error(Contract, #6)"), "Cooldown");
  assert.equal(vaultErrorName("Error(Auth, InvalidAction)"), null);
});

test("struct keys are sorted; Config encodes every field", () => {
  const s = structScVal({ b: u32(2), a: u32(1) });
  assert.deepEqual(Object.keys(scValToNative(s) as object), ["a", "b"]);
  const g = Keypair.random().publicKey();
  const c = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  const v = scValToNative(
    configScVal({ admin: g, keeper: g, pool: c, token0: c, token1: c, oracle: c, decimals0: 7, decimals1: 7, halfWidthTicks: 25, maxDevBps: 50, maxAge: 600, maxSlippageBps: 30, minInterval: 3600, cap: 10n ** 13n }),
  ) as Record<string, unknown>;
  assert.equal(Object.keys(v).length, 14);
  assert.equal(v.half_width_ticks, 25);
  assert.equal(v.cap, 10n ** 13n);
  assert.deepEqual(scValToNative(stellarAsset(c)), ["Stellar", c]);
});

test("State is found in instance storage by its enum key", () => {
  const state = structScVal({
    tick_lower: xdr.ScVal.scvI32(10),
    tick_upper: xdr.ScVal.scvI32(70),
    liquidity: xdr.ScVal.scvU32(0),
    total_shares: xdr.ScVal.scvU32(5),
    last_rebalance: xdr.ScVal.scvU32(123),
    rebalances: u32(1),
    paused: xdr.ScVal.scvBool(false),
  });
  const storage = [
    new xdr.ScMapEntry({ key: xdr.ScVal.scvVec([sym("Config")]), val: u32(0) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvVec([sym("State")]), val: state }),
  ];
  const got = stateFromInstanceStorage(storage);
  assert.equal(got?.tickLower, 10);
  assert.equal(got?.rebalances, 1);
  assert.equal(stateFromInstanceStorage([]), null);
});

const RUN = new URL("../fixtures/testnet/vault-run.json", import.meta.url);
test("recorded testnet run (if present) is testnet-only, secret-free and matches the scenario", { skip: !existsSync(RUN) }, () => {
  const text = readFileSync(RUN, "utf8");
  assert.doesNotMatch(text, /\bS[A-D][A-Z2-7]{54}\b/, "no secret seed in the run file");
  const run = JSON.parse(text) as { network: string; networkPassphrase: string; steps: { id: string; outcome: string; error?: string; tx?: { hash: string } }[] };
  assert.equal(run.network, "testnet");
  assert.equal(run.networkPassphrase, "Test SDF Network ; September 2015");
  const got = run.steps.map((s) => `${s.id}:${s.outcome === "success" ? "success" : s.error}`);
  assert.deepEqual(got, ["deposit:success", "in-range:InRange", "stale:OracleStale", "deviation:PriceDeviation", "rebalance:success", "cooldown:Cooldown", "withdraw:success"]);
  for (const s of run.steps) if (s.outcome === "success") assert.match(s.tx!.hash, /^[0-9a-f]{64}$/);
});

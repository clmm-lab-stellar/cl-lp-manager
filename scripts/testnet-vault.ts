// SPDX-License-Identifier: Apache-2.0
// CLP-018: deploy the vault, the demo pool and the demo oracle to TESTNET and run the
// oracle-bounded rebalance scenario (same steps as contracts/vault/tests/testnet_scenario.rs).
//
//   cd contracts && stellar contract build && cd ..
//   node scripts/testnet-vault.ts            # ~25 transactions, about 4 minutes
//
// TESTNET ONLY. Keys are generated in memory with Keypair.random(), funded by friendbot, and
// never written anywhere (G-SECRETS). The output file holds public keys, contract ids, tx
// hashes, ledgers and outcomes only: fixtures/testnet/vault-run.json.
// Refusals are shown by simulation (the RPC rejects the call before anything is sent), which is
// exactly what a keeper sees; no failing transaction is submitted.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import {
  Address,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import {
  addr,
  configScVal,
  decodeState,
  i128,
  i32,
  poolPriceScaled,
  sqrtPriceX96,
  stellarAsset,
  u256,
  u32,
  u64,
  vaultErrorName,
  type VaultConfig,
  type VaultState,
} from "../src/testnet/encode.ts";

const RPC_URL = "https://soroban-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";
const PASSPHRASE = Networks.TESTNET;
const EXPLORER = "https://stellar.expert/explorer/testnet";
if (PASSPHRASE !== "Test SDF Network ; September 2015") throw new Error("refusing: not the testnet passphrase");

const root = new URL("..", import.meta.url).pathname;
const WASM_DIR = `${root}contracts/target/wasm32v1-none/release/`;
const OUT = `${root}fixtures/testnet/vault-run.json`;

/** Must match contracts/vault/tests/testnet_scenario.rs. */
export const SCENARIO = {
  decimals: 7,
  tickSpacing: 10,
  poolFeeBps: 5,
  halfWidthTicks: 25,
  maxDevBps: 50,
  maxAge: 600,
  maxSlippageBps: 30,
  minInterval: 3600,
  cap: 1_000_000n * 10_000_000n,
  oracleOne: 100_000_000_000_000n, // 1.0 at 14 decimals
  unit: 10_000_000n,
} as const;

// Retry connection-level fetch failures (DNS, resets) with backoff; HTTP statuses pass through.
// Resending a signed transaction is safe: the same hash comes back as DUPLICATE or is found.
{
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    let last: unknown;
    for (let i = 0; i < 14; i++) {
      try {
        return await orig(input, init);
      } catch (e) {
        last = e;
        await sleep(Math.min(1500 * (i + 1), 8000));
      }
    }
    throw last;
  }) as typeof fetch;
}

const server = new rpc.Server(RPC_URL);
const pace = () => sleep(550); // <= 2 requests/s to public RPC

interface StepRecord {
  n: number;
  id: string;
  title: string;
  actor: "admin" | "keeper" | "user";
  call: string;
  outcome: "success" | "refused";
  /** VaultError name for refusals, from the simulation error. */
  error?: string;
  /** Expected outcome per the scenario; the run fails if they differ. */
  expected: string;
  tx?: { hash: string; ledger: number; url: string; feeCharged?: string };
  simulatedAtLedger?: number;
  result?: unknown;
  stateAfter?: VaultState;
  note?: string;
  at: string;
}

const steps: StepRecord[] = [];
const setupTxs: { what: string; hash: string; ledger: number; url: string }[] = [];

function log(msg: string, extra: unknown = ""): void {
  process.stdout.write(`${new Date().toISOString()} ${msg} ${extra === "" ? "" : JSON.stringify(extra, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}\n`);
}

async function friendbot(pub: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(pub)}`);
    await pace();
    if (r.ok) break;
    const body = await r.text();
    if (body.includes("createAccountAlreadyExist")) break;
    if (i === 4) throw new Error(`friendbot ${r.status}: ${body.slice(0, 200)}`);
    await sleep(3000);
  }
  for (let i = 0; i < 30; i++) {
    try {
      await server.getAccount(pub);
      await pace();
      return;
    } catch {
      await sleep(2000);
    }
  }
  throw new Error(`account ${pub} not visible after friendbot`);
}

interface Landed {
  hash: string;
  ledger: number;
  returnValue?: xdr.ScVal;
  feeCharged?: string;
}

async function sendAndWait(tx: ReturnType<TransactionBuilder["build"]>): Promise<Landed> {
  if (tx.networkPassphrase !== PASSPHRASE) throw new Error("refusing to send outside testnet");
  const sent = await server.sendTransaction(tx);
  await pace();
  if (sent.status === "ERROR") throw new Error(`send ${sent.hash}: ${sent.errorResult?.toXdr("base64") ?? ""}`);
  for (let i = 0; i < 90; i++) {
    const got = await server.getTransaction(sent.hash);
    await pace();
    if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      const fee = got.resultXdr.feeCharged.toString();
      return { hash: sent.hash, ledger: got.ledger, returnValue: got.returnValue, feeCharged: fee };
    }
    if (got.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(`tx ${sent.hash} FAILED`);
    await sleep(1000);
  }
  throw new Error(`timeout waiting for ${sent.hash}`);
}

async function buildTx(source: Keypair, ops: xdr.Operation[]) {
  const acct = await server.getAccount(source.publicKey());
  await pace();
  const b = new TransactionBuilder(acct, { fee: "2000000", networkPassphrase: PASSPHRASE }).setTimeout(120);
  for (const op of ops) b.addOperation(op);
  return b.build();
}

/** Classic operations (no simulation). */
async function classic(source: Keypair, ops: xdr.Operation[], signers: Keypair[] = []): Promise<Landed> {
  const tx = await buildTx(source, ops);
  tx.sign(source, ...signers);
  return sendAndWait(tx);
}

type SimResult = { ok: true; tx: ReturnType<TransactionBuilder["build"]>; retval?: xdr.ScVal; ledger: number } | { ok: false; error: string; ledger: number };

async function simulate(source: Keypair, op: xdr.Operation): Promise<SimResult> {
  const tx = await buildTx(source, [op]);
  const sim = await server.simulateTransaction(tx);
  await pace();
  if (!rpc.Api.isSimulationSuccess(sim)) return { ok: false, error: "error" in sim ? String(sim.error) : "simulation failed", ledger: sim.latestLedger };
  return { ok: true, tx: rpc.assembleTransaction(tx, sim).build(), retval: sim.result?.retval, ledger: sim.latestLedger };
}

/** Simulate, sign as source (source-account auth covers require_auth), send, wait. */
async function invoke(source: Keypair, op: xdr.Operation): Promise<Landed> {
  const s = await simulate(source, op);
  if (!s.ok) throw new Error(`simulation failed: ${s.error.slice(0, 600)}`);
  s.tx.sign(source);
  return sendAndWait(s.tx);
}

const call = (contract: string, fn: string, args: xdr.ScVal[]) => Operation.invokeContractFunction({ contract, function: fn, args });

async function upload(source: Keypair, file: string): Promise<{ hash: string; sha256: string; tx: Landed; bytes: number }> {
  const wasm = readFileSync(WASM_DIR + file);
  const sha256 = createHash("sha256").update(wasm).digest("hex");
  const tx = await invoke(source, Operation.uploadContractWasm({ wasm }));
  const hash = Buffer.from(scValToNative(tx.returnValue!) as Uint8Array).toString("hex");
  if (hash !== sha256) throw new Error(`uploaded hash ${hash} != local sha256 ${sha256}`);
  return { hash, sha256, tx, bytes: wasm.length };
}

async function create(source: Keypair, wasmHash: string, args: xdr.ScVal[]): Promise<{ id: string; tx: Landed }> {
  const tx = await invoke(
    source,
    Operation.createCustomContract({ address: new Address(source.publicKey()), wasmHash: Buffer.from(wasmHash, "hex"), salt: randomBytes(32), constructorArgs: args }),
  );
  return { id: Address.fromScVal(tx.returnValue!).toString(), tx };
}

function rec(what: string, t: Landed): void {
  setupTxs.push({ what, hash: t.hash, ledger: t.ledger, url: `${EXPLORER}/tx/${t.hash}` });
  log(`setup: ${what}`, { hash: t.hash, ledger: t.ledger });
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  // Throwaway keys: memory only.
  const admin = Keypair.random();
  const keeper = Keypair.random();
  const user = Keypair.random();
  for (const k of [admin, keeper, user]) await friendbot(k.publicKey());
  log("funded", { admin: admin.publicKey(), keeper: keeper.publicKey(), user: user.publicKey() });

  const wasm = {
    vault: await upload(admin, "sik_cl_lp_manager_vault.wasm"),
    pool: await upload(admin, "sik_cl_lp_manager_demo_pool.wasm"),
    oracle: await upload(admin, "sik_cl_lp_manager_demo_oracle.wasm"),
  };
  for (const [k, w] of Object.entries(wasm)) rec(`upload ${k} wasm (${w.bytes} bytes, sha256 ${w.sha256.slice(0, 12)})`, w.tx);

  // Two classic test assets issued by the admin, wrapped as Stellar Asset Contracts.
  const A0 = new Asset("CLPT0", admin.publicKey());
  const A1 = new Asset("CLPT1", admin.publicKey());
  for (const a of [A0, A1]) rec(`deploy SAC for ${a.getCode()}`, await invoke(admin, Operation.createStellarAssetContract({ asset: a })));
  const t0 = A0.contractId(PASSPHRASE);
  const t1 = A1.contractId(PASSPHRASE);
  rec(
    "user trustlines CLPT0, CLPT1",
    await classic(user, [Operation.changeTrust({ asset: A0 }), Operation.changeTrust({ asset: A1 })]),
  );
  rec(
    "issue 10,000 CLPT0 + 10,000 CLPT1 to user",
    await classic(admin, [
      Operation.payment({ destination: user.publicKey(), asset: A0, amount: "10000" }),
      Operation.payment({ destination: user.publicKey(), asset: A1, amount: "10000" }),
    ]),
  );

  const oracle = await create(admin, wasm.oracle.hash, [addr(admin.publicKey())]);
  rec("deploy demo oracle", oracle.tx);
  const pool = await create(admin, wasm.pool.hash, [addr(admin.publicKey()), addr(t0), addr(t1), i32(SCENARIO.tickSpacing), u32(SCENARIO.poolFeeBps)]);
  rec("deploy demo pool", pool.tx);
  for (const [t, code] of [[t0, "CLPT0"], [t1, "CLPT1"]] as const) {
    rec(`mint 100,000 ${code} to the demo pool (swap liquidity)`, await invoke(admin, call(t, "mint", [addr(pool.id), i128(100_000n * SCENARIO.unit)])));
  }
  const assets = xdr.ScVal.scvVec([stellarAsset(t0), stellarAsset(t1)]);
  const setPrices = (p0: bigint, ageSecs: number) => call(oracle.id, "set_prices", [assets, xdr.ScVal.scvVec([i128(p0), i128(SCENARIO.oracleOne)]), u64(ageSecs)]);
  rec("oracle: both tokens at 1.000", await invoke(admin, setPrices(SCENARIO.oracleOne, 0)));

  const cfg: VaultConfig = {
    admin: admin.publicKey(),
    keeper: keeper.publicKey(),
    pool: pool.id,
    token0: t0,
    token1: t1,
    oracle: oracle.id,
    decimals0: SCENARIO.decimals,
    decimals1: SCENARIO.decimals,
    halfWidthTicks: SCENARIO.halfWidthTicks,
    maxDevBps: SCENARIO.maxDevBps,
    maxAge: SCENARIO.maxAge,
    maxSlippageBps: SCENARIO.maxSlippageBps,
    minInterval: SCENARIO.minInterval,
    cap: SCENARIO.cap,
  };
  const vault = await create(admin, wasm.vault.hash, [configScVal(cfg)]);
  rec("deploy vault", vault.tx);

  async function readState(): Promise<VaultState> {
    const s = await simulate(keeper, call(vault.id, "get_state", []));
    if (!s.ok || !s.retval) throw new Error(`get_state failed: ${s.ok ? "no retval" : s.error}`);
    return decodeState(s.retval);
  }

  let n = 0;
  async function step(
    id: string,
    title: string,
    actor: StepRecord["actor"],
    kp: Keypair,
    fnName: string,
    args: xdr.ScVal[],
    expected: "success" | string,
    note?: string,
  ): Promise<StepRecord> {
    n++;
    const op = call(vault.id, fnName, args);
    const sim = await simulate(kp, op);
    let r: StepRecord;
    if (!sim.ok) {
      const name = vaultErrorName(sim.error);
      r = { n, id, title, actor, call: fnName, outcome: "refused", error: name ?? sim.error.slice(0, 200), expected, simulatedAtLedger: sim.ledger, at: new Date().toISOString() };
    } else {
      sim.tx.sign(kp);
      const t = await sendAndWait(sim.tx);
      r = {
        n,
        id,
        title,
        actor,
        call: fnName,
        outcome: "success",
        expected,
        tx: { hash: t.hash, ledger: t.ledger, url: `${EXPLORER}/tx/${t.hash}`, feeCharged: t.feeCharged },
        result: t.returnValue ? scValToNative(t.returnValue) : null,
        at: new Date().toISOString(),
      };
    }
    if (note) r.note = note;
    r.stateAfter = await readState();
    steps.push(r);
    log(`step ${n} ${id}: ${r.outcome}${r.error ? ` (${r.error})` : ""}`, r.tx?.hash ?? "");
    const got = r.outcome === "success" ? "success" : r.error;
    if (got !== expected) throw new Error(`step ${id}: expected ${expected}, got ${got}`);
    return r;
  }

  const U = SCENARIO.unit;
  const sqrt1004 = sqrtPriceX96(1004n, 1000n);
  const sqrt1020 = sqrtPriceX96(1020n, 1000n);
  const marketMoves: { beforeStep: number; what: string; hash: string; ledger: number; url: string }[] = [];
  async function move(what: string, op: xdr.Operation): Promise<void> {
    const t = await invoke(admin, op);
    marketMoves.push({ beforeStep: n + 1, what, hash: t.hash, ledger: t.ledger, url: `${EXPLORER}/tx/${t.hash}` });
    log(`admin: ${what}`, t.hash);
  }

  const initial = await readState();
  await step("deposit", "User deposits 1,000 CLPT0 + 1,000 CLPT1", "user", user, "deposit", [addr(user.publicKey()), i128(1_000n * U), i128(1_000n * U)], "success");
  await step("in-range", "Keeper asks to rebalance while the price is inside the range", "keeper", keeper, "rebalance", [], "InRange");

  await move("demo pool price set to 1.004 (tick 40), outside the vault range", call(pool.id, "set_slot", [u256(sqrt1004), i32(40)]));
  await move("oracle set to 1.004, stamped one hour old", setPrices(SCENARIO.oracleOne + (SCENARIO.oracleOne * 4n) / 1000n, 3600));
  await step("stale", "Keeper asks to rebalance; oracle reading is 60 minutes old (limit 10)", "keeper", keeper, "rebalance", [], "OracleStale");

  await move("oracle set to 1.014 (1.0% away from the pool), fresh", setPrices(SCENARIO.oracleOne + (SCENARIO.oracleOne * 14n) / 1000n, 0));
  await step("deviation", "Keeper asks to rebalance; oracle and pool disagree by 1.0% (limit 0.5%)", "keeper", keeper, "rebalance", [], "PriceDeviation");

  await move("oracle set to 1.004 (agrees with the pool), fresh", setPrices(SCENARIO.oracleOne + (SCENARIO.oracleOne * 4n) / 1000n, 0));
  await step("rebalance", "Keeper rebalances: all four guards pass, range re-centred on tick 40", "keeper", keeper, "rebalance", [], "success");

  await move("demo pool price set to 1.020 (tick 200)", call(pool.id, "set_slot", [u256(sqrt1020), i32(200)]));
  await move("oracle set to 1.020, fresh", setPrices(SCENARIO.oracleOne + (SCENARIO.oracleOne * 20n) / 1000n, 0));
  await step("cooldown", "Keeper asks to rebalance again minutes later (minimum interval 60 minutes)", "keeper", keeper, "rebalance", [], "Cooldown");

  await move("oracle stamped one day old", setPrices(SCENARIO.oracleOne + (SCENARIO.oracleOne * 20n) / 1000n, 86_400));
  await step(
    "withdraw",
    "User withdraws half the shares while the oracle is stale",
    "user",
    user,
    "withdraw",
    [addr(user.publicKey()), i128(1_000n * U)],
    "success",
    "Withdrawals are not oracle-gated, so exits stay open when the oracle is down.",
  );

  const out = {
    schema: "clp.testnet-run.v1",
    network: "testnet",
    networkPassphrase: PASSPHRASE,
    rpc: RPC_URL,
    explorer: EXPLORER,
    startedAt,
    finishedAt: new Date().toISOString(),
    script: "scripts/testnet-vault.ts",
    gates: ["TESTNET ONLY", "UNAUDITED", "DEMO-ONLY"],
    keys: "Generated in memory with Keypair.random() for this run, funded by friendbot, never written to disk. Only public keys are recorded.",
    honesty: [
      "The pool is contracts/demo-pool, not Aquarius: positions keep their deposited amounts and the price moves only when the admin calls set_slot.",
      "The oracle is contracts/demo-oracle: an admin-set SEP-40-shaped feed, not a real price source.",
      "Refusals were produced by simulateTransaction against the deployed contracts; no failing transaction was sent.",
      "Testnet is reset periodically; after a reset these contract ids and hashes no longer resolve.",
    ],
    accounts: { admin: admin.publicKey(), keeper: keeper.publicKey(), user: user.publicKey() },
    tokens: { token0: { code: "CLPT0", issuer: admin.publicKey(), contract: t0 }, token1: { code: "CLPT1", issuer: admin.publicKey(), contract: t1 } },
    contracts: { vault: vault.id, pool: pool.id, oracle: oracle.id },
    wasm: Object.fromEntries(Object.entries(wasm).map(([k, w]) => [k, { sha256: w.sha256, bytes: w.bytes }])),
    config: { ...cfg, cap: cfg.cap.toString() },
    scenario: { ...SCENARIO, cap: SCENARIO.cap.toString(), oracleOne: SCENARIO.oracleOne.toString(), unit: SCENARIO.unit.toString() },
    poolPriceAt1004Scaled: poolPriceScaled(sqrt1004).toString(),
    initialState: initial,
    setup: setupTxs,
    marketMoves,
    steps,
  };
  mkdirSync(new URL("../fixtures/testnet/", import.meta.url), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
  log(`wrote ${OUT}`, { steps: steps.length, setup: setupTxs.length, moves: marketMoves.length });
}

main().catch((e: unknown) => {
  process.stderr.write(`testnet-vault failed: ${(e as Error).stack ?? String(e)}\n`);
  process.exitCode = 1;
});

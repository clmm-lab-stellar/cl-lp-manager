# cl-lp-manager: specification

Normative. Code that disagrees with this file is a bug in one of them; fix the file first if the interface must change.

## 1. Scope

1. A read-only data layer that captures swap history for Sushi Stellar V3 pools and Aquarius concentrated pools into a venue-neutral `PoolHistory` file, with provenance.
2. A backtester that replays a `PoolHistory` swap by swap for a range position with half-width `w` and rebalance rule `r`, and reports fee income, impermanent loss, LVR and rebalance costs against a passive full-range LP and HODL.
3. A testnet-only Soroban vault holding one range position in an Aquarius-concentrated-shaped pool, re-centred only when an oracle-bounded check passes. Unaudited; gate G-VALUE applies (no mainnet value, ever, from this repo).

Out of scope for the first version: keeper service, DeFindex adapter (CLP-009), Sushi position-manager integration (CLP-010), reward (AQUA/Merkl) compounding.

## 2. Data

### 2.1 `PoolHistory` (`schema: "clp.pool-history.v1"`)

Defined in `src/types.ts`. On disk as `PoolHistoryFile`: same fields, with `swaps` as tuples `[ts, ledger, amount0, amount1, price, liquidity]` (`swapColumns` names them).

| Field | Meaning |
|---|---|
| `venue` | `sushi-v3` or `aquarius-cl` |
| `pool`, `token0`, `token1` | contract ids; token `symbol`, `decimals` read by RPC simulation |
| `feePpm` | swap fee in millionths (3000 = 0.30%) |
| `protocolFeeShare` | share of the fee not paid to LPs. Sushi: `1/get_protocol_fee_0()` (Uniswap V3 semantics, [I]). Aquarius: 0 in fixtures, but `claim_protocol_fee` events show a protocol share exists [P]; its size is [U] (CLP-007) |
| `window` | capture window (unix seconds and ledgers) |
| `token1UsdAtCapture`, `tvlUsdAtCapture` | spot values at capture, used only to express results in USD |
| `swaps[]` | chronological; `amount0/1` human units, pool's view (positive = paid in); `price` token1 per token0 after the swap; `liquidity` active L after the swap in human units (`L_raw / 10^((d0+d1)/2)`), or `null` |
| `provenance` | capture time, script, source URLs, notes |

### 2.2 Sushi Stellar

- Factory `CD3KRKGDRVWPXVB3VXLUMQKMX6XZ6Q2H334IVZD4XXNAMKSRVQL5GLYF`. Source: the `FACTORY` constant in DefiLlama's adapter `projects/sushi-stellar/index.js` (read 2026-11-03) [P]. Pools: the factory's `pool_created` events (`pool_address, token0, token1, fee, tick_spacing, sender`).
- Swap event body (map): `amount0: i128, amount1: i128, liquidity: u128, sqrt_price_x96: U256, tick: i32, sender, recipient` [P: decoded from mainnet events]. Price = `(sqrt_price_x96 / 2^96)^2 * 10^(d0-d1)`.
- Pool view functions used: `get_protocol_fee_0`, token `balance(pool)`. The pool also exposes `slot0`, `liquidity`, `positions`, `mint/burn/collect/swap(…, hints: OracleHints)` [P: contract spec read with `stellar contract info interface`].
- History source: StellarExpert `GET /explorer/public/contract/{id}/events` (full history, third-party indexer). Cross-checked against public RPC `getEvents` over the RPC's 7-day window by `scripts/crosscheck-rpc.ts`.

### 2.3 Aquarius concentrated pools

- Pool list: `GET https://amm-api.aqua.network/pools/?pool_type=concentrated`. USD fields (`liquidity_usd`, `volume_usd`) are in units of 1e-7 USD: XLM/USDC `liquidity_usd = 12671765421948` is $1.27M, consistent with its reserves (5.28M XLM at $0.164 plus 0.40M USDC) [P, checked 2026-11-03].
- Hourly stats: `GET /statistics/pool/{address}/?size=100&page=N`, 720 hourly rows retained (30 days) [P].
- Swaps: `GET /api/external/gecko-terminal/events/?fromBlock=A&toBlock=B` (GeckoTerminal adapter feed; blocks are ledgers; HTTP 413 when the range holds too many events, so the client halves the range). `priceNative` is token1 per token0 after the swap; amounts are human units.
- Second swap source (used for the committed fixtures, because the gecko feed timed out from the capture machine): StellarExpert contract events. Each swap emits `trade(token_in, token_out, trader) -> [sold (gross), bought, fee]`, `update_reserves -> [r0, r1]` and `pool_state -> [sqrt_price_x96, tick, active_liquidity]` in one operation; `expertAquaToSwaps` pairs `trade` with the `pool_state` of the same operation id, so L is the pool's real active liquidity. Other topics seen: `deposit_liquidity`, `withdraw_liquidity`, `position_update`, `claim_fees`, `claim_reward`, `claim_protocol_fee`, `set_rewards_config`, `kill_*`/`unkill_*`, `apply_upgrade` [P, 2026-11-03].
- Active liquidity is not in the gecko feed. It is inferred per swap from consecutive prices (fee taken on input): token1 in: `L = in1*(1-fee) / (sqrtP_after - sqrtP_before)`; token0 in: `L = in0*(1-fee) / (1/sqrtP_after - 1/sqrtP_before)`. Joins/exits do not move a CL price, so the previous swap's price is the pre-price. Cross-check value: `get_active_liquidity()` read at capture, stored in provenance notes.
- Pool contract functions (from the mainnet spec): `get_slot0() -> {sqrt_price_x96: U256, tick: i32}`, `get_tick_spacing`, `deposit_position(sender, tick_lower, tick_upper, desired_amounts: Vec<u128>, min_liquidity: u128) -> (Vec<u128>, u128)`, `withdraw_position(owner, tick_lower, tick_upper, amount: u128, min_amounts) -> Vec<u128>`, `claim_position_fees(owner, tick_lower, tick_upper) -> Vec<u128>`, `swap(user, in_idx, out_idx, in_amount: u128, out_min: u128) -> u128`, `get_active_liquidity() -> u128` [P]. Their transfer semantics (who pulls from whom) were not read from source [U].

## 3. Backtest model

### 3.1 Position and range

- Range for half-width `w`: `[p/(1+w), p(1+w)]` (multiplicative, so a fresh position is 50/50 by value). `full` = `[0, inf)`.
- Position math in human units, Uniswap V3 whitepaper 6.2 (`src/math/clmm.ts`).

### 3.2 Fees

Per swap with pre-price `p0`, post-price `p1`, pool liquidity `Lp` (last known value carried forward):

`fee = |input| * feePpm/1e6 * (1 - protocolFeeShare) * f * L/(L + Lp)`

where `f` is the fraction of the swap inside our range (overlap in `sqrtP` for token1 input, in `1/sqrtP` for token0 input). Fees are valued in token1 at `p1` and held aside; they are reinvested at each rebalance.

Assumption: price-taker. Our liquidity does not change the observed path or volume. This is conservative for arbitrage flow (more liquidity attracts more arbitrage volume, which pays fees to us) and optimistic for noise flow. Configs whose average share `L/(L+Lp)` exceeds 20% are flagged and excluded from "best" (`MAX_POOL_SHARE`).

### 3.3 Rebalance rules and costs

| Rule | Trigger |
|---|---|
| `none` | never |
| `oor+Ns` | price outside the range for at least N seconds |
| `thrX` | `|ln(p/centre)| > X * ln(1+w)` |
| `everyNs` | N seconds since the last rebalance |

On rebalance: withdraw, add held fees, re-centre on the current price, swap the imbalance to 50/50. Cost = `traded value * (poolFee * swapFeeMultiplier + slippage) + fixedPerRebalance`. Defaults: `slippage = 0.0005`, `fixedPerRebalance = 0.05` token1, `swapFeeMultiplier = 1`.

### 3.4 Outputs (per config)

`feeIncome`, `impermanentLoss` (LP value excluding fees and costs minus HODL of each segment's starting tokens, summed over segments), `lvr` (exact discrete loss-versus-rebalancing on the observed path: `sum x(P_prev)(P - P_prev) - (V(P) - V(P_prev))`), `rebalances`, `rebalanceCost`, `timeInRange` (share of swaps), `avgPoolShare`, `finalValue`, `hodlValue`, `feeApr`, `netApr` (includes price drift), `excessVsHodlApr`. Grid rows add `excessVsPassive` and `excessVsHodl`.

Fee statistics (`src/backtest/fees.ts`): volume = sum of input values in token1 at each swap's price; total fees = volume * fee; LP fees = total * (1 - protocol share); pool fee APR = LP fees / TVL at capture, annualised.

Trace (CLP-016): `backtest(h, cfg, capital, costs, { traceEverySec })` adds `trace[]` with one point at most every `traceEverySec` seconds plus the first and last swap: `{ ts, price, value (LP value + held fees), hodl, fees (cumulative), lower, upper }` (range bounds in price; `null` for full range). The last point equals `finalValue`, `hodlValue` and `feeIncome`. Tracing does not change results.

### 3.5 Verdict

`beatsPassive` = the best eligible config's final value exceeds the passive full-range LP's after costs. Walk-forward: pick the best config on the first half of the window, score it on the second half against passive. The project-level kill/advance signal is in README "Results".

## 4. CLI

```
node src/cli.ts fees <history.json...> [--json f] [--md f]
node src/cli.ts aqua-hourly [--dir fixtures] [--json f] [--md f]
node src/cli.ts backtest <history.json> [--capital-usd 10000] [--widths 0.001,0.01] [--rules none,oor,oor+3600s,thr0.8,every86400s] [--slippage 0.0005] [--fixed 0.05] [--json f] [--md f]
node src/cli.ts report [--dir fixtures] [--top 6] [--capital-usd 10000] [--out out]
```

`report` writes `report.json` (`schema: "clp.report.v1"`) and `report.md`. All commands are offline.

## 5. Vault contract (`contracts/vault`, crate `sik-cl-lp-manager-vault`)

TESTNET ONLY. UNAUDITED. DEMO-ONLY.

### 5.1 Interfaces consumed

- Pool: the Aquarius concentrated subset in 2.3 (`get_slot0`, `get_tick_spacing`, `deposit_position`, `withdraw_position`, `claim_position_fees`, `swap`). The vault authorises the pool to pull its tokens with `authorize_as_current_contract` (one `transfer(vault, pool, amount)` entry per token per call). Whether the real Aquarius pool pulls with `transfer` from `sender` is [U]; CLP-011 checks it on testnet.
- Oracle: SEP-40 `lastprice(Asset::Stellar(token)) -> Option<PriceData{price, timestamp}>` for both tokens; cross price = `p0/p1 * 10^(d1-d0)`.

### 5.2 Functions

| Function | Auth | Behaviour |
|---|---|---|
| `__constructor(config)` | none | validates config; centres the first range on the pool tick |
| `deposit(from, amount0, amount1) -> shares` | `from` | oracle guard must pass; unwinds the position, values idle balances at the oracle price, mints shares pro rata (first deposit: shares = value in raw token1), enforces `cap`, redeploys |
| `withdraw(owner, shares) -> (out0, out1)` | `owner` | not oracle-gated; unwinds, pays the pro-rata share of both balances, redeploys unless paused |
| `rebalance() -> (lower, upper)` | `keeper` | requires: not paused; cooldown `min_interval`; oracle fresh (`max_age`); pool price within `max_dev_bps` of oracle; pool tick outside `[lower, upper)`. Unwinds, swaps to 50/50 at the oracle price with `out_min = expected * (1 - max_slippage_bps)`, centres the new range on the tick (rounded out to tick spacing), redeploys |
| `set_paused(bool)` | `admin` | pause unwinds to idle; unpause redeploys |
| `get_state`, `get_config`, `shares(who)` | none | views |

Errors (`VaultError`): `Paused=1, OracleMissing=2, OracleStale=3, PriceDeviation=4, InRange=5, Cooldown=6, ZeroAmount=7, InsufficientShares=8, CapExceeded=9, BadConfig=10, Overflow=11`.

Fixed point: prices are raw token1 per raw token0 times 1e9. Pool price from `sqrt_price_x96`: `((s >> 48)^2 * 1e9) >> 96`.

### 5.3 Known limits of the first version

- Share pricing unwinds and redeploys the whole position on every deposit/withdraw (gas-heavy; CLP-008 replaces it with in-contract amounts-for-liquidity).
- Share price carries a virtual offset (`VIRTUAL_OFFSET` = 1,000 raw token1 units on both sides): `minted = added * (total_shares + 1000) / (value_before + 1000)`, `payout = balance * shares / (total_shares + 1000)`. First deposit still mints 1:1. This blunts first-depositor and donation inflation; a slice of every payout, `1000 / (total_shares + 1000)`, stays in the vault. Rounding favours the vault; property-fuzzing is still open (CLP-012).
- Exits are not oracle-gated and unwind with `min_amounts = [0, 0]` (see RISKS.md, contract risk 2).
- Oracle timestamps in the future are refused as stale; the constructor rejects zero `max_age`/`min_interval`, decimals over 18 and `token0 == token1`; `set_paused` emits `PausedChanged`.
- No DeFindex interface yet (CLP-009).
- Storage TTL: every state write extends the instance (and the writer's share entry) to 90 days, threshold 30 days, so a deployed testnet instance stays readable between runs.

### 5.4 Testnet demo contracts (CLP-017; TESTNET DEMO ONLY)

| Crate | Contract | Behaviour |
|---|---|---|
| `sik-cl-lp-manager-demo-pool` | `DemoPool` | Same function names and signatures as the Aquarius subset in 5.1. `__constructor(admin, t0, t1, spacing, fee_bps)`. A position keeps exactly the amounts deposited (liquidity = raw sum); `swap` settles at the slot price minus `fee_bps` and reverts below `out_min`. Admin-only `set_slot(sqrt_price_x96, tick)` and `add_fees(owner, f0, f1)`. **Not Aquarius, not an AMM.** |
| `sik-cl-lp-manager-demo-oracle` | `DemoOracle` | SEP-40 `lastprice(Asset) -> Option<PriceData>`, `decimals() = 14`. Admin-only `set_prices(assets: Vec<Asset>, prices: Vec<i128>, age_secs)` stamps `now - age_secs`. **Not a real price source.** |

`contracts/vault/tests/testnet_scenario.rs` runs the scenario of section 6 against these two contracts.

## 6. Testnet scenario (`scripts/testnet-vault.ts`, CLP-018)

TESTNET ONLY (refuses any passphrase but `Test SDF Network ; September 2015`). Keys: three `Keypair.random()` (admin, keeper, user) in memory, funded by friendbot, never written. Setup: upload the three wasm files (hash must equal local sha256), issue classic assets `CLPT0`/`CLPT1` from the admin and deploy their SACs, user trustlines and 10,000 of each, deploy oracle, pool (spacing 10, fee 5 bps) and vault (`half_width_ticks 25, max_dev_bps 50, max_age 600, max_slippage_bps 30, min_interval 3600`), mint 100,000 of each to the pool.

| Step | Expected |
|---|---|
| deposit 1,000 + 1,000 | success, 2,000 shares, range ticks -30..30 |
| rebalance (price inside) | `InRange` |
| admin: pool to 1.004 (tick 40); oracle 1.004 stamped 1 h old; rebalance | `OracleStale` |
| admin: oracle 1.014 fresh; rebalance | `PriceDeviation` |
| admin: oracle 1.004 fresh; rebalance | success, range 10..70 |
| admin: pool 1.020 (tick 200), oracle 1.020; rebalance | `Cooldown` |
| admin: oracle stamped 1 day old; withdraw 1,000 shares | success |

Refusals are recorded from `simulateTransaction` (no failing transaction is sent). The script aborts if any outcome differs. Output `fixtures/testnet/vault-run.json` (`schema: "clp.testnet-run.v1"`): accounts (public keys), token and contract ids, wasm sha256, config, setup txs, admin "market moves", steps with tx hash/ledger/fee or simulated ledger and error, and `stateAfter` per step.

## 7. Demo surface (`web/`)

Vite + React + TypeScript strict + Tailwind v4, static build. `pnpm demo:data` (`web/scripts/build-data.ts`) copies the committed histories to `web/public/data/pools/` and writes `web/src/data/demo.json` (pool metadata and fee stats, report verdicts at $10k and $100k, Aquarius hourly fees, the testnet run). The explorer imports `src/backtest/*` and runs it in the browser. The only network call the page can make is the vault view's "Read state" button: `simulateTransaction(get_state)` on public testnet RPC.

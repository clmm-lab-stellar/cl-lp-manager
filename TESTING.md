# cl-lp-manager: testing

## Commands

```
pnpm install
pnpm check                      # typecheck + node:test + lint
cd contracts && cargo test      # vault contract tests (soroban testutils)
cd contracts && cargo clippy --all-targets -- -D warnings
```

## TypeScript tests (`test/*.test.ts`, node:test)

Closed-form checks on synthetic paths (`test/synthetic.ts` builds exact CL swaps for a given pool L and fee):

| Test | Known answer |
|---|---|
| full-range IL | `V/HODL - 1 = 2*sqrt(r)/(1+r) - 1` for r in {0.25, 0.5, 1.5, 4} |
| exit above range | value `L(sqrtB - sqrtA)`; HODL of the start split |
| fee share | `sum |input| * fee * (1-protocol) * L/(L+Lpool)` with protocol share 25% |
| LVR | alternating path `P <-> rP`: per pair `L sqrtP (sqrt r - 1)^2 + L sqrt(rP) (1/sqrt r - 1)^2` |
| rebalance cost | symmetric multiplicative range is 50/50 by value, so cost = `V/2 * (fee + slip) + fixed` |
| out-of-range delay | no rebalance before `delaySec`, one after |
| constant price | IL = LVR = 0 |
| CL math | full range `x = L/sqrtP, y = L sqrtP`; 50/50 split at centre; overlap fractions |
| decoders | `sqrt_price_x96` with decimals; TOID ledger; Sushi swap body built with `nativeToScVal` |
| Aquarius L inference | recovers L to 1e-6 from synthetic gecko events, with a join in between |
| Aquarius StellarExpert decoder | pairs `trade` with `pool_state` of the same operation, ignores unpaired `pool_state`, signs amounts by token side |
| fixtures | every captured history parses, is chronological, has provenance and positive prices |
| trace (CLP-016) | off by default; samples strictly increasing; last point equals `finalValue`/`hodlValue`/`feeIncome`; full range has null bounds; results identical with tracing |
| testnet encoders (`test/testnet.test.ts`) | `isqrt`, `sqrtPriceX96`, pool price fixed point vs the vault's; `Error(Contract, #N)` to `VaultError` names; struct keys sorted; `Config` has 14 fields; `State` found in instance storage |
| recorded testnet run | if `fixtures/testnet/vault-run.json` exists: testnet passphrase, no secret seed, the 7 step outcomes in order, 64-hex tx hashes |

## Contract tests (`contracts/vault/src/test.rs`)

Mock pool (`MockPool`, Aquarius-shaped; keeps deposited amounts unchanged, swaps at the slot price minus a fee) and mock SEP-40 oracle (`MockOracle`, 14 decimals). Covered: helper math; deposit share minting and proportionality; cap; price-deviation refusal; rebalance refusals (in range, stale oracle, deviation, cooldown) and success; 50/50 swap at oracle price; pro-rata withdraw including claimed fees with a stale oracle; pause/unpause; keeper-only rebalance with **only the keeper's auth mocked** (proves the vault's `authorize_as_current_contract` covers the pool's token pulls); bad config rejected.

The mock pool does not model price-dependent position composition; real-pool behaviour is CLP-011 (testnet).

`contracts/vault/tests/testnet_scenario.rs` runs the exact testnet scenario (SPEC.md 6) against the deployable `demo-pool` and `demo-oracle` crates, so the script's expected outcomes are proven locally before anything is sent. `demo-pool` and `demo-oracle` have their own tests (admin-only setters, swap at slot price with `out_min`, positions return what was deposited, back-dated oracle timestamps).

## Testnet (manual, TESTNET ONLY)

`pnpm contracts:build && pnpm testnet:vault` deploys and runs the scenario with in-memory keys (about 8 minutes). The script aborts if any step's outcome differs from the scenario. Not run in CI.

## Demo surface

`cd web && pnpm build` (data + typecheck + build). Visual check: `node scripts/screenshot.mjs out.png <width> <light|dark> '#/explore'` (needs Chrome; starts `vite preview`). `DEBUG_OVERFLOW=1` lists elements wider than the viewport; `CLICK_WAIT=9000` with a click label (e.g. `'Read state'`) waits for the live read.

## Fixtures

Captured by script only (CONVENTIONS "Fixtures"). Each history embeds provenance (sources, capture time, script, notes); pool lists have `*.provenance.json` or a `source` field.

| Fixture | Script |
|---|---|
| `fixtures/sushi/pools.json` (+ provenance) | `node scripts/capture-sushi-pools.ts` |
| `fixtures/sushi/<pool>.history.json` | `node scripts/capture-sushi-history.ts [topN=7] [days=30]` |
| `fixtures/sushi/<pool>.rpc-crosscheck.json` | `node scripts/crosscheck-rpc.ts fixtures/sushi/<pool>.history.json` |
| `fixtures/aquarius/pools.json`, `<pool>.hourly.json` (and `<pool>.history.json` via the gecko feed) | `node scripts/capture-aquarius.ts [days=30] [minTvlUsd=10000]` |
| `fixtures/aquarius/<pool>.history.json` (committed ones, via StellarExpert, real L) | `node scripts/capture-aquarius-expert.ts <days> <pool>...` |

Captures are resumable: HTTP pages behind a cursor are cached in `.cache/http`, Aquarius event chunks in `.cache/aqua-chunks` (both gitignored). To refresh, delete `.cache/` and rerun. Expect 10-30 minutes; the scripts throttle to at most ~2 requests/s per host.

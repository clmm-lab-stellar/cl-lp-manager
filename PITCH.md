<!-- SPDX-License-Identifier: Apache-2.0 -->
# cl-lp-manager: investor brief (2026-11-08)

**Status: research tool working; vault is UNAUDITED, TESTNET ONLY, DEMO-ONLY.** Tags: [P] primary/measured, [S] secondary, [I] inferred, [E] estimate, [U] unknown.

## Problem

Concentrated liquidity (CL) arrived on Stellar through two venues, Sushi Stellar V3 and Aquarius concentrated pools. LPs, vault curators and protocols must now choose a range and a rebalancing rule, and we did not find a published backtest of what those choices earn on Stellar's own swap flow (2026-11-03 search, `PRIOR-ART.md`). The numbers that decide it:

- **Sushi Stellar:** $15.6M TVL [P: DefiLlama API, 2026-11-03], but only **$3,786 of LP fees in 30 days** across the 7 pools that hold 99.99% of that TVL [P: recorded swaps 2026-10-04 to 2026-11-03, cross-checked against public RPC for 4 of 4 pools]. Of that, 94% came from one pool, XLM/USDC 0.30%. The stable pools holding about $15M earned 0.00 to 0.05% fee APR [P].
- **Aquarius concentrated:** **$45,645 of gross fees in 30 days** over 47 pools, on $35.1M of volume [P: Aquarius hourly pool statistics, 2026-11-03]. The protocol's share is not deducted because its size is unknown [U, CLP-007].
- **Prior work:** keeper-rebalanced Aquarius CL strategies already run (Peridot on mainnet, YARV on testnet). An open Stellar CL backtester with measured fee volume was not found in the 2026-11-03 search [P: `PRIOR-ART.md`]; absence from one search is not proof none exists. This project supplies one. No "first" claim is made.

## What it does

1. **Measures:** read-only capture of every swap, with post-trade price and active liquidity, from both venues, with provenance.
2. **Backtests:** swap-by-swap replay of a range strategy (any width, four rebalance rules, real costs) against passive full-range LP and holding. It reports fees, impermanent loss, LVR, rebalance costs and an out-of-sample (walk-forward) check.
3. **Guards:** a Soroban vault reference that re-centres its range only when four on-chain checks pass. The oracle must be fresh, the oracle and pool prices must agree, the price must be out of range, and a cooldown must have elapsed. Withdrawals stay open when the oracle is down.

## Who it is for

- LPs and treasuries deciding whether to provide CL liquidity on Stellar.
- Vault curators (DeFindex-style strategies) choosing a range policy.
- Venues (Aquarius, Sushi) and grant reviewers who need evidence of fee economics.

## Working today (real numbers only)

| Claim | Number | Source |
|---|---|---|
| Swaps captured and replayable | 51,920 swaps, 12 pools, 7 to 30 days each | [P] `fixtures/`, captured 2026-11-03/04 |
| Best out-of-sample edge over passive LP | **+84.79 sUSD in 15 days** on 10,000 sUSD (Aquarius USDC/sUSD, ±0.25% range) | [P] `reports/report.json` |
| Same pool, in sample (30 days) | +230.17 sUSD vs passive (fees 355.55, impermanent loss −94.01, rebalance costs −30.33) | [P] recomputed in the demo from recorded swaps |
| Largest fee pool, XLM/USDC on Aquarius | in sample +102.95 USD, **out of sample −54.43 USD** (7 days) | [P] `reports/report.json` |
| Sushi XLM/USDC | every configuration lost to passive (best −298.72 USD on $10k, 30 days, XLM −26%) | [P] |
| Vault guard on testnet | deposit; 4 refusals (in range, stale oracle, 1% oracle/pool deviation, cooldown); 1 accepted rebalance; withdraw with a stale oracle | [P] testnet run 2026-11-08, `fixtures/testnet/vault-run.json` |
| Fee charged for the accepted rebalance | 17,943 stroops (0.0018 XLM) | [P] testnet tx `c0178dd4…`; mainnet fees will differ [I] |
| Tests | 27 TypeScript (closed forms for IL, LVR, fees) + 18 contract tests | [P] `pnpm check`, `cargo test` |

**Reading:** on today's volume a static narrow range beats passive on two Aquarius sUSD pools, by a few hundred dollars a month on $10k. Active rebalancing adds almost nothing. The project's own verdict is to keep the backtester and not run an active manager as a business until fee volume grows (README "Results").

## Why Stellar

- Two live CL venues with on-chain swap events that carry price and active liquidity, so every number here comes from chain data, not a model of it [P].
- Soroban gives the vault cheap, auditable guard logic. It authorises its own token pulls (`authorize_as_current_contract`) and reads SEP-40 oracles.
- Measured cost of one guarded rebalance on testnet: 0.0018 XLM [P, testnet].

## Roadmap

1. Aquarius fee split and AQUA rewards in the model (CLP-007). 90+ day windows and three or more walk-forward folds (CLP-013). Capacity curve from $1k to $1M (CLP-015).
2. Vault against a real Aquarius testnet pool (CLP-011), in-contract position math (CLP-008), fuzzing (CLP-012).
3. DeFindex strategy adapter (CLP-009) and a testnet keeper (CLP-014).
4. Hosted explorer and published backtester package (see `DEPLOY.md`).

## Risks and gates

- **G-VALUE closed:** no mainnet deployment holding value, ever, without an audit, a value cap and written approval.
- **Unaudited contract:** rounding is not fuzzed and first-depositor inflation is not analysed.
- **Model:** price-taker (positions over 20% of active liquidity are excluded), one 30-day regime, USD at capture-time prices, Aquarius fees gross.
- **Data:** histories come from StellarExpert (third party), checked against RPC for Sushi only.
- **Market:** fee volume is small. Venues could ship native auto-ranges.

## What launch needs

Static hosting for `web/dist` (no server). An npm package for the backtester (`@sik/cl-lp-manager`, currently private). Crates for the contracts stay unpublished until audited. Then an external audit and an audit scope document before any mainnet discussion. Details: `DEPLOY.md`.

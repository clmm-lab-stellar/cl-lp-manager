# cl-lp-manager: risks

## Gates touched

| Gate | How | Status |
|---|---|---|
| G-VALUE | The vault holds value by design. | Closed. Testnet only; README and crate metadata say UNAUDITED / DEMO-ONLY; deposit `cap` config. No mainnet deploy from this repo. |
| G-NOVELTY | Easy to overclaim "first CL manager on Stellar". | `PRIOR-ART.md` records prior attempts (YARV and others); no novelty claim is made. |
| G-LICENCE | YARV has no licence. | Ideas only; no code copied. |
| G-SECRETS | Testnet keys for the testnet scenario. | `Keypair.random()` in memory, funded by friendbot, never written to disk; the run file holds public keys only; a test asserts no secret seed is in it. |
| G-OUTREACH | Sushi/Aquarius/DeFindex are natural adopters. | Drafts only, in `drafts/`. |

## Model risks (backtester)

1. **Price-taker assumption.** Large positions would change price paths and attract more arbitrage volume. Mitigation: pool-share cap of 20% for "best"; flagged in reports.
2. **Aquarius L is inferred.** Swaps crossing initialised ticks give an average L; tiny moves are dropped (null). The value read at capture is stored for a check. Error in L scales fee estimates directly.
3. **Protocol fee shares.** Sushi `get_protocol_fee_0() = 4` is read as "protocol takes 1/4" (Uniswap V3 semantics) [I]. Aquarius does take a share (`claim_protocol_fee` events, 2 in 30 days on USDT0/USDC) but its size was not read; fixtures assume 0, so Aquarius fee income is overstated by that share [U].
4. **USD conversion at capture-time spot.** Volumes are summed in token1 at each swap's price, then converted with today's token1 price. Fine for USDC-quoted pools; approximate for XLM-quoted ones.
5. **Window length.** 30 days of history; one market regime. Walk-forward on two 15-day halves is a weak out-of-sample test.
6. **Rewards ignored.** AQUA rewards on Aquarius pools are not in fee income; they go to LPs regardless of range choice only if the reward scheme pays by liquidity share (not checked) [U].
7. **Third-party data.** StellarExpert (Sushi history) and the Aquarius API are not primary chain data. RPC cross-check covers the last 7 days for Sushi; the Aquarius feed is not independently checked beyond the hourly-volume comparison.

## Contract risks (vault)

1. Unaudited. Share accounting unwinds the whole position per deposit/withdraw: high resource use.
   - First-depositor and donation inflation (audit finding, 2026-11-08): **mitigated, not proven away.** Share price now carries a virtual offset of 1,000 raw token1 units on both sides (ERC-4626 style, `VIRTUAL_OFFSET`). A unit test replays deposit-1-unit, donate X, victim deposits 1,000 tokens for X from 1 raw unit to 5,000 tokens: the attacker never ends up with more than they put in and the victim is never minted zero (the same test fails with the offset set to 1). Costs: about `1000 / (total_shares + 1000)` of every payout stays in the vault for the next depositor; a donation can still push value over `cap` and block deposits until the donor's funds are absorbed (griefing that costs the donor the donation). Idle balances are still read with `balanceOf`, not tracked internally. Fuzzing (CLP-012) is still TODO, so the bound is shown by example, not by property test.
2. Exit price risk (audit finding, accepted trade-off): `withdraw` and `set_paused` unwind the position with `min_amounts = [0, 0]` and no price check, because exits must stay open when the oracle is down. Someone who moves the pool price around an exit can leave the remaining shareholders a worse token mix, paying the cost pro rata, then trade back. Not exercised on testnet (the demo pool returns deposited amounts). A fix would pass oracle-derived minimums only while the oracle is fresh; not built.
3. Oracle edge cases (audit findings, fixed 2026-11-08): future-dated oracle timestamps are now refused as stale; the constructor rejects `max_age = 0`, `min_interval = 0`, decimals over 18 and identical tokens; `set_paused` emits an event. Still trusted: that `decimals0/1` match the token contracts, and the oracle itself.
4. Dependency advisory: `cargo audit` reports RUSTSEC-2026-0387 (crypto-bigint, a constant-time advisory in a host-side dependency of soroban-sdk 25.3.2, not code the vault wasm calls) and unmaintained-crate notices for `derivative` and `paste`. Not traced further; revisit with the next soroban-sdk 25.x release.
5. Oracle dependency: a stale or manipulated SEP-40 feed blocks rebalances (by design) and misprices deposits (bounded by `max_dev_bps` against the pool price). Withdrawals do not depend on the oracle.
6. The real Aquarius pool's token-pull semantics and rounding are [U]; the mock pool is not the real pool.
7. Keeper is a single address; no keeper network.
8. The testnet run uses `contracts/demo-pool` and `contracts/demo-oracle`, which we control: they prove the vault's guard and auth paths on a real network, not its behaviour against Aquarius or a real oracle. Every surface that shows the run says so. Risk of overclaiming is the main one; wording is fixed in `fixtures/testnet/vault-run.json` `honesty[]` and shown verbatim in the UI.

## Business risks

1. **Fee volume is the economics.** Measured 2026-11-03: Sushi Stellar's $15.6M TVL earned about $3.8k of LP fees in 30 days, 94% of it in one XLM/USDC pool; its stable pools earn 0.0x% APR. On Aquarius stable pools the edge over passive comes from a static narrow range, not from rebalancing. See README "Results": the signal is kill for the active manager.
2. **Gecko feed reachability.** The Aquarius API timed out from this machine for hours on 2026-11-03 (other hosts reachable); captures switched to StellarExpert. Not bypassed.
3. **Absorption.** Aquarius could ship native auto-ranges; Sushi could bring Steer; DeFindex or Upshift curators could add a CL strategy.
4. **Small market.** Aquarius CL pools total about $2.9M liquidity [P: API 2026-11-03]; a manager's fee take on that is small.

## Open questions

- What share of Aquarius swap fees goes to LPs?
- Are Sushi's stable pools incentivised off-chain (Merkl or similar)? Their TVL/volume ratio suggests passive or incentive-driven liquidity.
- Is there a testnet Aquarius concentrated pool to integrate against (CLP-011)?

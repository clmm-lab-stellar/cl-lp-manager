<!-- SPDX-License-Identifier: Apache-2.0 -->
# cl-lp-manager: demo

Gates in force: **MAINNET READ-ONLY** (data), **TESTNET ONLY**, **UNAUDITED**, **DEMO-ONLY** (vault). Nothing here signs or sends a mainnet transaction.

## Run it from a clean checkout

Prerequisites: Node 24 (>= 22.18), pnpm 10.22.0, and Google Chrome only for screenshots. Rust 1.97.1 and the Stellar CLI 25.2.0 are needed only to rebuild contracts or re-run the testnet scenario.

```sh
cd projects/cl-lp-manager
pnpm install                      # root: backtester, CLI, tests
pnpm check                        # typecheck + 27 tests + lint

cd web
pnpm install
pnpm build                        # = pnpm demo:data (offline, from committed fixtures/reports) + tsc + vite build -> web/dist
pnpm preview                      # serves dist/ on http://localhost:4173
```

The build needs no network. The page itself makes one optional network call: the "Read state" button on the vault view simulates `get_state` against public testnet RPC.

Optional, to reproduce the evidence behind the demo:

```sh
# backtest report (offline, over committed captures) -> reports/
node src/cli.ts report --dir fixtures --top 12 --capital-usd 10000 --out reports

# contracts: tests, lint, wasm
cd contracts && CARGO_INCREMENTAL=0 nice cargo test -j 2 && nice cargo clippy -j 2 --all-targets -- -D warnings && cd ..
pnpm contracts:build

# TESTNET ONLY: fresh deploy + scenario with in-memory throwaway keys (~8 minutes, ~25 txs)
pnpm testnet:vault                # rewrites fixtures/testnet/vault-run.json
pnpm demo:data && pnpm web:build  # pick up the new run
```

Re-running `testnet:vault` deploys a new set of contracts with new ids. The previous ids stay valid until the next testnet reset.

## Investor demo script (about 4 minutes)

Open http://localhost:4173. Light or dark theme, whichever the room prefers (top right).

1. **Overview (45 s).**
   - Point at the four badges in the header: mainnet read-only, testnet only, unaudited, demo-only. Say: "Every number on this page says where it came from."
   - Read the signature figure: **+85 sUSD in 15 days** on 10,000 sUSD (Aquarius USDC/sUSD), out of sample. Hover the chip: recorded mainnet capture, `reports/report.json`, 2026-11-04.
   - Scroll to **The answer, pool by pool.** Each pool shows the best range and rule against passive LP after costs, with its own **Window** column: Aquarius XLM/USDC is only 7 days (amber), so its +102.95 and −54.43 USD cover about 7 and 3.5 days, not 30 and 15. The hero's +85 is for the rebalance-after-1-h rule; the footnote gives the static-range comparison. Sushi XLM/USDC is "No" (−298.72 USD) and most stable pools win by under 10 USD a month.
   - Say: "The honest answer is that concentration helps a little on two pools, and active rebalancing does not pay on today's volume."
2. **What was measured (30 s).**
   - The four tiles: Sushi Stellar LP fees of **$3,786 in 30 days** on **$15.6M** of TVL, and Aquarius CL gross fees of **$45,645** over 47 pools.
   - Then 51,920 swaps replayed, and the vault guard tile from testnet.
3. **Backtest explorer (90 s).** Click *Run a backtest*.
   - It opens on Aquarius USDC/sUSD, ±0.25%, rebalance after 1 h out of range, 10,000 sUSD. The hero tile reads **+230.17 sUSD vs passive LP**, the same number as the committed report, recomputed in the browser from 15,207 recorded swaps.
   - Show the value chart: strategy against passive LP and hold. Show the breakdown: fees +355.55, impermanent loss −94.01, rebalance costs −30.33.
   - Change *Range half-width* to ±1.00%: the result drops to +143.63. Change *Rebalance rule* to "rebalance as soon as out of range" at ±0.25%: it turns to −507.91. Say: "Rebalancing too eagerly pays the pool fee every time."
   - Scroll to the grid. Blue cells beat passive and orange cells lost. Struck-through cells would be over 20% of the pool's liquidity, which breaks the model, so they are excluded.
   - Read the out-of-sample line: **+84.79 sUSD**.
   - Switch *Pool* to **XLM/USDC (Aquarius 0.10%)**. The warning banner appears (the position would be 47.7% of active liquidity), and the out-of-sample result is **−54.44 USDC**.
4. **Testnet vault (60 s).** Click *Testnet vault* in the sidebar.
   - Read the amber "what this run is and is not" box aloud: it is our demo pool and demo oracle, not Aquarius.
   - Walk the seven steps:
     - deposit landed;
     - in range, refused;
     - oracle one hour old, refused;
     - oracle 1% off the pool, refused;
     - all guards pass, rebalance landed (ledger 5,628,285), the range moved from ticks −30..30 to 10..70;
     - second rebalance minutes later, refused by the cooldown;
     - withdraw landed with a stale oracle, because exits are never oracle-gated.
   - Click a tx link to show it on stellar.expert testnet.
   - Press **Read state**. A *Live read* chip appears with the current testnet ledger, and the state matches the end of the recorded run. If testnet was reset, it says *Read failed* and keeps the recorded run unchanged.
5. **Status and limits (15 s).** Show the not-built list, then close with the gates: G-VALUE stays closed and no audit has been done.

Screenshots of the current build (2026-11-08, after the audit fixes) are in `docs/screenshots/`.

If testnet RPC is flaky from your network, `testnet:vault` can be run with `NODE_OPTIONS="--dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=3000"`; that is how the 2026-11-08 re-run finished after three connect-timeout failures.

## If something goes wrong

- **Blank explorer:** the pool files are served from `web/dist/data/pools/`. Serve `dist/` over HTTP (`pnpm preview`); opening the file directly from disk will not load them.
- **"Read failed":** testnet RPC is down or testnet was reset. Run `pnpm testnet:vault` for fresh contracts.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# cl-lp-manager: MVP plan (2026-11-08)

## Current state (read 2026-11-08)

- **Backtester (TypeScript):** done and tested (20 node:test tests). It covers the data layer, CL math, a swap-by-swap engine, the grid, walk-forward and the CLI. Committed fixtures: 7 Sushi Stellar V3 pools (30 days), 4 Aquarius stable CL pools (30 days) and Aquarius XLM/USDC (7 days), plus hourly stats for 47 Aquarius CL pools. `reports/report.json` holds the 2026-11-04 result.
- **Vault (Rust, soroban-sdk 25):** builds. 9 tests pass against an in-test mock pool and oracle. It has **never been deployed**, and no testnet transaction has been sent.
- **Demo surface:** none. The project AGENTS.md said "No UI". The orchestrator's MVP brief now asks for one, and this plan records that change.
- **Signal:** the project's own README verdict is "kill the active manager as a business; keep the backtester". The MVP shows that verdict honestly. It does not dress the product up.

## MVP definition (what an investor sees in 3-5 minutes)

1. **Overview:** what the kit measures, the one signature figure (real, from the report, with its provenance chip) and the gates (TESTNET ONLY, UNAUDITED, DEMO-ONLY, MAINNET READ-ONLY) in the header.
2. **Backtest explorer:** pick one of the 12 captured pools, a capital amount, a range width and a rebalance rule. The committed swap history runs through the same engine the CLI uses, in the browser. The page shows:
   - fee income, impermanent loss, LVR and rebalance costs;
   - the final value against passive full-range LP and HODL;
   - a value-over-time chart and a price-with-range chart;
   - the width × rule grid and the walk-forward result.

   Every number is labelled "Recorded mainnet capture" with the ledger range and capture date.
3. **Fee volume:** the measured fee table per pool (the deciding unknown).
4. **Testnet vault:** a recorded testnet run of the vault with runtime throwaway keys:
   - deploy;
   - deposit;
   - rebalance refused while in range;
   - rebalance refused on a stale oracle;
   - rebalance refused on an oracle/pool deviation;
   - rebalance accepted;
   - refused on cooldown;
   - withdraw.

   Each step shows its tx hash with a link to a testnet explorer. A "Check on testnet now" button reads the deployed vault's live state from public testnet RPC (read-only simulation) and labels the result Live. Because testnet resets, a failed read shows "Read failed" with the reason, never stale data dressed as live.
5. **Status:** what works, what does not, and what launch needs.

## Surface choice

`web/`: Vite + React + TypeScript strict + Tailwind v4, static build. No docs site: the developer-facing material (CLI, SPEC) is already Markdown in the project, and the value is interactive (strategy parameters → outcome). Adding a docs site would duplicate SPEC.md without adding anything an investor uses.

## Tasks (new ticket ids in TASKS.md)

| Id | Task |
|---|---|
| CLP-016 | Engine `trace` option (value/price/range samples over time) for charts; tests |
| CLP-017 | Deployable `demo-pool` and `demo-oracle` contracts (admin-gated twins of the test mocks, clearly labelled DEMO, not Aquarius, not a real oracle); a vault integration test runs the exact testnet scenario against them |
| CLP-018 | `scripts/testnet-vault.ts`: build the wasm, generate keys at runtime (`Keypair.random()`, never written to disk), fund them with friendbot, deploy, run the scenario and write `fixtures/testnet/vault-run.json` (public keys, contract ids, tx hashes, ledgers, outcomes). Refuses any network but testnet |
| CLP-019 | `web/` explorer + testnet view; `pnpm demo:data` builds the web data from fixtures and reports with provenance |
| CLP-020 | DEMO.md, PITCH.md, DEPLOY.md, README status |

## Explicitly left out (and why)

- **Real Aquarius testnet pool integration (CLP-011)** stays TODO. The real pool's token-pull semantics are [U], and a real oracle's mainnet prices would not match a testnet pool's price, so the guard would refuse forever. The demo uses our own `demo-pool`/`demo-oracle`, and the UI says so on every step. Price moves on testnet are set by the demo pool admin and labelled that way; there is no testnet market.
- **In-contract position math (CLP-008), fuzzing (CLP-012; partly addressed by the virtual-offset share price and a donation test), DeFindex adapter (CLP-009), Sushi position manager (CLP-010), keeper service (CLP-014), longer windows (CLP-013), capacity curve (CLP-015), Aquarius fee split (CLP-007):** each is either research or hardening beyond the MVP's core claim. They stay TODO with their ids.
- **Live mainnet backtests in the browser:** the backtester reads committed captures only. A fresh capture is a 10-60 minute throttled job (TESTING.md) and is not repeated here.
- **In-browser testnet writes:** the recorded run comes from the Node script. The browser only reads testnet. Running the 20-transaction scenario from a browser tab would need about 4 minutes of friendbot and RPC calls per visitor; that is left for after hosting decisions (DEPLOY.md).
- **Mainnet anything:** never (G-VALUE).

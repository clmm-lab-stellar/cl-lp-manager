# cl-lp-manager: tasks

Status values: TODO, IN-PROGRESS(date), DONE(date: note), BLOCKED(gate or reason).

| Id | Title | Deps | Acceptance | Status |
|---|---|---|---|---|
| CLP-001 | Prior-art re-check (VERIFY_PROTOCOL step B, 8 adversarial answers) | none | `PRIOR-ART.md` lists every query with counts, related projects with status, the 8 answers, and a verdict; README STOP if the core is already built and maintained | DONE(2026-11-03: class 3; vault overlaps Peridot (mainnet) and YARV (testnet); no STOP; scope narrowed to backtester + testnet reference strategy) |
| CLP-002 | Data layer: Sushi pools/swaps, Aquarius CL pools/hourly/swaps, provenance, RPC cross-check | 001 | fixtures captured by script with provenance; fee volume per pool computed | DONE(2026-11-04: 7 Sushi pools + 4 Aquarius stable pools, 30 days; Aquarius XLM/USDC 7 days; Aquarius hourly for 47 pools; Sushi RPC cross-check 4/4 match. Aquarius event feed unreachable, StellarExpert used instead) |
| CLP-003 | Backtester engine + closed-form tests | 002 | IL, LVR, fee share, rebalance cost tests pass against closed forms | DONE(2026-11-03: closed-form tests; 20 TS tests total) |
| CLP-004 | Grid, baselines, walk-forward, CLI, JSON/Markdown report | 003 | `node src/cli.ts report` writes `report.{json,md}` over fixtures | DONE(2026-11-03) |
| CLP-005 | Testnet vault with oracle-bounded rebalance + soroban testutils tests | 001 | `cargo test` green; guard refusals and keeper-only auth tested | DONE(2026-11-04: 9 contract tests pass; not deployed) |
| CLP-006 | Kill/advance report | 004 | README "Results" answers "does backtested fee APR beat passive LP after costs" per pool family, with numbers and caveats | DONE(2026-11-04: kill the active manager; static narrow ranges beat passive on 2 Aquarius sUSD pools; Sushi has no fee volume) |
| CLP-007 | Measure Aquarius LP/protocol fee split and AQUA reward share by range | 002 | split read from contract or docs with a source; backtest uses it | TODO |
| CLP-008 | Vault: in-contract amounts-for-liquidity math; stop unwinding on every deposit/withdraw | 005 | share price from position math; tests compare with the TS model | TODO |
| CLP-009 | DeFindex strategy adapter (single-asset in, CL pair inside) | 005 | implements DeFindex's strategy trait from its published crate; tests | TODO |
| CLP-010 | Identify the Sushi Stellar position-manager contract; Sushi-venue vault variant | 002 | address with source; interface read from spec | TODO |
| CLP-011 | Testnet integration against a real Aquarius CL pool (throwaway keys at runtime) | 005 | deposit/rebalance/withdraw round trip on testnet; tx hashes recorded | TODO (round trip done against demo-pool/demo-oracle by CLP-018; a real Aquarius pool is still open) |
| CLP-012 | Vault fuzz/property tests (rounding, first-depositor inflation) | 005 | proptest suite; findings in RISKS.md | PARTIAL: virtual-offset mitigation + example-based donation test (2026-11-08); proptest suite still TODO |
| CLP-013 | Longer window and Aquarius XLM/USDC (largest fee pool, $18.8k/30 d): Galexie data lake or StellarExpert backfill | 002 | 90+ days history for top pools incl. XLM/USDC; walk-forward on 3+ folds; does rebalancing beat static on a volatile pair? | TODO |
| CLP-015 | Capacity curve: excess vs passive as a function of capital ($1k-$1M) per pool | 004 | table in reports/; break-even capital for a manager fee | TODO |
| CLP-014 | Real keeper script (testnet) reading oracle + pool, calling `rebalance` | 011 | runs on a timer against testnet; no mainnet keys | TODO |
| CLP-016 | Engine `trace` option for charts (value, price, range over time) | 003 | trace samples end at `finalValue`; tests | DONE(2026-11-08: `traceEverySec` option; 1 new test; results unchanged with tracing) |
| CLP-017 | Deployable `demo-pool` / `demo-oracle` contracts (admin-gated twins of the test mocks) + vault integration test of the testnet scenario | 005 | `cargo test` runs the scenario end to end against the deployable contracts | DONE(2026-11-08: demo-pool + demo-oracle crates with admin-gated setters and their own tests; vault/tests/testnet_scenario.rs runs the 7-step scenario; vault now extends instance and share TTLs) |
| CLP-018 | `scripts/testnet-vault.ts`: runtime throwaway keys, deploy, scenario, `fixtures/testnet/vault-run.json` | 017 | tx hashes recorded; refuses non-testnet; no secret written | DONE(2026-11-08: re-run 19:01-19:13 UTC against the audit-fixed vault wasm 66843f95…; vault CDHB2NLP…WQA; ledgers 5,628,248 to 5,628,312; 7 steps as expected incl. 4 guard refusals; 13 setup + 7 admin-move + 3 vault txs) |
| CLP-019 | `web/` backtest explorer + testnet vault view; `pnpm demo:data` | 016, 018 | `pnpm build` offline from committed data; provenance on every figure | DONE(2026-11-08: overview, explorer (engine in browser, reproduces report.json), fee volume, testnet vault with read-only live check, status; checked at 1440/1280/1024/390 px, both themes) |
| CLP-020 | DEMO.md, PITCH.md, DEPLOY.md, README status table | 019 | files exist; numbers trace to reports/fixtures | DONE(2026-11-08) |

## Cross-project requests

- `defillama-adapters` (project #14): the Sushi Stellar volume adapter can reuse this project's finding that pool `swap` events carry `amount0/amount1/sqrt_price_x96` and the factory address from DefiLlama's TVL adapter. Measured 30-day Sushi volume for the top 7 pools is in `out/` / README (useful as a check value).
- `lending-risk-lab` (project #2): the vault's oracle guard (`max_dev_bps` vs pool price, `max_age`) is the same pattern as the guarded-adapter follow-on; share findings rather than code.

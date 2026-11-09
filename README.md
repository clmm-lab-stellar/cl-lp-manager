# cl-lp-manager

Concentrated-liquidity LP research kit for Stellar: a read-only data layer and swap-by-swap backtester over real **Sushi Stellar V3** and **Aquarius concentrated** pool history, plus a **testnet-only, unaudited** stable-pair vault that rebalances only when an oracle-bounded check passes.

> **UNAUDITED. TESTNET ONLY. DEMO-ONLY.** The vault in `contracts/vault` must not hold mainnet value (gate G-VALUE). Nothing in this project signs or sends a mainnet transaction.

## Scope (narrowed 2026-11-03 after CLP-001)

Keeper-rebalanced Aquarius CL vaults already exist: Peridot Finance runs them on mainnet (lending-coupled, no licence) and YARV built a DeFindex version on testnet (see `PRIOR-ART.md`). The vault here is therefore **not** a product claim. Scope is:

1. the **open backtester** and **measured fee volume** for Sushi Stellar V3 and Aquarius concentrated pools (the deliverable), and
2. a **testnet-only reference strategy** (`contracts/vault`) that shows the oracle-bounded rebalance guard and is tested with soroban testutils.

No "first" or "novel" claim is made.

## Results (2026-11-03)

Data: 30 days of swaps (2026-10-04 to 2026-11-03) for the 7 Sushi pools that hold 99.99% of Sushi Stellar TVL and for 4 Aquarius stable CL pools; 7 days (2026-10-27 to 2026-11-03) for Aquarius XLM/USDC, the largest CL fee pool; Aquarius hourly volume for all 47 CL pools. Capital $10,000 per position unless stated; costs per rebalance = pool fee + 0.05% slippage on traded value + 0.05 token1. Full tables: `reports/report.md`, `reports/capital-100k/report.md`, `reports/aquarius-hourly-fees.md`.

**Fee volume (the unknown that decides the economics) [P, measured]:**

- **Sushi Stellar** ($15.6M TVL): $2.15M of swap volume in 30 days over the top 7 pools, **about $3.8k of LP fees**, 94% of it in one pool (XLM/USDC 0.30%, $3.6k, 7.2% pool fee APR). The stable pools that hold ~$15M (USDT0/USDC $5.1M, deJAAA/deJTRSY $8M, PYUSD, USDY, USDE) earned 0.00-0.05% fee APR. Protocol share 1/4 read as `get_protocol_fee_0() = 4` [I: Uniswap V3 semantics]. Swap counts and volumes match public RPC `getEvents` exactly over the RPC's 7-day window for all 4 pools checked.
- **Aquarius CL** (about $2.9M liquidity): $35.1M of volume in 30 days, **$45.6k of gross fees**; XLM/USDC 0.10% alone $18.8M volume / $18.8k fees (18% gross fee APR). Gross because Aquarius takes an unread protocol share (`claim_protocol_fee` events seen) [U: CLP-007].

**Does backtested CL fee APR beat passive full-range LP after costs?**

| Pool family | Answer | Numbers ($10k, 30 days) |
|---|---|---|
| Sushi XLM/USDC 0.30% | **No.** Every width/rule lost to passive full range | XLM fell 26% over the window; best was w=±25% with threshold rebalances, -$299 vs passive; walk-forward +$7 |
| Sushi stable pools | Technically yes, economically no | best excess +$0.4 to +$8.8 per month |
| Aquarius XLM/USDC 0.10% (7 days) | In-sample yes, **out-of-sample no** | 14,145 swaps, $4.84M volume, $4.8k gross fees in 7 days. Static ±5% range: fees $238, IL -$127, LVR $64, **+$103 vs passive**; no rebalancing rule did better. Walk-forward (pick on days 1-3.5, score on 3.5-7): **-$54** |
| Aquarius USDT0/USDC, PYUSD/USDC | Technically yes, economically no | +$0.4, +$1.2 per month |
| Aquarius USDC/sUSD | **Yes** | ±0.25% range, rebalance after 1 h out of range: fees 356 sUSD (43% fee APR), IL -94, LVR 62, 4 rebalances costing 30; **+230 sUSD vs passive** (+28% APR over HODL); walk-forward (pick on days 1-15, score on 16-30) +85 |
| Aquarius PYUSD/sUSD | Yes, smaller | static ±0.5%: +44 sUSD vs passive; walk-forward +12 |

sUSD has no DefiLlama price; its amounts are shown in sUSD [U: assumed near $1].

**What the backtest says about a *manager* (active rebalancing), the actual product:** on every pool with a positive result the gain over passive comes from **concentration, not rebalancing** (Aquarius XLM/USDC included: one 1-hour-delay rebalance in 7 days, no gain). The best rebalancing rule beat the best static narrow range by +$20.6/month on USDC/sUSD, lost $18 on PYUSD/sUSD, and never triggered elsewhere. Capacity is small: at $100k the USDC/sUSD excess is +$401/month (vs +$230 at $10k), because positions quickly become a large share of active liquidity.

**Signal: kill the active LP manager as a business on today's numbers; keep the backtester.** Sushi Stellar's TVL is mostly idle stable liquidity with almost no fee volume, and on Aquarius the measurable edge is a static narrow range on two sUSD pairs, with a few hundred dollars a month of capacity. Revisit if Sushi stable volume grows, or if a longer Aquarius XLM/USDC window (CLP-013; 7 days here) shows rebalancing beating a static range after costs out of sample. Caveats: one 30-day window, Aquarius protocol share unknown (overstates Aquarius fees by that share), price-taker model (`SPEC.md` 3.2), USD values at capture-time prices.

## Status (2026-11-08)

| Part | State |
|---|---|
| Prior-art re-check (CLP-001) | done; class 3, vault overlap with Peridot/YARV, scope narrowed |
| Sushi data (factory, pools, TVL, 30-day swaps) | works; fixtures in `fixtures/sushi`; StellarExpert source cross-checked against RPC (4/4 pools match) |
| Aquarius data | pool list + 30-day hourly stats for 47 pools; 30-day swaps (with real active liquidity from `pool_state` events) for USDT0/USDC, USDC/sUSD, PYUSD/USDC, PYUSD/sUSD, and 7-day swaps for XLM/USDC. The Aquarius API event feed (`gecko-terminal/events`) timed out from this machine after the first chunks, so swaps come from StellarExpert instead; the feed client and L-inference remain, tested on synthetic data. |
| Backtester + CLI + reports | works; `fees`, `aqua-hourly`, `backtest`, `report`; engine `trace` option for charts (CLP-016) |
| Tests | 27 TypeScript tests (closed-form IL, LVR, fee share, rebalance cost, decoders, fixtures, trace, testnet encoders, recorded-run check); 18 contract tests (vault 13 + testnet scenario 2, demo pool 2, demo oracle 1) |
| Vault contract | builds; clippy `-D warnings` clean; **deployed to testnet 2026-11-08** with runtime throwaway keys and exercised by `scripts/testnet-vault.ts`: deposit, 4 guard refusals (in range, stale oracle, oracle/pool deviation, cooldown), 1 accepted rebalance, withdraw. Vault `CDHB2NLP3UFIVDE2PSIYX7ZIVYCE5ZRTAPNUAMWDZQBEZI72GYKSOWQA` [P: `fixtures/testnet/vault-run.json`] |
| Audit fixes (2026-11-08) | Overview table now has a per-pool Window column and window-neutral headers; vault share price carries a virtual offset against first-depositor and donation inflation (unit-tested; fails if the offset is 1); oracle future-timestamp, config validation and pause event added; testnet scenario re-run against the fixed wasm. Open and disclosed: exits unwind with `min_amounts = 0` (accepted trade-off, `RISKS.md`), no property fuzzing, no audit, advisory RUSTSEC-2026-0387 in a soroban-sdk dependency |
| Testnet run caveat | against `contracts/demo-pool` and `contracts/demo-oracle` (admin-set price and feed), **not** a real Aquarius pool or oracle (CLP-011 still TODO) |
| Demo surface `web/` | works; static build; backtest explorer runs the engine in the browser over committed captures; fee volume; testnet vault run with explorer links and a read-only live state check; status page. Live at https://clmm-lab-stellar.github.io/cl-lp-manager/ (GitHub Pages, deployed from `main` by `.github/workflows/pages.yml`). See `DEMO.md` |
| Measured | Sushi and Aquarius fee volume, backtests above, the testnet run |
| Not checked | Aquarius protocol fee share; reward (AQUA) income; real-pool behaviour of the vault; windows longer than 30 days; Sushi position manager (`CARTUL5A…` per sushi-labs bindings, unread) |
| Not built | in-contract position math (CLP-008), property fuzzing (CLP-012; a virtual-offset share price and an example donation test exist), DeFindex adapter (CLP-009), keeper service (CLP-014), audit; the npm package and the contracts are not published (`DEPLOY.md`) |

Investor material: `PITCH.md`. Demo script: `DEMO.md`. Later-phase checklist: `DEPLOY.md`. MVP scope: `MVP-PLAN.md`.

## How to run

Toolchain: Node 24 (`engines >= 22.18`), pnpm 10.22.0, TypeScript 7 (type stripping, no build step). Rust 1.97.1 (`contracts/rust-toolchain.toml`), `soroban-sdk = "25"` (resolves to 25.3.2, the version the Stellar CLI 25.2.0 template writes; same pin as `token-invariants`).

```
pnpm install
pnpm check                                   # typecheck + tests + lint
node src/cli.ts fees fixtures/sushi/*.history.json
node src/cli.ts aqua-hourly                  # Aquarius 30-day volume/fees for all 47 CL pools
node src/cli.ts backtest fixtures/sushi/CCR2CH4GQVCZHG7CHFVMNANCK45CU5DVKXZIIITDZQAU3CEJZ7RQH2MQ.history.json --capital-usd 10000
node src/cli.ts report --dir fixtures --top 10 --capital-usd 10000 --out reports
cd contracts && nice cargo test -j 2 && nice cargo clippy -j 2 --all-targets -- -D warnings && cargo fmt --all -- --check
pnpm contracts:build                         # wasm for vault, demo pool, demo oracle (stellar contract build)
pnpm testnet:vault                           # TESTNET ONLY: deploy + scenario, ~25 txs, ~8 minutes; writes fixtures/testnet/vault-run.json
cd web && pnpm install && pnpm build         # demo surface (runs pnpm demo:data first); pnpm preview to serve dist/
```

Re-capturing data (read-only, throttled, 10-60 minutes): see `TESTING.md` "Fixtures".

Lint: `pnpm lint` (SPDX headers, TODOs need ticket ids, no secret seeds, JSON parses). Format: `cargo fmt` for Rust.

## Layout

`src/` data clients, CL math, backtester, reports, CLI, testnet encoders · `scripts/` capture scripts and the testnet scenario · `fixtures/` captured histories with provenance and the testnet run · `reports/` generated reports · `contracts/vault` Soroban vault and tests · `contracts/demo-pool`, `contracts/demo-oracle` testnet stand-ins · `web/` demo surface · `drafts/` (empty; outreach is the user's) · docs: `MVP-PLAN.md`, `DEMO.md`, `PITCH.md`, `DEPLOY.md`, `SPEC.md`, `ARCHITECTURE.md`, `BUILD-PLAN.md`, `TASKS.md`, `TESTING.md`, `RISKS.md`, `PRIOR-ART.md`, `SOURCES.md`, `AGENTS.md`.

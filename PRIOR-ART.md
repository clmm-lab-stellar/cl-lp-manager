# cl-lp-manager: prior art (CLP-001)

Search date: **2026-11-03**. Procedure: `../../../zero-to-one-discovery/notes/VERIFY_PROTOCOL.md` step B and C. The searches were run by a helper agent in this session; the claims below marked "checked" were re-checked by the build agent. Raw query log, script copies and downloaded READMEs/handoff docs were kept in the session scratchpad (not committed); the counts are reproduced here.

## Verdict

**Class 3 (partially addressed), confidence high.** Partial overlap, **not a STOP**:

- **The vault is not new.** Peridot Finance has run keeper-rebalanced, oracle-guarded Aquarius CL strategies on mainnet since about 2026-08-27 (coupled to its lending markets, no licence). YARV (synt-tech) built the public DeFindex share-vault form on testnet on 2026-10-26 (no licence). So this project's vault is a **reference implementation for testing the rebalance guard**, not a product claim.
- **The Sushi V3 manager is planned by Peridot, not built** (handoff dated 2026-10-30).
- **An open, published Stellar CL backtester with measured fee volume was not found.** Peridot's 2026-10-30 handoff specifies a `research/cl-backtest/` (±2/5/10/20% widths, IL/LVR, capacity) that does not exist in its repo yet. This is the part this project leads with.

Scope narrowed accordingly: backtester + fee-volume measurement is the deliverable; the vault stays testnet-only and is positioned as the guard/accounting reference. No "first" or "novel" claim is made anywhere (gate G-NOVELTY).

## Query log (step B)

### GitHub repository search (`gh api search/repositories`)

| Query | Results | Relevant |
|---|---|---|
| concentrated liquidity soroban | 4 | CL DEXes only (lumenitos-swap, Beluga, stellar-dynamic-amm, SoroPool) |
| soroban rebalance | 1 | rends-east/soroban-rebalance (empty README) |
| stellar liquidity manager | 1 | YieldAnchor (not CL) |
| aquarius concentrated | 1 | synt-tech/rebalancing_vault (YARV) |
| sushi stellar | 1 | 2023 repo, unrelated |
| defindex strategy | 4 | YARV, ustry-hodl, yieldpilot |
| uniswap v3 soroban | 2 | DEX implementations |
| range order stellar | 0 | |
| lp vault soroban | 1 | tidal-amm |
| backtest concentrated liquidity | 3 | ticklab, cl-lp-rotation-scanner, uniswap-v3-auto-lp-base: none Stellar |
| concentrated liquidity stellar | 9 | Swyft, V-PTL, OrbitDEX, NibrasD, YARV |
| soroban clmm / stellar clmm | 1 / 1 | toy DEXes |
| aquarius amm | 4 | dao-aquarius-soroban, audit-competition repos |
| soroban vault | 190 | none CL |
| concentrated liquidity created:>2026-01-01 | 213 | none on Stellar except DEXes and YARV |
| soroban liquidity created:>2026-01-01 | 92 | generic AMM engines |
| stellar vault created:>2026-01-01 | 269 | none CL |
| rebalancing vault stellar | 2 | YARV |
| automated liquidity stellar | 16 | YARV |
| hoops finance | 1 | unrelated |
| soroban uniswap / stellar amm tick / impermanent loss stellar | 3 / 1 / 1 | none relevant |

### GitHub code search (`gh api search/code`)

| Query | Results | Relevant |
|---|---|---|
| `tick_lower language:Rust soroban_sdk` | 61 | **joshschcom/peridot-markets `core/aquarius-lp-vault`**, OdyxeeeLabs/Perigee `dex_lp_strategy`, CL DEXes |
| `tick_lower soroban` | 111 | same, plus sushi-labs/sushiswap Stellar front-end |
| `pool_type concentrated aquarius` | 53 | peridot-markets, LumAgg `aquarius_clmm.rs`, LumenLP, AquariusDeFi/aquarius-sdk |
| `sqrt_price_x96 soroban_sdk` | 53 | stellar-broker router Sushi adapter, sushi-labs test wasm |
| `DeFindexStrategyTrait` | 5 | XOXNO lending, TurboLong leverage; no CL (YARV's `cl_aquarius` not indexed) |
| `DeFindexStrategyTrait concentrated` / `aquarius` | 0 / 0 | |
| `rebalance soroban_sdk tick` | 25 | peridot-markets (9), Perigee, a playground example |
| `tick_upper soroban_sdk rebalance` | 8 | Perigee, peridot-markets |
| `stellar concentrated vault rebalance soroban_sdk keeper` | 6 | Peridot |
| Sushi factory / position-manager address | 11 / 9 | sushi-labs/sushiswap bindings, DefiLlama adapter, LumAgg |
| `org:steerprotocol soroban`, `org:ArrakisFinance stellar`, `org:ichifarm soroban` | 0 each | |
| `org:GammaStrategies soroban`, `sushi stellar language:Rust soroban_sdk` | not run | TLS timeouts; recorded, not retried |

### Registries

- npm (`registry.npmjs.org/-/v1/search`): "soroban concentrated liquidity", "stellar uniswap v3", "aquarius amm", "sushi stellar", "concentrated liquidity backtest", "stellar liquidity manager" return large fuzzy totals; top-20 results are SDKs/plugins; "defindex" 28 results (SDKs, plugins). No Stellar CL manager or backtester package.
- crates.io: "concentrated liquidity" 60, "soroban amm" 4, "uniswap v3" 100, "soroban vault" 20: none relevant; "defindex" 5 (`defindex-strategy-core` 0.3.0).

### Local registers (`../zero-to-one-discovery`)

- SCF corpus (945 files; round on line 2): SCF #45 has 44 files, #46 has 1. The only #45/#46 entry mentioning concentrated liquidity in an LP sense is BIM Exchange (`recMWcSVJ3u1AoGy2`), which routes to Sushi CL; not a manager.
- `notes/scf_register_financial_D2.md:485-489` (Solo Labs/ICHI), `:1011` (ICHI "show[s] no Stellar code"); `notes/scf_register_apps_D3.md:146` (LumAgg); `data/gh/search_merged.tsv:1310` (LumenLP, tags autorebalance/lp).

### Web

10 WebSearch queries (Sushi Stellar CL vault, Steer on Stellar, Aquarius auto-range, Upshift Sushi curator, Peridot Aquarius CL, ICHI Stellar, Hoops ALM, launch announcements). No live public Stellar CL vault product, no Steer/Arrakis/Gamma/ICHI Stellar deployment, no Aquarius or Sushi native auto-range announcement. WebFetch was refused for docs.upshift.finance and docs.aqua.network by the tool's domain check; the Aquarius `.md` doc pages were read by plain GET instead.

## Related projects

| Project | What | Status | Licence | Same problem? |
|---|---|---|---|---|
| **Peridot Finance** `PeridotFinance/Peridot-Soroban` (aquarius-lp-vault, aquarius-keeper) | Vault owns one Aquarius CL position, oracle NAV with pool/oracle divergence guard, keeper recentring (half-width 40 ticks, margin, cooldown), AQUA harvest | **Mainnet.** Checked: repo pushed 2026-11-03, licence null; strategy `CANCOWOI6R2FZBDLZKUL6BUZJN3VONPZSUUSWFL3KF3MPG5INAF25EKY` (PYUSD on PYUSD/USDC CL) created 2026-08-27 with 4,324 invocations (StellarExpert). Handoff 04 (2026-10-30) plans `sushi-cl-vault` and `research/cl-backtest/` | none | **Yes for the Aquarius vault**, but behind lending receipt markets, not a public LP vault; backtest planned, not built |
| **YARV** `synt-tech/rebalancing_vault` | DeFindex `cl_aquarius` strategy, Reflector-guarded rebalance, slippage cap, loss budget, cooldown; internal audit lists 1 critical, 7 high | Testnet, created/pushed 2026-10-26, 0 stars | none | Yes for the public vault form; no backtester; Sushi adapter on roadmap |
| `joshschcom/peridot-markets` | HackMeridian fork with a factory-created Aquarius "ladder vault" (up to 7 rungs) | testnet, 2026-10-26 | none | Adjacent |
| LumenLP `LumenLP/lumenlp` | LP analytics, stay-in-range and fee-harvest previews, Aquarius indexer | pushed 2026-09-16 | MIT | Analytics, not execution or backtest |
| OdyxeeeLabs/Perigee `dex_lp_strategy` | Generic Soroban CL range-rebalance contract with IL guard | pushed 2026-10-22, no real venue adapter | none | Adjacent |
| Solo Labs / ICHI ALM | SCF #26 Activation, $50k: ICHI single-asset vaults on several Stellar AMMs | No Stellar code (code search 0) | n/a | Attempted, abandoned (class 2 for that slice) |
| Hoops Finance | SCF #29/#30: indexer + "automated liquidity management" | repo holds account contracts and constant-product adapters, pushed 2026-02-28; no CL | n/a | Not delivered |
| The Strategists (SCF #42), Lobster (SCF #36), Warp Drive (SCF #41), LumAgg, Upshift, Nectar | LP strategy / vault / keeper layers | various | various | Not CL range management |
| EVM/Solana backtesters (ticklab, cl-lp-rotation-scanner, `lpsignal`) | CL backtests | live | various | Other chains only |

DeFindex: `paltalabs/defindex` archived 2026-07-01, moved to `defindex-io/stellar-contracts` (no licence). Strategy trait `DeFindexStrategyTrait` (crate `defindex-strategy-core` 0.3.0): `__constructor(asset, init_args)`, `asset()`, `deposit(amount, from)`, `harvest(from, data)`, `balance(from)`, `withdraw(amount, from, to)`. Official strategies: blend, fixed_apr, hodl, soroswap, unsafe_hodl, xycloans; **no CL strategy**. Single-asset interface, so a CL strategy must swap internally (CLP-009).

Sushi Stellar contracts (from `sushi-labs/sushiswap` web app bindings, per the helper agent; factory checked against DefiLlama's adapter): FACTORY `CD3KRKGDRVWPXVB3VXLUMQKMX6XZ6Q2H334IVZD4XXNAMKSRVQL5GLYF`, POSITION_MANAGER `CARTUL5AWDZYBSN7HUUJZSKCAKCIAKM7M54Z76G6KRYCK4XPR3OHUQZ4`, ROUTER `CDMIM23WOUL5CZBKX3GOA3V5R5AMVIMTCP52KCDQORWELAPLJ27WZCHL`. Contract source is private (bindings link a 404 repo). A Code4rena/Zenith audit (Oct 2025) is mirrored publicly [S, not opened]. Aquarius CL pool source is not public; its docs list the events this project decodes.

## Adversarial questions (step C)

1. **Strongest reason it might not be novel:** Peridot already runs oracle-guarded, keeper-recentred Aquarius CL strategies on mainnet and has written down both the Sushi sibling vault and the exact range-width backtest.
2. **Closest existing product:** Peridot's aquarius-lp-vault + aquarius-keeper (mainnet, lending-coupled). Closest public share-vault: YARV (testnet).
3. **Evidence someone attempted it:** ICHI/Solo Labs (SCF #26) and Hoops (SCF #29/#30) were funded and did not ship CL management; then YARV, the Peridot ladder vault, Perigee, LumenLP.
4. **Could a protocol feature remove the need?** Not today: Aquarius docs describe manual withdraw-and-redeposit; neither venue has announced auto-range. Absorption risk if Aquarius ships managed positions.
5. **Could an existing product solve it with a small integration?** Yes for the vault: Peridot (new init params, planned Sushi crate), YARV (real-pool wiring + Sushi adapter), DeFindex (strategy slot). The backtester has no such shortcut in the Stellar ecosystem.
6. **Published design or PoC:** YARV repo and audit doc; Peridot handoffs 04 and 07; Perigee README.
7. **Renamed version of an existing project?** The vault is a Stellar port of Arrakis/Gamma/Steer/ICHI, and of ICHI's abandoned SCF #26 plan.
8. **Search most likely to disprove novelty (of the backtester):** full read of Peridot handoffs 00/03/07 and its branches for a backtest; HackMeridian 2026 results list; Aquarius roadmap/Discord for managed positions. Run: Peridot handoff 04 only. Not run: the rest (recorded as open).

## What this changes in the build

- The README positions the backtester and the fee-volume measurement as the contribution; the vault is a testnet reference for the oracle-bounded guard.
- The measured fee volumes and backtest (README "Results") are directly useful to Peridot's planned Sushi go/no-go and to YARV/DeFindex. Any contact is the user's call (gate G-OUTREACH); no drafts were written yet.
- No code from Peridot or YARV was read into this repo (both unlicensed; gate G-LICENCE).

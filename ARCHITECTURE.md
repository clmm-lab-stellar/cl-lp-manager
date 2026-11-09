# cl-lp-manager: architecture

```
                 read-only GETs / simulateTransaction (never signed, never sent)
 StellarExpert ──┐        Aquarius API ──┐        mainnet RPC ──┐        DefiLlama ──┐
 (contract events)│   (pools, hourly,     │   (token meta,       │   (spot USD,       │
                  │    gecko events)      │    balances, views,  │    factory addr    │
                  ▼                       ▼    getEvents)        ▼    in adapter)     ▼
          src/data/sushi.ts      src/data/aquarius.ts     src/data/stellar.ts    src/data/prices.ts
                  │                       │                       │
                  └────────── scripts/capture-*.ts ───────────────┘
                                          │  writes, with provenance
                                          ▼
                     fixtures/{sushi,aquarius}/<pool>.history.json   (PoolHistoryFile)
                     fixtures/aquarius/<pool>.hourly.json, pools.json
                     fixtures/sushi/pools.json, <pool>.rpc-crosscheck.json
                                          │  offline from here
                                          ▼
       src/math/clmm.ts ──► src/backtest/engine.ts ──► src/backtest/grid.ts ──► src/report/markdown.ts
                             (one config, swap by swap)  (widths x rules,        src/cli.ts (fees | backtest | report)
                                                          passive, HODL,                  │
                             src/backtest/fees.ts         walk-forward)                   ▼
                             (realised volume/fees)                          out/report.{json,md}, reports/

 contracts/vault (Rust, soroban-sdk 25): ClVault ──calls──► Aquarius-shaped CL pool (mock in tests)
                                                  └─calls──► SEP-40 oracle (mock in tests)
```

## Modules

| Module | Responsibility |
|---|---|
| `src/util/http.ts` | per-host throttle (default 600 ms), retries with backoff for 429/5xx/network, fatal on other 4xx, optional sha256-keyed disk cache under `.cache/http` |
| `src/data/stellar.ts` | read-only RPC simulation with a dummy all-zero source account; StellarExpert event paging; TOID to ledger |
| `src/data/sushi.ts` | factory constant, `pool_created` and `swap` decoders, `sqrt_price_x96` to price |
| `src/data/aquarius.ts` | pool list, hourly stats, gecko event feed (413 splitting), swap conversion with inferred L |
| `src/types.ts` | `PoolHistory` and its compact file form |
| `src/math/clmm.ts` | CL amounts/value/liquidity, range overlap fraction, ticks |
| `src/backtest/engine.ts` | the swap-by-swap simulation (SPEC.md 3) |
| `src/backtest/grid.ts` | grid, baselines, eligibility (pool-share cap), walk-forward |
| `src/backtest/fees.ts` | realised volume and fee statistics |
| `src/report/markdown.ts`, `src/cli.ts` | rendering and the CLI |
| `contracts/vault` | testnet vault (SPEC.md 5) and its tests with mock pool/oracle |

## Decisions

1. **Venue-neutral history format.** Both venues reduce to (ts, ledger, amounts, post-price, active L). The backtester never sees venue specifics except `feePpm` and `protocolFeeShare`.
2. **StellarExpert for history, RPC to check it.** Public RPC keeps 7 days of events (and scans about 10,000 ledgers per `getEvents` call, so the cross-check pages by cursor ledger); the window needed is 30. StellarExpert has full history but is a third party, so `scripts/crosscheck-rpc.ts` compares counts and volumes over the overlap (Sushi: 4/4 pools match exactly). Aquarius swaps also come from StellarExpert because the Aquarius event feed was unreachable; those carry real active L.
3. **Aquarius L inferred, not read.** The gecko feed carries price and amounts but not L. Inference from consecutive prices is exact for swaps inside one tick range and an average otherwise; a single `get_active_liquidity()` read at capture is stored for a sanity check.
4. **Price-taker with a pool-share cap.** Simpler than simulating the pool's tick map; honest about where it breaks (configs over 20% of active L are flagged and excluded from "best").
5. **Exact discrete LVR** on the observed path instead of `sigma^2/8` formulas: no volatility estimate needed, and it matches the closed form in tests.
6. **Vault targets the Aquarius interface**, not Sushi's: Aquarius positions are owned directly by the caller (`deposit_position(sender, ...)`), which a vault contract can hold without an NFT position manager; Aquarius also carries most of the measured CL fee volume (README "Results").
7. **Unwind-and-redeploy share accounting** in the vault for v1: correct without in-contract tick math; replaced in CLP-008.

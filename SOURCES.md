# cl-lp-manager: sources

Trust tags: [P] primary (read directly from chain, official API or source), [S] secondary, [I] inferred, [E] estimate, [U] unknown/unverified, [N] earlier note not re-checked.

## Discovery notes

- `../../../zero-to-one-discovery/reports/Stellar aggregator devtools infra ideas.md` row F5 and the adversarial table (column "CL LP manager") [N].
- `../../../zero-to-one-discovery/research_notes/Stellar aggregator devtools infra ideas/defi_aggregators.md` section C6 [N].
- `../../../zero-to-one-discovery/notes/VERIFY_PROTOCOL.md` (procedure followed in `PRIOR-ART.md`).

## Data sources used (all read 2026-11-03)

| Source | Used for | Tag |
|---|---|---|
| https://github.com/DefiLlama/DefiLlama-Adapters/blob/main/projects/sushi-stellar/index.js | Sushi factory `CD3KRKGDRVWPXVB3VXLUMQKMX6XZ6Q2H334IVZD4XXNAMKSRVQL5GLYF` | [P] (DefiLlama's adapter, not Sushi docs) |
| https://api.llama.fi/protocol/sushi-stellar | Sushi Stellar TVL $15,598,794 on 2026-11-03; first point $2,370,350 (2026-05-12) | [P] |
| https://api.stellar.expert/explorer/public/contract/{id}/events | Sushi factory and pool events (pool list, swaps) | [S] third-party indexer, cross-checked with RPC |
| https://mainnet.sorobanrpc.com (`getEvents`, `simulateTransaction`, `getHealth`) | token metadata, pool balances, protocol fee, Aquarius `get_active_liquidity`, cross-check of Sushi swaps (7-day retention: 120,960 ledgers) | [P] |
| `stellar contract info interface --id <pool> --network-passphrase "Public Global Stellar Network ; September 2015" --rpc-url https://mainnet.sorobanrpc.com` | Sushi pool and Aquarius CL pool function signatures | [P] |
| https://amm-api.aqua.network/pools/?pool_type=concentrated | 47 concentrated pools, fee tiers, USD fields (1e-7 USD units) | [P] |
| https://amm-api.aqua.network/statistics/pool/{address}/ | hourly volume and liquidity, 720 hours | [P] |
| https://amm-api.aqua.network/api/external/gecko-terminal/events/ | Aquarius swaps with post-swap price and reserves | [P] |
| https://amm-api.aqua.network/api/schema/ | OpenAPI for the above | [P] |
| https://coins.llama.fi/prices/current/stellar:{contract} | spot USD prices at capture (no price for sUSD) | [S] |
| https://api.stellar.expert/explorer/public/contract/{aquarius pool}/events | Aquarius CL swaps with `pool_state` active liquidity (committed fixtures) | [S] third-party indexer |
| https://github.com/PeridotFinance/Peridot-Soroban (repo metadata) and StellarExpert contract `CANCOWOI6R2FZBDLZKUL6BUZJN3VONPZSUUSWFL3KF3MPG5INAF25EKY` | prior art check (mainnet Aquarius CL strategy, created 2026-08-27) | [P] |

## Facts recorded (2026-11-03)

- Sushi factory has emitted 66 `pool_created`, 57 `pool_upgraded`, 3 `pool_migrated`, 2 `wasm_approved`, 1 `set_protocol_fee` (0 -> 4 on 2026-04-02) events [P].
- 7 Sushi pools hold 99.99% of priced Sushi TVL: USDT0/USDC 0.05% ($5.11M), USDC/deJAAA 0.05% ($4.03M), deJTRSY/USDC 0.05% ($4.03M), PYUSD/USDC 0.05% ($0.67M), USDY/USDC 0.05% ($0.65M), XLM/USDC 0.30% ($0.61M), USDT0/USDE 0.05% ($0.50M) [P: balances by simulation x DefiLlama prices; total $15.597M vs DefiLlama $15.599M].
- Sushi pool swap events carry `amount0, amount1, liquidity, sqrt_price_x96, tick` (Uniswap V3 layout) [P].
- Aquarius CL pools expose user-owned positions (`deposit_position(sender, tick_lower, tick_upper, …)`) rather than an NFT position manager [P: contract spec].

## Blocked or not checked

- The Aquarius API (`amm-api.aqua.network`) timed out from this machine from about 22:00 on 2026-11-03 while other hosts answered; the gecko event feed capture never completed. Public RPC and StellarExpert also dropped connections at times. Captures were retried, not bypassed.
- Sushi Stellar position manager `CARTUL5AWDZYBSN7HUUJZSKCAKCIAKM7M54Z76G6KRYCK4XPR3OHUQZ4` per the sushi-labs/sushiswap web-app bindings (helper agent) [S]; interface not read (CLP-010).
- Aquarius fee split between LPs and protocol: not found [U].

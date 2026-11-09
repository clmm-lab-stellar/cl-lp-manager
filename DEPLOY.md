<!-- SPDX-License-Identifier: Apache-2.0 -->
# cl-lp-manager: deploy checklist (later phase)

Status (2026-11-09): the repo is public at https://github.com/clmm-lab-stellar/cl-lp-manager and the static web app (section 1) is live at https://clmm-lab-stellar.github.io/cl-lp-manager/ via GitHub Pages. The npm package (section 2) and any contract publication (section 3) have not been done. The remaining steps are mechanical once the user approves each one. **Mainnet: never** (gate G-VALUE): no mainnet contract deployment, no mainnet keys, no mainnet writes from any part of this project.

## 1. Static web app (`web/`)

**Done 2026-11-09.** Live at https://clmm-lab-stellar.github.io/cl-lp-manager/; `.github/workflows/pages.yml` rebuilds and deploys on every push to `main`. The table below is what the workflow does and how to host elsewhere.

| Item | Value |
|---|---|
| Build | `cd web && pnpm install --frozen-lockfile && pnpm build` (runs `pnpm demo:data`, `tsc --noEmit`, `vite build`) |
| Output | `web/dist/` (relative base `./`, servable from any path; ~5.4 MB including `data/pools/*.json`) |
| Host | any static host (GitHub Pages, Cloudflare Pages, Netlify, S3). No server, no functions |
| Env vars | none. The only network call in the page is the user-triggered "Read state": public testnet RPC `https://soroban-testnet.stellar.org` |
| CSP if set | `connect-src 'self' https://soroban-testnet.stellar.org`; fonts are bundled (no Google Fonts) |
| Before publishing | re-run `pnpm testnet:vault` if testnet has been reset since `fixtures/testnet/vault-run.json` (the page shows "Read failed" otherwise, never stale data as live) |

## 2. npm package: the backtester

| Item | Value |
|---|---|
| Package | `@sik/cl-lp-manager` (root `package.json`; currently `"private": true`, version `0.0.0`) |
| To publish | set `private: false`, version, `files` (`src/`, `README.md`, `SPEC.md`), `exports` for `src/backtest/*.ts`, `src/math/clmm.ts`, `src/types.ts`; decide whether to ship `.ts` (type stripping, Node >= 22.18) or add a `tsc` emit step |
| Checks | `pnpm check` (typecheck, 27 tests, lint) |
| Not to ship | `.cache/`, `fixtures/` (large; publish separately as a data release if wanted), `web/`, `contracts/target/` |

## 3. Contracts (`contracts/`)

| Crate | Publish? | Notes |
|---|---|---|
| `sik-cl-lp-manager-vault` | **No** until audited (`publish = false` in the workspace) | UNAUDITED, DEMO-ONLY. Mainnet deployment is blocked by G-VALUE: audit, value cap and written user approval first |
| `sik-cl-lp-manager-demo-pool` | **Never to mainnet** | testnet stand-in; admin sets the price |
| `sik-cl-lp-manager-demo-oracle` | **Never to mainnet** | testnet stand-in; admin sets prices |

Build: `pnpm contracts:build` (Stellar CLI 25.2.0, Rust 1.97.1, `wasm32v1-none`). Wasm sha256 of the 2026-11-08 testnet deployment: vault `66843f95…e188687` (21,111 B, after the 2026-11-08 audit fixes), pool `36e1da2d…cb07695`, oracle `c8e0438d…a51422` (full values in `fixtures/testnet/vault-run.json`). For any future public deployment, use a verified build (SEP-0055 style GitHub attestation) and deploy the attested wasm.

## 4. Testnet contract ids (2026-11-08 run; gone after the next testnet reset)

| Contract | Id |
|---|---|
| Vault | `CDHB2NLP3UFIVDE2PSIYX7ZIVYCE5ZRTAPNUAMWDZQBEZI72GYKSOWQA` |
| Demo pool | `CBEEAMG44M7HHG2XPFCDGV56NSLRVE4QAPT62QU7M7AQF6AGWORFQJZF` |
| Demo oracle | `CCPVX4AIAM4ZUPOLATBTK4KPKXOHVQNSVSMHE3MC33DZDENFWKPH6YSO` |
| CLPT0 SAC | `CCFRICF2O36X3RARLWKV3IAA5BMTVZ65VJARADRMRUDILY7BSEILM5R6` |
| CLPT1 SAC | `CDPNABT3W4DDRHZDUGOIGLD4TI6VZAPU7FVOWYTHVOAINWJW2IDRJTUE` |

Refresh: `pnpm contracts:build && pnpm testnet:vault && pnpm demo:data`. Keys are generated in memory per run; there is nothing to store or rotate.

## 5. CI (GitHub Action)

`.github/workflows/pages.yml` runs `pnpm check` and the web build, then deploys Pages (steps 1 and 3 below; the Rust checks in step 2 are not in CI yet). The notes below still apply to any extension.

One workflow on push. Use `actions/setup-node`, `pnpm/action-setup` and `dtolnay/rust-toolchain` pinned by commit SHA. Then:

1. `pnpm install --frozen-lockfile && pnpm check`;
2. `cd contracts && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test`;
3. `cd web && pnpm install --frozen-lockfile && pnpm build`.

No secrets are needed. Do **not** run `testnet:vault` in CI (it needs friendbot and takes about 8 minutes). Keep it a manual step.

## 6. What must not go anywhere

- Any mainnet deployment of `contracts/*` (G-VALUE).
- Secret keys: none exist on disk; keep it that way (G-SECRETS). `pnpm lint` fails on anything shaped like a secret seed.
- Outreach (posting results to Aquarius, Sushi, DeFindex, forums) is the user's call (G-OUTREACH). Drafts, if any, go in `drafts/`.

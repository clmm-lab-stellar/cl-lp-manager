# cl-lp-manager: build plan

Estimates are [E]: one agent-day = one focused session; based on this session's pace, not measured.

| Milestone | Contents | Acceptance | Estimate | Status (2026-11-08) |
|---|---|---|---|---|
| M0 Prior art | VERIFY_PROTOCOL step B, 8 adversarial answers | `PRIOR-ART.md` dated, every query logged | 0.5 day | done |
| M1 Data | Sushi pools + 30-day swaps, Aquarius CL list + hourly + 30-day swaps, provenance, RPC cross-check | fixtures captured by script; fee volume per pool measured | 1 day | done (see README Status for gaps) |
| M2 Backtester | CL math, engine, grid, baselines, walk-forward, CLI, reports | closed-form tests pass; report over fixtures | 1-2 days | done |
| M3 Vault v1 | oracle-bounded testnet vault, mock pool/oracle tests | `cargo test` green, clippy clean | 1-2 days | done (tests only; no testnet deploy) |
| M4 Kill/advance call | report fee APR vs passive after costs | README "Results" states the answer with numbers | 0.5 day | done (first pass) |
| M5 Real-pool integration | vault against a real Aquarius CL pool on testnet; keeper script with runtime throwaway keys | deposit/rebalance/withdraw round trip on testnet | 2-3 days | partial (2026-11-08): vault deployed and exercised on testnet against demo pool/oracle (CLP-017/018); real Aquarius pool (CLP-011) and keeper (CLP-014) open |
| M6 DeFindex adapter | single-asset strategy wrapper per DeFindex's strategy trait | builds against DeFindex's published crate; tests | 2-3 days | not started (CLP-009) |
| M7 Hardening | in-contract position math (CLP-008), fuzzing (CLP-012), audit scope document | audit scope written; gate G-VALUE still closed | 1-2 weeks | not started |

M5-M7 only if the M4 signal is "advance" for at least one pool family. See README.

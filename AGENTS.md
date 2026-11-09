# Agents: cl-lp-manager

Read `../../docs/AGENT_GUIDE.md`, `../../docs/GATES.md`, `../../docs/CONVENTIONS.md` first. Then this project's `SPEC.md` and `TASKS.md`.

Project rules:

- **G-VALUE.** The vault is testnet-only and unaudited. Never deploy it to mainnet, never sign or send a mainnet transaction. Testnet keys are generated at runtime (`Keypair.random()` in memory in `scripts/testnet-vault.ts`, funded by friendbot) and never written anywhere.
- **Read-only mainnet.** Captures use GETs and `simulateTransaction` with a dummy source; nothing is submitted.
- **Rate limits.** At most ~2 requests/s per host (the HTTP helper enforces it). StellarExpert at 1 request/s.
- **Numbers.** Results in README must come from `node src/cli.ts report` over committed fixtures. If you re-capture, re-run the report and update README "Results" with the new date.
- **Novelty.** Do not call this "first" or "novel"; see `PRIOR-ART.md`.
- **UI (since 2026-11-08, MVP-PLAN.md).** One demo surface: `web/` (Vite + React + Tailwind v4, kit design system copied from `design/`). Before any UI change invoke the taste skills per the user's global rule. Every figure carries a provenance chip; the browser reads committed data and, on request only, testnet (read-only simulation). It never writes and never reads mainnet live.
- **Demo contracts.** `contracts/demo-pool` and `contracts/demo-oracle` are testnet stand-ins; say so wherever their output appears.
- Ticket prefix `CLP`. TODOs in code need a ticket id.

// SPDX-License-Identifier: Apache-2.0
// What works, what does not, and what launch needs. Mirrors README "Status" and TASKS.md.
import { DATA } from '../lib/data';
import { GateBadge, PageHeader, StatusTable, type StatusRow } from '../ui/kit';

export function Status() {
  const run = DATA.testnet;
  const works: StatusRow[] = [
    { id: 'data', name: 'Mainnet data capture (Sushi V3, Aquarius CL)', status: 'pass', statusLabel: 'Works', detail: 'Read-only, throttled scripts; 12 pool histories with provenance; Sushi cross-checked against RPC getEvents (4 of 4 pools match).' },
    { id: 'bt', name: 'Swap-by-swap backtester and CLI', status: 'pass', statusLabel: 'Works', detail: 'Closed-form tests for IL, LVR, fee share, rebalance cost; grid, walk-forward, reports. The explorer runs the same code in the browser.' },
    { id: 'vault', name: 'Oracle-bounded vault contract', status: 'pass', statusLabel: 'Works', detail: 'soroban-sdk 25; 13 unit tests (including a donation-inflation test) plus a scenario test against the deployable demo pool and oracle; clippy -D warnings clean.' },
    {
      id: 'tn',
      name: 'Vault on testnet',
      status: run ? 'pass' : 'unknown',
      statusLabel: run ? 'Recorded run' : 'Not run',
      detail: run ? `Deployed and exercised on testnet ${run.finishedAt.slice(0, 10)} with throwaway keys; against the demo pool and oracle, not Aquarius.` : 'No run recorded in this build.',
    },
  ];
  const not: StatusRow[] = [
    { id: 'aq', name: 'Vault against a real Aquarius pool (CLP-011)', status: 'skipped', statusLabel: 'Not built', detail: "Aquarius' token-pull semantics are unverified; testnet pool prices would not match a real oracle." },
    { id: 'math', name: 'In-contract position math (CLP-008)', status: 'skipped', statusLabel: 'Not built', detail: 'Deposits and withdrawals unwind the whole position; correct but gas-heavy.' },
    { id: 'fuzz', name: 'Fuzzing, first-depositor inflation (CLP-012)', status: 'skipped', statusLabel: 'Partly built', detail: 'A virtual-offset share price and a donation-attack unit test are in; rounding is not property-fuzzed. Exits unwind with no price check (RISKS.md). No audit.' },
    { id: 'split', name: 'Aquarius protocol fee share and AQUA rewards (CLP-007)', status: 'unknown', detail: 'Aquarius fee figures are gross; rewards are not counted.' },
    { id: 'win', name: 'Windows longer than 30 days (CLP-013)', status: 'unknown', detail: 'One market regime; XLM/USDC on Aquarius has 7 days only.' },
    { id: 'keeper', name: 'Keeper service (CLP-014), DeFindex adapter (CLP-009)', status: 'skipped', statusLabel: 'Not built' },
  ];
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Status and limits"
        lede="What runs today, what is not built, and what has to happen before anything holds value."
        meta={
          <>
            <GateBadge kind="gate" gateId="G-VALUE" state="closed" />
            <GateBadge kind="unaudited" />
            <GateBadge kind="testnet-only" />
          </>
        }
      />
      <StatusTable caption="Working today" rows={works} />
      <StatusTable caption="Not built or not measured" rows={not} />
      <section className="max-w-prose text-base text-ink-2">
        <h2 className="text-lg font-semibold text-ink">Model limits</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>Price-taker model: the position does not move the observed price path. Positions above 20% of active liquidity are flagged and excluded from "best".</li>
          <li>USD values use token prices at capture time. sUSD has no USD price in the capture, so those pools are shown in sUSD.</li>
          <li>Aquarius active liquidity comes from the pool's own pool_state events; Sushi's from swap events.</li>
          <li>Nothing here is claimed as new: keeper-rebalanced Aquarius vaults already exist (PRIOR-ART.md).</li>
        </ul>
      </section>
    </div>
  );
}

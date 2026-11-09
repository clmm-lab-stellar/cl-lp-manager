// SPDX-License-Identifier: Apache-2.0
// Testnet vault: the recorded run of scripts/testnet-vault.ts (deploy, deposit, four refused
// rebalances, one accepted, withdraw), with explorer links, plus an optional live read of the
// deployed vault's state from public testnet RPC (simulation only; nothing is signed or sent).
import { useState } from 'react';
import { Account, Operation, TransactionBuilder, rpc } from '@stellar/stellar-sdk';
import { ArrowSquareOut, ArrowsClockwise } from '@phosphor-icons/react';
import { decodeState, type VaultState } from '../../../src/testnet/encode.ts';
import { DATA, testnetProvenance, utcTime, type TestnetRun, type TestnetStep } from '../lib/data';
import { Button, DataTable, EmptyState, GateBadge, Hash, PageHeader, ProvenanceChip, StatusTable, UnknownValue, type StatusRow } from '../ui/kit';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

const GUARD_WORDS: Record<string, string> = {
  InRange: 'Refused as expected: price still inside the range',
  OracleStale: 'Refused as expected: oracle reading too old',
  PriceDeviation: 'Refused as expected: oracle and pool disagree',
  Cooldown: 'Refused as expected: minimum interval not reached',
};

function stepRow(run: TestnetRun, s: TestnetStep): StatusRow {
  const asExpected = (s.outcome === 'success' ? 'success' : s.error) === s.expected;
  const label = s.outcome === 'success' ? 'Landed' : 'Refused';
  const reason = s.outcome === 'refused' ? (GUARD_WORDS[s.error ?? ''] ?? `Refused: ${s.error}`) : null;
  const st = s.stateAfter;
  return {
    id: s.id,
    name: (
      <span>
        <span className="text-ink">{s.title}</span>
        <span className="ml-2 font-mono text-xs text-ink-3">
          {s.actor} calls {s.call}
        </span>
      </span>
    ),
    // A refusal the scenario expects is the guard working: it counts as a pass.
    status: asExpected ? 'pass' : 'fail',
    statusLabel: label,
    detail: (
      <span>
        {reason ? <span className="font-medium text-ink">{reason}. </span> : null}
        {s.outcome === 'refused' ? `Simulation returned VaultError::${s.error} at ledger ${s.simulatedAtLedger?.toLocaleString('en-US')}; no transaction was sent.` : null}
        {s.tx ? (
          <a className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline" href={s.tx.url} target="_blank" rel="noreferrer">
            tx {s.tx.hash.slice(0, 10)}… at ledger {s.tx.ledger.toLocaleString('en-US')} <ArrowSquareOut aria-hidden />
          </a>
        ) : null}
        {st ? ` Range after: ticks ${st.tickLower} to ${st.tickUpper}, ${st.rebalances} rebalance${st.rebalances === 1 ? '' : 's'}, ${Number(st.totalShares) / 1e7} shares.` : null}
        {s.note ? ` ${s.note}` : null}
      </span>
    ),
    provenance: testnetProvenance(run, s.tx?.ledger ?? s.simulatedAtLedger),
  };
}

type Live = { state: 'idle' } | { state: 'loading' } | { state: 'ok'; v: VaultState; ledger: number; at: string } | { state: 'error'; message: string };

async function readLive(run: TestnetRun): Promise<{ v: VaultState; ledger: number }> {
  if (run.network !== 'testnet') throw new Error('refusing: recorded run is not on testnet');
  const server = new rpc.Server(run.rpc);
  // Simulation does not check the sequence number; the keeper's public key is only a source.
  const tx = new TransactionBuilder(new Account(run.accounts.keeper, '0'), { fee: '100', networkPassphrase: TESTNET_PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({ contract: run.contracts.vault, function: 'get_state', args: [] }))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error('error' in sim ? String(sim.error).slice(0, 300) : 'simulation returned no result');
  return { v: decodeState(sim.result.retval), ledger: sim.latestLedger };
}

export function Vault() {
  const run = DATA.testnet;
  const [live, setLive] = useState<Live>({ state: 'idle' });
  if (!run) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Testnet vault" lede="The oracle-bounded vault, deployed to testnet with throwaway keys." />
        <EmptyState tone="not-yet-available" title="No testnet run in this build" ticket="CLP-018">
          Run node scripts/testnet-vault.ts to deploy and record one, then pnpm demo:data. Nothing is simulated in its place.
        </EmptyState>
      </div>
    );
  }
  const rebal = run.steps.find((s) => s.id === 'rebalance');
  const prov = testnetProvenance(run, rebal?.tx?.ledger);
  const check = () => {
    setLive({ state: 'loading' });
    readLive(run)
      .then(({ v, ledger }) => setLive({ state: 'ok', v, ledger, at: new Date().toISOString() }))
      .catch((e: unknown) => setLive({ state: 'error', message: String((e as Error).message ?? e) }));
  };
  const last = run.steps[run.steps.length - 1]?.stateAfter;
  const rows = run.steps.map((s) => stepRow(run, s));
  const contracts: { k: string; id: string; what: string }[] = [
    { k: 'vault', id: run.contracts.vault, what: `Vault (contracts/vault), wasm sha256 ${run.wasm.vault?.sha256.slice(0, 12)}…, ${run.wasm.vault?.bytes.toLocaleString('en-US')} bytes` },
    { k: 'pool', id: run.contracts.pool, what: 'Demo pool (contracts/demo-pool). Not Aquarius: price is set by its admin' },
    { k: 'oracle', id: run.contracts.oracle, what: 'Demo oracle (contracts/demo-oracle). Admin-set SEP-40-shaped feed, not a real oracle' },
    { k: 't0', id: run.tokens.token0.contract, what: `${run.tokens.token0.code}: test asset issued by the run's throwaway admin` },
    { k: 't1', id: run.tokens.token1.contract, what: `${run.tokens.token1.code}: test asset issued by the run's throwaway admin` },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Testnet vault"
        lede="The vault rebalances only when the oracle is fresh, agrees with the pool, the price left the range and the cooldown passed."
        meta={
          <>
            <GateBadge kind="testnet-only" />
            <GateBadge kind="unaudited" />
            <GateBadge kind="demo-only" />
            <ProvenanceChip {...prov} />
          </>
        }
      />

      <div role="note" className="rounded-md border border-warning-ring bg-warning-wash p-4 text-sm text-warning-ink">
        <p className="font-medium">What this run is and is not</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          {run.honesty.map((h) => (
            <li key={h}>{h}</li>
          ))}
          <li>{run.keys}</li>
        </ul>
      </div>

      <StatusTable
        caption={`Scenario on testnet, ${utcTime(Date.parse(run.startedAt) / 1000)} to ${utcTime(Date.parse(run.finishedAt) / 1000)}`}
        meta={<ProvenanceChip {...prov} />}
        rows={rows}
      />

      <section aria-labelledby="moves-h" className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <DataTable
          caption="Market moves the admin made between steps (testnet has no market)"
          rows={run.marketMoves}
          rowKey={(m) => m.hash}
          dense
          columns={[
            { key: 'b', header: 'Before step', numeric: true, cell: (m) => m.beforeStep },
            { key: 'w', header: 'Change', cell: (m) => m.what },
            { key: 'h', header: 'Tx', cell: (m) => <Hash value={m.hash} href={m.url} head={6} tail={4} /> },
          ]}
        />
        <DataTable
          caption={`Setup transactions (${run.setup.length})`}
          rows={run.setup}
          rowKey={(m) => m.hash}
          dense
          columns={[
            { key: 'w', header: 'What', cell: (m) => m.what },
            { key: 'l', header: 'Ledger', numeric: true, cell: (m) => m.ledger.toLocaleString('en-US') },
            { key: 'h', header: 'Tx', cell: (m) => <Hash value={m.hash} href={m.url} head={6} tail={4} /> },
          ]}
        />
      </section>

      <section aria-labelledby="live-h" className="rounded-md border border-line bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5">
          <div className="max-w-prose">
            <h2 id="live-h" className="text-sm font-semibold text-ink">
              Check the deployed vault now
            </h2>
            <p className="mt-0.5 text-xs text-ink-3">Reads get_state from public testnet RPC by simulation. Read-only: nothing is signed or sent. Testnet resets wipe these contracts.</p>
          </div>
          <Button onClick={check} disabled={live.state === 'loading'}>
            <ArrowsClockwise aria-hidden className={live.state === 'loading' ? 'animate-spin' : undefined} />
            {live.state === 'loading' ? 'Reading' : 'Read state'}
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5" aria-live="polite">
          <StateBlock title="At the end of the recorded run" v={last ?? null} chip={<ProvenanceChip {...testnetProvenance(run, run.steps[run.steps.length - 1]?.tx?.ledger)} />} />
          {live.state === 'ok' ? (
            <StateBlock
              title={`Live, ${utcTime(Date.parse(live.at) / 1000)}`}
              v={live.v}
              chip={<ProvenanceChip kind="live" ledger={live.ledger} date={live.at.slice(0, 10)} source={run.rpc} note="simulateTransaction of get_state on the recorded vault contract, made by this page just now." />}
            />
          ) : live.state === 'error' ? (
            <div className="rounded-md border border-critical-ring bg-critical-wash p-4 text-sm text-critical-ink">
              <p className="font-medium">Read failed</p>
              <p className="mt-1">The live state was not updated. A testnet reset or an RPC outage are the usual causes; the recorded run on the left is unchanged.</p>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs">{live.message}</pre>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-line-strong p-4 text-sm text-ink-3">
              <UnknownValue reason="This page has not read testnet yet in this session." label="Not read yet" />
              <p className="mt-1">Press Read state to fetch it.</p>
            </div>
          )}
        </div>
      </section>

      <DataTable
        caption="Contracts deployed by the run"
        meta={<ProvenanceChip {...prov} />}
        rows={contracts}
        rowKey={(c) => c.k}
        columns={[
          { key: 'id', header: 'Contract', cell: (c) => <Hash value={c.id} href={`${run.explorer}/contract/${c.id}`} /> },
          { key: 'w', header: 'What it is', cell: (c) => c.what },
        ]}
      />
    </div>
  );
}

function StateBlock({ title, v, chip }: { title: string; v: VaultState | null; chip: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line p-4">
      <p className="text-xs font-medium text-ink-2">{title}</p>
      {v ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-ink-3">Range (ticks)</dt>
          <dd className="text-right text-ink tabular">
            {v.tickLower} to {v.tickUpper}
          </dd>
          <dt className="text-ink-3">Rebalances</dt>
          <dd className="text-right text-ink tabular">{v.rebalances}</dd>
          <dt className="text-ink-3">Total shares</dt>
          <dd className="text-right text-ink tabular">{(Number(v.totalShares) / 1e7).toLocaleString('en-US')}</dd>
          <dt className="text-ink-3">Position liquidity (raw)</dt>
          <dd className="text-right text-ink tabular">{Number(v.liquidity).toLocaleString('en-US')}</dd>
          <dt className="text-ink-3">Paused</dt>
          <dd className="text-right text-ink">{v.paused ? 'Yes' : 'No'}</dd>
        </dl>
      ) : (
        <UnknownValue reason="The run file has no final state." />
      )}
      <div className="mt-3">{chip}</div>
    </div>
  );
}

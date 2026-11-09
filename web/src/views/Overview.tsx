// SPDX-License-Identifier: Apache-2.0
// Landing view: the signature measurement, the per-pool answer to "does a range strategy beat
// passive LP after costs", and the headline fee measurements. All figures from committed
// reports and captures (provenance on each).
import { ArrowRight, CheckCircle, MinusCircle, XCircle } from '@phosphor-icons/react';
import { DATA, VENUE, configWords, fmt, fmtSigned, fmtUsd, hourlyProvenance, reportProvenance, testnetProvenance, type Verdict } from '../lib/data';
import { href } from '../lib/route';
import { DataTable, GateBadge, ProjectHero, ProvenanceChip, StatTile, UnknownValue } from '../ui/kit';

const unitOf = (v: Verdict) => {
  const p = DATA.pools.find((x) => x.pool === v.pool);
  return p && p.token1UsdAtCapture === null ? p.token1.symbol : 'USD';
};

function Answer({ v }: { v: boolean | null }) {
  if (v === null)
    return (
      <span className="inline-flex items-center gap-1.5 text-ink-2">
        <MinusCircle weight="bold" className="text-ink-3" aria-hidden />
        Not testable
      </span>
    );
  return v ? (
    <span className="inline-flex items-center gap-1.5 text-good-ink">
      <CheckCircle weight="fill" className="text-good" aria-hidden />
      Yes
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-critical-ink">
      <XCircle weight="fill" className="text-critical" aria-hidden />
      No
    </span>
  );
}

export function Overview() {
  const usdcSusd = DATA.report.verdict.find((v) => v.pair === 'USDC/sUSD');
  const sushi = DATA.pools.filter((p) => p.venue === 'sushi-v3');
  const sushiLpFees = sushi.reduce((a, p) => a + (p.fees.lpFeesUsd ?? 0), 0);
  const sushiTvl = sushi.reduce((a, p) => a + (p.tvlUsdAtCapture ?? 0), 0);
  const sushiTop = [...sushi].sort((a, b) => (b.fees.lpFeesUsd ?? 0) - (a.fees.lpFeesUsd ?? 0))[0];
  const aquaFees = DATA.aquariusHourly.rows.reduce((a, r) => a + r.grossFeesUsd, 0);
  const aquaVol = DATA.aquariusHourly.rows.reduce((a, r) => a + r.volumeUsd, 0);
  const swaps = DATA.pools.reduce((a, p) => a + p.swaps, 0);
  const run = DATA.testnet;
  const rebal = run?.steps.find((s) => s.id === 'rebalance');
  const refusals = run?.steps.filter((s) => s.outcome === 'refused') ?? [];
  const rp = reportProvenance();
  const sushiProv = {
    kind: 'recorded' as const,
    date: '2026-11-03',
    source: 'fixtures/sushi/',
    note: `${sushi.length} Sushi Stellar V3 pools that hold 99.99% of Sushi Stellar TVL, swaps 2026-10-04 to 2026-11-03 via StellarExpert, cross-checked against public RPC getEvents (4 of 4 pools match). LP fees = fees x (1 - protocol share 1/4).`,
  };

  return (
    <div className="flex flex-col gap-10">
      <ProjectHero
        code="CLP"
        name="CL LP Manager"
        family="Markets and liquidity data"
        lede="Does a concentrated-liquidity range strategy on Stellar beat passive LP after costs? Measured on recorded mainnet swaps."
        gates={
          <>
            <GateBadge kind="mainnet-read-only" />
            <GateBadge kind="testnet-only" />
            <GateBadge kind="unaudited" />
            <GateBadge kind="demo-only" />
          </>
        }
        actions={
          <>
            <a href={href('explore')} className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-accent px-3 text-sm font-medium text-ink-inverse inset-shadow-highlight transition-[filter,transform] duration-[120ms] ease-settle hover:brightness-110 active:translate-y-px">
              Run a backtest <ArrowRight aria-hidden />
            </a>
            <a href={href('vault')} className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-3 text-sm font-medium text-ink transition-colors duration-[120ms] ease-settle hover:bg-sunken active:translate-y-px">
              Testnet vault
            </a>
          </>
        }
        figure={{
          label: 'Best out-of-sample edge over passive LP (Aquarius USDC/sUSD, 10,000 sUSD)',
          value: usdcSusd?.wfExcessUsd ?? null,
          format: (n) => fmtSigned(n, 0),
          unit: 'sUSD in 15 days',
          missingReason: 'Not in the committed report.',
          footnote: `Rule: +/-0.25% range, rebalance after 1 h out of range, picked on days 1 to 15 and scored on days 16 to 30. In sample the same pool gave ${fmtSigned(usdcSusd?.bestExcessUsd ?? 0, 0)} sUSD over 30 days; the same width held static gave +209.59 in sample (the report has no out-of-sample score for the static range). Most other pools: under 10 USD a month.`,
          provenance: <ProvenanceChip {...rp} />,
        }}
      />

      <section aria-labelledby="ans-h" className="flex flex-col gap-4">
        <div className="max-w-prose">
          <h2 id="ans-h" className="text-xl font-semibold tracking-tight text-ink">
            The answer, pool by pool
          </h2>
          <p className="mt-1.5 text-base text-ink-2">
            Best eligible range and rule against passive full-range LP, after the pool fee, 5 bps slippage and a fixed cost per rebalance. Out of sample means the choice was made on the first half of the window and scored on the second.
          </p>
        </div>
        <DataTable
          caption={`Grid of 9 widths x 4 rules per pool, $${DATA.report.capitalUsd.toLocaleString('en-US')} per position`}
          meta={<ProvenanceChip {...rp} />}
          rows={DATA.report.verdict}
          rowKey={(v) => v.pool}
          onRowClick={(v) => (window.location.hash = href('explore', { pool: v.pool }))}
          columns={[
            {
              key: 'pair',
              header: 'Pool',
              sortValue: (v) => v.pair,
              cell: (v) => (
                <span className="flex flex-col">
                  <span className="font-medium text-ink">{v.pair}</span>
                  <span className="text-xs text-ink-3">{VENUE[v.venue] ?? v.venue}</span>
                </span>
              ),
            },
            {
              key: 'win',
              header: 'Window',
              numeric: true,
              sortValue: (v) => DATA.pools.find((x) => x.pool === v.pool)?.days ?? 0,
              cell: (v) => {
                const d = DATA.pools.find((x) => x.pool === v.pool)?.days;
                return d === undefined ? <UnknownValue reason="Pool not in the captured set." label="Unknown" /> : <span className={d < 30 ? 'font-medium text-warning-ink' : undefined}>{d} days</span>;
              },
            },
            { key: 'beats', header: 'In sample', cell: (v) => <Answer v={v.bestLabel === null ? null : v.beatsPassive} /> },
            {
              key: 'ex',
              header: 'Excess, full window',
              numeric: true,
              sortValue: (v) => v.bestExcessUsd ?? -Infinity,
              cell: (v) => (v.bestExcessUsd === null ? <UnknownValue reason="No configuration stayed under 20% of active liquidity, or too few swaps." label="None eligible" /> : `${fmtSigned(v.bestExcessUsd, 2)} ${unitOf(v)}`),
            },
            { key: 'best', header: 'Best configuration', cell: (v) => configWords(v.bestLabel), hideOnMobile: true },
            { key: 'wf', header: 'Out of sample', cell: (v) => <Answer v={v.walkForwardBeats} /> },
            {
              key: 'wfx',
              header: 'Excess, second half',
              numeric: true,
              sortValue: (v) => v.wfExcessUsd ?? -Infinity,
              cell: (v) => (v.wfExcessUsd === null ? <UnknownValue reason="Walk-forward needs at least 10 swaps in each half and an eligible pick." label="Not testable" /> : `${fmtSigned(v.wfExcessUsd, 2)} ${unitOf(v)}`),
            },
          ]}
        />
        <p className="max-w-prose text-sm text-ink-2">
          Reading: where a range wins, the gain comes from concentration, not from rebalancing. On Sushi XLM/USDC every configuration lost to passive while XLM fell. The project's own call is to keep the backtester and not run an active manager as a business on these numbers (README, Results).
        </p>
      </section>

      <section aria-labelledby="m-h" className="flex flex-col gap-4 border-t border-line pt-8">
        <h2 id="m-h" className="text-xl font-semibold tracking-tight text-ink">
          What was measured
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Sushi Stellar LP fees, 30 days"
            value={fmtUsd(sushiLpFees)}
            footnote={`On ${fmtUsd(sushiTvl)} of TVL in the ${sushi.length} largest pools. ${sushiTop?.pair} ${fmt((sushiTop?.feePpm ?? 0) / 10_000, 2)}% earned ${fmtUsd(sushiTop?.fees.lpFeesUsd ?? 0)} of it.`}
            provenance={sushiProv}
          />
          <StatTile
            label="Aquarius concentrated pools, gross fees, 30 days"
            value={fmtUsd(aquaFees)}
            footnote={`${DATA.aquariusHourly.rows.length} pools, ${fmtUsd(aquaVol)} of volume. Before the Aquarius protocol share, which is not yet measured (CLP-007).`}
            provenance={hourlyProvenance()}
          />
          <StatTile
            label="Swaps replayed"
            value={swaps.toLocaleString('en-US')}
            footnote={`${DATA.pools.length} pools, 7 to 30 days each, every swap with its post-trade price and active liquidity.`}
            provenance={{ kind: 'recorded', date: '2026-11-04', source: 'fixtures/', note: 'fixtures/{sushi,aquarius}/*.history.json. Captured 2026-11-03 to 2026-11-04 by scripts/capture-*.ts (read-only, throttled).' }}
          />
          {run && rebal?.tx ? (
            <StatTile
              label="Vault guard on testnet"
              value={`${refusals.length} refusals, 1 rebalance`}
              footnote={`In range, stale oracle, oracle/pool deviation and cooldown were refused; the rebalance landed at ledger ${rebal.tx.ledger.toLocaleString('en-US')}.`}
              provenance={testnetProvenance(run, rebal.tx.ledger)}
            />
          ) : (
            <StatTile label="Vault guard on testnet" missing={{ kind: 'unavailable', reason: 'No testnet run is recorded in this build (fixtures/testnet/vault-run.json is missing).' }} />
          )}
        </div>
      </section>
    </div>
  );
}

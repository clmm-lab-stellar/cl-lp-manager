// SPDX-License-Identifier: Apache-2.0
// Fee volume: the measured unknown that decides whether any LP strategy is worth running.
import { DATA, VENUE, fmt, fmtPct, fmtUsd, hourlyProvenance, poolProvenance } from '../lib/data';
import { href } from '../lib/route';
import { ChartFrame, DataTable, PageHeader, ProvenanceChip, RankedBars, UnknownValue } from '../ui/kit';

export function Fees() {
  const pools = [...DATA.pools].sort((a, b) => (b.fees.lpFeesUsd ?? -1) - (a.fees.lpFeesUsd ?? -1));
  const hp = hourlyProvenance();
  const hourly = [...DATA.aquariusHourly.rows].sort((a, b) => b.grossFeesUsd - a.grossFeesUsd);
  const top = hourly.slice(0, 10);
  const capProv = {
    kind: 'recorded' as const,
    date: '2026-11-04',
    source: 'fixtures/',
    note: 'fixtures/{sushi,aquarius}/*.history.json. Fee stats computed by src/backtest/fees.ts over each committed swap capture: volume = sum of input value at each swap price; LP fees = volume x fee x (1 - protocol share); APR = LP fees / TVL at capture, annualised.',
  };
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Fee volume"
        lede="Fees are what an LP is paid. Measured per pool from recorded swaps, before any strategy."
        meta={
          <>
            <ProvenanceChip {...capProv} />
            <ProvenanceChip {...hp} />
          </>
        }
      />

      <DataTable
        caption="Captured pools: swaps, volume and LP fees over the capture window"
        meta={<ProvenanceChip {...capProv} />}
        rows={pools}
        rowKey={(p) => p.pool}
        onRowClick={(p) => (window.location.hash = href('explore', { pool: p.pool }))}
        initialSort={{ key: 'lp', dir: 'desc' }}
        columns={[
          { key: 'pair', header: 'Pool', cell: (p) => <span className="font-medium text-ink">{p.pair}</span>, sortValue: (p) => p.pair },
          { key: 'venue', header: 'Venue', cell: (p) => `${VENUE[p.venue]} ${fmt(p.feePpm / 10_000, 2)}%`, hideOnMobile: true },
          { key: 'days', header: 'Days', numeric: true, cell: (p) => p.days, sortValue: (p) => p.days, hideOnMobile: true },
          { key: 'swaps', header: 'Swaps', numeric: true, cell: (p) => p.swaps.toLocaleString('en-US'), sortValue: (p) => p.swaps },
          {
            key: 'vol',
            header: 'Volume',
            numeric: true,
            sortValue: (p) => p.fees.volumeUsd ?? p.fees.volumeToken1,
            cell: (p) => (p.fees.volumeUsd === null ? `${fmt(p.fees.volumeToken1, 0)} ${p.token1.symbol}` : fmtUsd(p.fees.volumeUsd)),
          },
          {
            key: 'lp',
            header: 'LP fees',
            numeric: true,
            sortValue: (p) => p.fees.lpFeesUsd ?? -1,
            cell: (p) =>
              p.fees.lpFeesUsd === null ? (
                <span>
                  {fmt(p.fees.volumeToken1 * (p.feePpm / 1e6) * (1 - p.protocolFeeShare), 0)} {p.token1.symbol}
                </span>
              ) : (
                fmtUsd(p.fees.lpFeesUsd)
              ),
          },
          {
            key: 'apr',
            header: 'Pool fee APR',
            numeric: true,
            sortValue: (p) => p.fees.poolFeeApr ?? -1,
            cell: (p) => (p.fees.poolFeeApr === null ? <UnknownValue reason={`${p.token1.symbol} has no USD price in the capture, so TVL in USD is unknown.`} /> : fmtPct(p.fees.poolFeeApr, p.fees.poolFeeApr < 0.001 ? 4 : 2)),
          },
          { key: 'prov', header: 'Capture', cell: (p) => <ProvenanceChip {...poolProvenance(p)} />, hideOnMobile: true },
        ]}
        footer={
          <span className="text-xs text-ink-3">
            Aquarius rows assume no protocol share (its size is unknown, CLP-007), so they overstate LP fees by that share. Sushi rows deduct 1/4 read from the pool contract.
          </span>
        }
      />

      <ChartFrame
        title="Aquarius concentrated pools: gross fees in 30 days"
        subtitle={`USD, top 10 of ${hourly.length} pools by gross fees, from hourly pool statistics`}
        provenance={<ProvenanceChip {...hp} />}
        table={
          <DataTable
            dense
            maxHeight={420}
            rows={hourly}
            rowKey={(r) => r.pool}
            initialSort={{ key: 'f', dir: 'desc' }}
            columns={[
              { key: 'p', header: 'Pool', cell: (r) => r.pair, sortValue: (r) => r.pair },
              { key: 'fee', header: 'Fee', numeric: true, cell: (r) => fmtPct(r.fee, 2) },
              { key: 'v', header: 'Volume', numeric: true, cell: (r) => fmtUsd(r.volumeUsd), sortValue: (r) => r.volumeUsd },
              { key: 'f', header: 'Gross fees', numeric: true, cell: (r) => fmtUsd(r.grossFeesUsd), sortValue: (r) => r.grossFeesUsd },
              { key: 'l', header: 'Liquidity', numeric: true, cell: (r) => fmtUsd(r.liquidityUsd), sortValue: (r) => r.liquidityUsd },
              {
                key: 'a',
                header: 'Gross fee APR',
                numeric: true,
                sortValue: (r) => r.grossFeeApr ?? -1,
                cell: (r) => (r.grossFeeApr === null ? <UnknownValue reason="Pool reported zero liquidity." /> : fmtPct(r.grossFeeApr, 1)),
              },
            ]}
          />
        }
      >
        <RankedBars
          bars={top.map((r) => ({ key: r.pool, label: `${r.pair} ${fmtPct(r.fee, 2)}`, value: r.grossFeesUsd, text: `${r.pair} ${fmtPct(r.fee, 2)}` }))}
          unit="USD"
          format={(n) => fmtUsd(n)}
          labelWidth="12rem"
        />
      </ChartFrame>
    </div>
  );
}

// SPDX-License-Identifier: Apache-2.0
// Backtest explorer: the committed swap history of one pool, replayed in the browser by the same
// engine the CLI and tests use (../../../src/backtest). Inputs: pool, capital, range width,
// rebalance rule, costs. Every figure is computed from the recorded mainnet capture shown in the
// provenance chips; nothing is fetched from mainnet here.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowsClockwise, Warning } from '@phosphor-icons/react';
import { backtest, type CostModel, type RebalanceRule, type StrategyConfig } from '../../../src/backtest/engine.ts';
import { DEFAULT_RULES, DEFAULT_WIDTHS, MAX_POOL_SHARE, gridReport, ruleLabel, type GridReport } from '../../../src/backtest/grid.ts';
import { fromFile, type PoolHistory } from '../../../src/types.ts';
import { DATA, VENUE, fmt, fmtPct, fmtSigned, loadHistoryFile, poolByAddress, poolProvenance, ruleWords, widthLabel, type PoolMeta } from '../lib/data';
import { ChartFrame, DataTable, EmptyState, PageHeader, ProvenanceChip, Skeleton, StatTile, cn } from '../ui/kit';
import { Legend, LineChart, type Series } from '../charts/LineChart';

const DEFAULT_POOL = 'CBV6LZABOAJRXHLIEKILTWBPC2AXLYVR4CGGPKZQ3PWJ5QFTPIWSWGWQ'; // Aquarius USDC/sUSD
const CAPITALS = [1_000, 10_000, 100_000, 1_000_000];

function ruleKey(r: RebalanceRule): string {
  return ruleLabel(r);
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function Explorer({ initialPool }: { initialPool: string | null }) {
  const [poolId, setPoolId] = useState(() => (initialPool && poolByAddress(initialPool) ? initialPool : DEFAULT_POOL));
  const meta = poolByAddress(poolId)!;
  const [capital, setCapital] = useState(10_000);
  const [width, setWidth] = useState(0.0025);
  const [rule, setRule] = useState('oor+3600s');
  const [slippageBps, setSlippageBps] = useState(5);
  const [fixed, setFixed] = useState(0.05);
  const [history, setHistory] = useState<{ pool: string; h: PoolHistory } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    loadHistoryFile(meta)
      .then((f) => live && setHistory({ pool: meta.pool, h: fromFile(f) }))
      .catch((e: unknown) => live && setError(String((e as Error).message ?? e)));
    const q = new URLSearchParams({ pool: meta.pool }).toString();
    window.history.replaceState(null, '', `#/explore?${q}`);
    return () => {
      live = false;
    };
  }, [meta]);

  const ready = history && history.pool === meta.pool ? history.h : null;
  const t1 = meta.token1.symbol;
  const usd = meta.token1UsdAtCapture;
  const capitalT1 = usd ? capital / usd : capital;
  const costs: CostModel = useMemo(() => ({ slippage: slippageBps / 10_000, fixedPerRebalance: fixed, swapFeeMultiplier: 1 }), [slippageBps, fixed]);
  const ruleObj = DEFAULT_RULES.find((r) => ruleKey(r) === rule) ?? DEFAULT_RULES[0]!;

  const run = useMemo(() => {
    if (!ready) return null;
    const span = ready.window.toTs - ready.window.fromTs;
    const every = Math.max(60, Math.floor(span / 360));
    const cfg: StrategyConfig = { width, rule: ruleObj };
    const res = backtest(ready, cfg, capitalT1, costs, { traceEverySec: every });
    const passive = backtest(ready, { width: 'full', rule: { kind: 'none' } }, capitalT1, costs, { traceEverySec: every });
    return { res, passive };
  }, [ready, width, ruleObj, capitalT1, costs]);

  const grid: GridReport | null = useMemo(() => (ready ? gridReport(ready, capitalT1, DEFAULT_WIDTHS, DEFAULT_RULES, costs) : null), [ready, capitalT1, costs]);

  const prov = poolProvenance(meta, `Strategy computed in this browser from that capture with the project's backtest engine.`);
  const pools = [...DATA.pools].sort((a, b) => (a.venue === b.venue ? a.pair.localeCompare(b.pair) : a.venue.localeCompare(b.venue)));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Backtest explorer"
        lede="Replay a recorded pool, swap by swap, and compare a range strategy with passive full-range LP and holding."
        meta={<ProvenanceChip {...prov} />}
      />

      <section aria-label="Strategy inputs" className="grid grid-cols-1 gap-4 rounded-md border border-line bg-surface p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-[2fr_1fr_1fr_1.4fr_0.8fr_0.8fr]">
        <Field label="Pool" hint={`${VENUE[meta.venue]}, fee ${fmt(meta.feePpm / 10_000, 2)}%, ${meta.days} days, ${meta.swaps.toLocaleString('en-US')} swaps`}>
          <select className="field" value={poolId} onChange={(e) => setPoolId(e.target.value)}>
            {pools.map((p) => (
              <option key={p.pool} value={p.pool}>
                {p.pair} ({p.venue === 'sushi-v3' ? 'Sushi' : 'Aquarius'} {fmt(p.feePpm / 10_000, 2)}%)
              </option>
            ))}
          </select>
        </Field>
        <Field label={usd ? 'Capital (USD)' : `Capital (${t1})`} hint={usd ? `= ${fmt(capitalT1, 0)} ${t1} at capture` : `${t1} has no USD price in the capture`}>
          <select className="field" value={capital} onChange={(e) => setCapital(Number(e.target.value))}>
            {CAPITALS.map((c) => (
              <option key={c} value={c}>
                {c.toLocaleString('en-US')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Range half-width">
          <select className="field" value={width} onChange={(e) => setWidth(Number(e.target.value))}>
            {DEFAULT_WIDTHS.map((w) => (
              <option key={w} value={w}>
                {widthLabel(w)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Rebalance rule">
          <select className="field" value={rule} onChange={(e) => setRule(e.target.value)}>
            {DEFAULT_RULES.map((r) => (
              <option key={ruleKey(r)} value={ruleKey(r)}>
                {ruleWords(ruleKey(r))}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Slippage (bps)">
          <input className="field" type="number" min={0} max={200} step={1} value={slippageBps} onChange={(e) => setSlippageBps(Math.max(0, Number(e.target.value) || 0))} />
        </Field>
        <Field label={`Fixed cost (${t1})`}>
          <input className="field" type="number" min={0} step={0.01} value={fixed} onChange={(e) => setFixed(Math.max(0, Number(e.target.value) || 0))} />
        </Field>
      </section>

      {error && (
        <EmptyState tone="error" title="The recorded capture did not load" detail={error}>
          The pool file is served from data/pools in this build. Nothing was computed for this pool.
        </EmptyState>
      )}
      {!error && !run && <ExplorerSkeleton />}
      {run && grid && ready && <Results meta={meta} h={ready} run={run} grid={grid} width={width} rule={rule} capitalT1={capitalT1} costs={costs} onPick={(w, r) => (setWidth(w), setRule(r))} />}
    </div>
  );
}

function ExplorerSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Loading the recorded capture">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="rounded-md border border-line bg-surface p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-32" />
        </div>
      ))}
      <div className="rounded-md border border-line bg-surface p-4 md:col-span-2 xl:col-span-4">
        <Skeleton className="h-56 w-full" />
      </div>
    </div>
  );
}

interface ResultsProps {
  meta: PoolMeta;
  h: PoolHistory;
  run: { res: ReturnType<typeof backtest>; passive: ReturnType<typeof backtest> };
  grid: GridReport;
  width: number;
  rule: string;
  capitalT1: number;
  costs: CostModel;
  onPick: (w: number, r: string) => void;
}

function Results({ meta, h, run, grid, width, rule, capitalT1, onPick }: ResultsProps) {
  const { res, passive } = run;
  const t1 = meta.token1.symbol;
  const prov = poolProvenance(meta, 'Strategy computed in this browser from that capture.');
  const excess = res.finalValue - passive.finalValue;
  const days = res.years * 365;
  const tooBig = res.avgPoolShare > MAX_POOL_SHARE;
  const dec = capitalT1 >= 100_000 ? 0 : 2;
  const f = (n: number) => fmt(n, dec);

  const series: Series[] = [
    { key: 's', label: 'Strategy', color: 'var(--sik-viz-1)', points: res.trace!.map((p) => [p.ts, p.value]) },
    { key: 'p', label: 'Passive LP', color: 'var(--sik-viz-2)', points: passive.trace!.map((p) => [p.ts, p.value]) },
    { key: 'h', label: 'Hold', color: 'var(--sik-viz-3)', dashed: true, points: res.trace!.map((p) => [p.ts, p.hodl]) },
  ];
  // Rebalance markers: points where the range changed.
  const markers: { ts: number; label: string }[] = [];
  const tr = res.trace!;
  for (let i = 1; i < tr.length; i++) if (tr[i]!.lower !== tr[i - 1]!.lower) markers.push({ ts: tr[i]!.ts, label: 'rebalance' });
  const priceDec = tr[0] && tr[0].price < 10 ? 4 : 2;
  const pf = (n: number) => fmt(n, priceDec);

  const tableRows = tr.map((p, i) => ({ ...p, passive: passive.trace![i]?.value ?? null, i }));

  return (
    <>
      {tooBig && (
        <div role="note" className="flex items-start gap-2.5 rounded-md border border-warning-ring bg-warning-wash p-4 text-sm text-warning-ink">
          <Warning weight="fill" className="mt-0.5 shrink-0 text-warning" aria-hidden />
          <p>
            Warning: this position averages {fmtPct(res.avgPoolShare, 1)} of the pool's active liquidity, above the {fmtPct(MAX_POOL_SHARE, 0)} limit where the price-taker model holds. Treat the fee income as an upper bound.
          </p>
        </div>
      )}

      <section aria-label="Result" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatTile
          hero
          className="md:col-span-2"
          label={`Strategy vs passive full-range LP, ${fmt(days, 1)} days`}
          value={fmtSigned(excess, dec)}
          unit={t1}
          footnote={`${widthLabel(width)}, ${ruleWords(rule)}. Final ${f(res.finalValue)} vs passive ${f(passive.finalValue)} vs hold ${f(res.hodlValue)} ${t1}, from ${f(capitalT1)}.`}
          provenance={prov}
        />
        <StatTile label="Fee income" value={f(res.feeIncome)} unit={t1} footnote={`${fmtPct(res.feeApr)} fee APR. Passive LP earned ${f(passive.feeIncome)}.`} provenance={prov} />
        <StatTile label="Time in range" value={fmtPct(res.timeInRange, 1)} footnote={`Average share of active liquidity ${fmtPct(res.avgPoolShare, 2)}.`} provenance={prov} />
      </section>

      <section aria-label="Where the value went" className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
        <ChartFrame
          title="Position value over time"
          subtitle={`${t1}, strategy and passive LP after costs, hold = the starting tokens kept`}
          provenance={<ProvenanceChip {...prov} />}
          legend={<Legend series={series} extra={markers.length ? [{ label: `rebalance (${res.rebalances})`, swatch: 'marker' }] : undefined} />}
          table={
            <DataTable
              dense
              maxHeight={320}
              rows={tableRows}
              rowKey={(r) => String(r.i)}
              columns={[
                { key: 't', header: 'Time (UTC)', cell: (r) => new Date(r.ts * 1000).toISOString().slice(0, 16).replace('T', ' '), mono: true },
                { key: 's', header: 'Strategy', numeric: true, cell: (r) => f(r.value) },
                { key: 'p', header: 'Passive LP', numeric: true, cell: (r) => (r.passive === null ? '' : f(r.passive)) },
                { key: 'h', header: 'Hold', numeric: true, cell: (r) => f(r.hodl) },
              ]}
            />
          }
        >
          <LineChart series={series} markers={markers} format={f} axisFormat={(n) => fmt(n, 0)} unit={t1} ariaLabel={`Value of the strategy, passive LP and hold over ${fmt(days, 1)} days`} />
        </ChartFrame>

        <div className="rounded-md border border-line bg-surface">
          <h3 className="px-4 pt-4 text-sm font-semibold text-ink sm:px-5">Breakdown vs holding the starting tokens</h3>
          <p className="px-4 text-xs text-ink-3 sm:px-5">{t1}. Final value = hold + fees + impermanent loss − rebalance costs (fees are not compounded between rebalances).</p>
          <dl className="mt-3 divide-y divide-line border-t border-line text-sm">
            {(
              [
                ['Hold (start tokens at end price)', res.hodlValue, null],
                ['Fee income', res.feeIncome, `${fmtPct(res.feeApr)} APR`],
                ['Impermanent loss', res.impermanentLoss, null],
                ['Rebalance costs', -res.rebalanceCost, `${res.rebalances} rebalance${res.rebalances === 1 ? '' : 's'}`],
                ['Final value', res.finalValue, null],
                ['Loss vs rebalancing (LVR, for reference)', -res.lvr, 'not added above'],
              ] as const
            ).map(([k, v, note], i) => (
              <div key={k} className={cn('flex items-baseline justify-between gap-4 px-4 py-2.5 sm:px-5', i === 4 && 'bg-sunken font-medium')}>
                <dt className="text-ink-2">
                  {k}
                  {note && <span className="ml-1.5 text-xs text-ink-3">{note}</span>}
                </dt>
                <dd className="text-ink tabular">{i === 0 || i === 4 ? f(v) : fmtSigned(v, dec)}</dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-line px-4 py-2.5 sm:px-5">
            <ProvenanceChip {...prov} />
          </div>
        </div>
      </section>

      <ChartFrame
        title="Pool price and the strategy's range"
        subtitle={`${meta.token1.symbol} per ${meta.token0.symbol}, shaded band = active range${res.rebalances ? ', dashed lines = rebalances' : ''}`}
        provenance={<ProvenanceChip {...prov} />}
        legend={<Legend series={[{ key: 'pr', label: 'Pool price after swap', color: 'var(--sik-viz-1)' }]} extra={[{ label: 'Range', swatch: 'band' }]} />}
        table={
          <DataTable
            dense
            maxHeight={320}
            rows={tableRows}
            rowKey={(r) => String(r.i)}
            columns={[
              { key: 't', header: 'Time (UTC)', cell: (r) => new Date(r.ts * 1000).toISOString().slice(0, 16).replace('T', ' '), mono: true },
              { key: 'p', header: 'Price', numeric: true, cell: (r) => pf(r.price) },
              { key: 'l', header: 'Range low', numeric: true, cell: (r) => (r.lower === null ? 'full' : pf(r.lower)) },
              { key: 'u', header: 'Range high', numeric: true, cell: (r) => (r.upper === null ? 'full' : pf(r.upper)) },
            ]}
          />
        }
      >
        <LineChart
          series={[{ key: 'pr', label: 'Price', color: 'var(--sik-viz-1)', points: tr.map((p) => [p.ts, p.price]) }]}
          band={{ label: 'Range', points: tr.map((p) => [p.ts, p.lower, p.upper]) }}
          markers={markers}
          format={pf}
          unit={t1}
          height={220}
          ariaLabel="Pool price with the strategy range over time"
        />
      </ChartFrame>

      <GridTable grid={grid} t1={t1} width={width} rule={rule} onPick={onPick} dec={dec} prov={prov} h={h} />
    </>
  );
}

function GridTable({
  grid,
  t1,
  width,
  rule,
  onPick,
  dec,
  prov,
}: {
  grid: GridReport;
  t1: string;
  width: number;
  rule: string;
  onPick: (w: number, r: string) => void;
  dec: number;
  prov: ReturnType<typeof poolProvenance>;
  h: PoolHistory;
}) {
  const rules = DEFAULT_RULES.map(ruleKey);
  const maxAbs = Math.max(1e-9, ...grid.rows.filter((r) => r.avgPoolShare <= MAX_POOL_SHARE).map((r) => Math.abs(r.excessVsPassive)));
  const cell = (w: number, r: string) => grid.rows.find((x) => x.config.width === w && ruleKey(x.config.rule) === r)!;
  const wf = grid.walkForward;
  return (
    <section aria-labelledby="grid-h" className="rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5">
        <div className="max-w-prose">
          <h3 id="grid-h" className="text-sm font-semibold text-ink">
            Every width and rule vs passive LP
          </h3>
          <p className="mt-0.5 text-xs text-ink-3">
            Final value minus passive full-range LP, {t1}, same capital and costs. Blue cells beat passive, orange cells lost to it. Struck-through cells exceed {fmtPct(MAX_POOL_SHARE, 0)} of active liquidity and are not eligible. Select a cell to load it.
          </p>
        </div>
      </div>
      <div className="relative mt-3 overflow-x-auto px-4 pb-4 sm:px-5">
        <table className="w-full min-w-[620px] border-separate border-spacing-[2px] text-sm">
          <thead>
            <tr>
              <th scope="col" className="px-2 py-1.5 text-left text-xs font-medium text-ink-2">
                Half-width
              </th>
              {rules.map((r) => (
                <th key={r} scope="col" className="px-2 py-1.5 text-right text-xs font-medium text-ink-2">
                  {ruleWords(r)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DEFAULT_WIDTHS.map((w) => (
              <tr key={w}>
                <th scope="row" className="px-2 py-1 text-left text-xs font-medium text-ink-2 tabular">
                  {widthLabel(w)}
                </th>
                {rules.map((r) => {
                  const c = cell(w, r);
                  const v = c.excessVsPassive;
                  const ineligible = c.avgPoolShare > MAX_POOL_SHARE;
                  const pct = ineligible ? 0 : Math.round(Math.min(Math.abs(v) / maxAbs, 1) * 42);
                  const bg = `color-mix(in oklab, ${v >= 0 ? 'var(--sik-viz-1)' : 'var(--sik-viz-2)'} ${pct}%, var(--sik-viz-diverge-mid))`;
                  const selected = w === width && r === rule;
                  const isBest = grid.best?.label === c.label;
                  return (
                    <td key={r} className="p-0">
                      <button
                        type="button"
                        onClick={() => onPick(w, r)}
                        aria-pressed={selected}
                        title={`${widthLabel(w)}, ${ruleWords(r)}: ${fmtSigned(v, dec)} ${t1} vs passive, ${c.rebalances} rebalances, ${fmtPct(c.avgPoolShare, 2)} of active liquidity${ineligible ? ' (not eligible)' : ''}`}
                        className={cn(
                          'w-full rounded-xs px-2 py-1.5 text-right text-ink tabular outline-offset-1 transition-[box-shadow] duration-[120ms] ease-settle',
                          selected && 'ring-2 ring-ink',
                          ineligible && 'text-ink-3 line-through',
                        )}
                        style={{ background: bg }}
                      >
                        {isBest && <span className="mr-1 text-xs font-medium text-ink-2">best</span>}
                        {fmtSigned(v, dec)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-line px-4 py-3 text-sm sm:px-5 md:grid-cols-2">
        <p className="text-ink-2">
          <span className="font-medium text-ink">In sample:</span>{' '}
          {grid.best ? (
            <>
              best eligible is {widthLabel(grid.best.config.width as number)}, {ruleWords(ruleKey(grid.best.config.rule))}:{' '}
              <span className="text-ink tabular">{fmtSigned(grid.best.excessVsPassive, dec)} {t1}</span> vs passive.
            </>
          ) : (
            'no configuration is eligible.'
          )}
        </p>
        <p className="text-ink-2">
          <span className="font-medium text-ink">Out of sample:</span>{' '}
          {wf.chosenOnFirstHalf !== null && wf.secondHalfExcessVsPassive !== null ? (
            <>
              picked on the first half ({wf.chosenOnFirstHalf.replace(/^w=/, '±')}), scored on the second:{' '}
              <span className="text-ink tabular">{fmtSigned(wf.secondHalfExcessVsPassive, dec)} {t1}</span>,{' '}
              {wf.secondHalfBeatsPassive ? 'beats passive.' : 'loses to passive.'}
            </>
          ) : (
            'not enough swaps in each half to test.'
          )}
        </p>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-4 py-2.5 sm:px-5">
        <ArrowsClockwise aria-hidden className="text-ink-3" />
        <ProvenanceChip {...prov} />
      </div>
    </section>
  );
}

// SPDX-License-Identifier: Apache-2.0
// Hand-built SVG line chart (DESIGN.md 7): 2px lines, one y-axis, recessive grid, direct labels at
// the line ends (required when categorical slot 3 is used in light mode), crosshair + tooltip on
// pointer and keyboard. Optional shaded band (the LP range) and event markers (rebalances).
// Series colours come from the validated kit palette slots 1-3 (checked 2026-11-08, all pairs).
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { utcTime } from '../lib/data';

export interface Series {
  key: string;
  label: string;
  /** CSS colour, e.g. var(--sik-viz-1). */
  color: string;
  dashed?: boolean;
  /** [unix seconds, value] */
  points: [number, number][];
}

export interface Band {
  label: string;
  /** [ts, lower, upper]; null bounds mean unbounded (not drawn). */
  points: [number, number | null, number | null][];
}

export interface LineChartProps {
  series: Series[];
  band?: Band;
  markers?: { ts: number; label: string }[];
  format: (n: number) => string;
  /** Axis tick format; defaults to `format`. */
  axisFormat?: (n: number) => string;
  unit: string;
  height?: number;
  ariaLabel: string;
}

const PAD = { top: 12, right: 92, bottom: 26, left: 64 };

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(v);
  return out;
}

/** Ticks at UTC midnights, every 1, 2, 3, 7 or 14 days, at most `max` of them. */
function dayTicks(x0: number, x1: number, max: number): number[] {
  const D = 86_400;
  const step = [1, 2, 3, 7, 14, 30].find((d) => (x1 - x0) / (d * D) <= max) ?? 30;
  const out: number[] = [];
  for (let t = Math.ceil(x0 / D) * D; t <= x1; t += step * D) out.push(t);
  return out;
}

export function LineChart({ series, band, markers = [], format, axisFormat, unit, height = 260, ariaLabel }: LineChartProps) {
  const id = useId();
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // Measure before first paint so a narrow phone never renders a wider-than-container SVG.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const xs = series[0]?.points.map((p) => p[0]) ?? [];
  const { x0, x1, y0, y1 } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) for (const [, v] of s.points) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
    if (band) for (const [, a, b] of band.points) for (const v of [a, b]) if (v !== null) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
    const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.01 || 1;
    return { x0: xs[0] ?? 0, x1: xs[xs.length - 1] ?? 1, y0: lo - pad, y1: hi + pad };
  }, [series, band, xs]);

  const iw = Math.max(width - PAD.left - PAD.right, 10);
  const ih = height - PAD.top - PAD.bottom;
  const sx = (t: number) => PAD.left + ((t - x0) / (x1 - x0 || 1)) * iw;
  const sy = (v: number) => PAD.top + (1 - (v - y0) / (y1 - y0 || 1)) * ih;
  const yTicks = niceTicks(y0, y1);
  const xTicks = dayTicks(x0, x1, Math.max(2, Math.floor(iw / 90)));
  const af = axisFormat ?? format;

  const path = (pts: [number, number][]) => pts.map(([t, v], i) => `${i ? 'L' : 'M'}${sx(t).toFixed(1)},${sy(v).toFixed(1)}`).join('');

  // Band as polygons over runs where both bounds exist.
  const bandPaths: string[] = [];
  if (band) {
    let run: [number, number, number][] = [];
    const flush = () => {
      if (run.length > 1) {
        const top = run.map(([t, , u], i) => `${i ? 'L' : 'M'}${sx(t).toFixed(1)},${sy(u).toFixed(1)}`).join('');
        const bot = [...run].reverse().map(([t, l]) => `L${sx(t).toFixed(1)},${sy(l).toFixed(1)}`).join('');
        bandPaths.push(`${top}${bot}Z`);
      }
      run = [];
    };
    for (const [t, l, u] of band.points) {
      if (l === null || u === null) flush();
      else run.push([t, Math.max(l, y0), Math.min(u, y1)]);
    }
    flush();
  }

  // Direct end labels, nudged apart vertically.
  const ends = series
    .map((s) => ({ s, y: sy(s.points[s.points.length - 1]?.[1] ?? 0) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i]!.y - ends[i - 1]!.y < 14) ends[i]!.y = ends[i - 1]!.y + 14;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || xs.length === 0) return;
    const t = x0 + ((e.clientX - r.left - PAD.left) / iw) * (x1 - x0);
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i]! - t) < Math.abs(xs[best]! - t)) best = i;
    setHover(best);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight') setHover((h) => Math.min((h ?? -1) + 1, xs.length - 1));
    else if (e.key === 'ArrowLeft') setHover((h) => Math.max((h ?? xs.length) - 1, 0));
    else if (e.key === 'Escape') setHover(null);
    else return;
    e.preventDefault();
  };

  const hx = hover !== null ? xs[hover] : undefined;
  const tipLeft = hx !== undefined ? Math.min(Math.max(sx(hx) + 12, 0), width - 230) : 0;

  return (
    <div className="relative w-full" ref={box}>
      <svg
        ref={ref}
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        aria-describedby={`${id}-d`}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
        style={{ maxWidth: '100%' }}
        className="block touch-pan-y rounded-xs outline-offset-2"
      >
        <desc id={`${id}-d`}>Use left and right arrow keys to read values over time.</desc>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={PAD.left + iw} y1={sy(v)} y2={sy(v)} stroke="var(--sik-viz-grid)" strokeWidth={1} />
            <text x={PAD.left - 8} y={sy(v)} dy="0.32em" textAnchor="end" fontSize={12} fill="var(--sik-viz-label)" className="tabular">
              {af(v)}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={PAD.left + iw} y1={PAD.top + ih} y2={PAD.top + ih} stroke="var(--sik-viz-axis)" strokeWidth={1} />
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={height - 6} textAnchor="middle" fontSize={12} fill="var(--sik-viz-label)" className="tabular">
            {new Date(t * 1000).toISOString().slice(5, 10)}
          </text>
        ))}
        {bandPaths.map((d, i) => (
          <path key={i} d={d} fill="var(--sik-viz-1)" fillOpacity={0.12} stroke="none" />
        ))}
        {markers.map((m, i) => (
          <line key={`${m.ts}-${i}`} x1={sx(m.ts)} x2={sx(m.ts)} y1={PAD.top} y2={PAD.top + ih} stroke="var(--sik-viz-axis)" strokeWidth={1} strokeDasharray="2 3" />
        ))}
        {series.map((s) => (
          <path key={s.key} d={path(s.points)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '6 4' : undefined} />
        ))}
        {ends.map(({ s, y }) => (
          <text key={s.key} x={PAD.left + iw + 8} y={y} dy="0.32em" fontSize={12} fill="var(--sik-ink-2)">
            {s.label}
          </text>
        ))}
        {hx !== undefined && (
          <g pointerEvents="none">
            <line x1={sx(hx)} x2={sx(hx)} y1={PAD.top} y2={PAD.top + ih} stroke="var(--sik-ink-3)" strokeWidth={1} />
            {series.map((s) => {
              const v = s.points[hover!]?.[1];
              return v === undefined ? null : <circle key={s.key} cx={sx(hx)} cy={sy(v)} r={4} fill={s.color} stroke="var(--sik-surface)" strokeWidth={2} />;
            })}
          </g>
        )}
      </svg>
      {hx !== undefined && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-2 z-[var(--sik-z-popover)] w-[220px] rounded-sm border border-line bg-raised px-2.5 py-2 text-xs shadow-2"
          style={{ left: tipLeft }}
        >
          <div className="mb-1 text-ink-3 tabular">{utcTime(hx)}</div>
          {series.map((s) => {
            const v = s.points[hover!]?.[1];
            return (
              <div key={s.key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-ink-2">
                  <span aria-hidden className="inline-block h-0.5 w-3" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="font-medium text-ink tabular">{v === undefined ? '' : `${format(v)} ${unit}`}</span>
              </div>
            );
          })}
          {band && hover !== null && band.points[hover] && band.points[hover]![1] !== null && (
            <div className="mt-1 border-t border-line pt-1 text-ink-3 tabular">
              {band.label}: {format(band.points[hover]![1]!)} to {format(band.points[hover]![2]!)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Legend row above the plot (two or more series). */
export function Legend({ series, extra }: { series: Pick<Series, 'key' | 'label' | 'color' | 'dashed'>[]; extra?: { label: string; swatch: 'band' | 'marker' }[] }) {
  return (
    <ul role="list" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <line x1="1" x2="17" y1="3" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '4 3' : undefined} strokeLinecap="round" />
          </svg>
          {s.label}
        </li>
      ))}
      {extra?.map((e) => (
        <li key={e.label} className="flex items-center gap-1.5">
          {e.swatch === 'band' ? (
            <span aria-hidden className="inline-block h-2.5 w-4 rounded-[2px]" style={{ background: 'color-mix(in oklab, var(--sik-viz-1) 14%, transparent)' }} />
          ) : (
            <svg width="10" height="12" aria-hidden>
              <line x1="5" x2="5" y1="0" y2="12" stroke="var(--sik-viz-axis)" strokeDasharray="2 3" />
            </svg>
          )}
          {e.label}
        </li>
      ))}
    </ul>
  );
}

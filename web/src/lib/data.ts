// SPDX-License-Identifier: Apache-2.0
// Typed access to src/data/demo.json (built by scripts/build-data.ts from committed fixtures and
// reports) plus formatting and provenance helpers. Nothing here invents a number.
import raw from '../data/demo.json';
import type { Provenance } from '../ui/kit';
import type { PoolHistoryFile } from '../../../src/types.ts';

export interface PoolMeta {
  pool: string;
  venue: 'sushi-v3' | 'aquarius-cl';
  pair: string;
  token0: { address: string; symbol: string; decimals: number };
  token1: { address: string; symbol: string; decimals: number };
  feePpm: number;
  protocolFeeShare: number;
  window: { fromTs: number; toTs: number; fromLedger: number; toLedger: number };
  days: number;
  swaps: number;
  firstLedger: number | null;
  lastLedger: number | null;
  token1UsdAtCapture: number | null;
  tvlUsdAtCapture: number | null;
  fees: { volumeToken1: number; volumeUsd: number | null; totalFeesUsd: number | null; lpFeesUsd: number | null; poolFeeApr: number | null };
  provenance: { capturedAt: string; script: string; sources: string[]; notes: string[]; file: string };
  dataUrl: string;
}

export interface Verdict {
  pool: string;
  pair: string;
  venue: string;
  beatsPassive: boolean;
  walkForwardBeats: boolean | null;
  bestLabel: string | null;
  bestExcessUsd: number | null;
  wfExcessUsd: number | null;
}

export interface TestnetStep {
  n: number;
  id: string;
  title: string;
  actor: 'admin' | 'keeper' | 'user';
  call: string;
  outcome: 'success' | 'refused';
  error?: string;
  expected: string;
  tx?: { hash: string; ledger: number; url: string; feeCharged?: string };
  simulatedAtLedger?: number;
  result?: unknown;
  stateAfter?: { tickLower: number; tickUpper: number; liquidity: string; totalShares: string; lastRebalance: number; rebalances: number; paused: boolean };
  note?: string;
  at: string;
}

export interface TestnetRun {
  schema: string;
  network: string;
  rpc: string;
  explorer: string;
  startedAt: string;
  finishedAt: string;
  script: string;
  keys: string;
  honesty: string[];
  accounts: { admin: string; keeper: string; user: string };
  tokens: { token0: { code: string; contract: string }; token1: { code: string; contract: string } };
  contracts: { vault: string; pool: string; oracle: string };
  wasm: Record<string, { sha256: string; bytes: number }>;
  config: Record<string, unknown>;
  setup: { what: string; hash: string; ledger: number; url: string }[];
  marketMoves: { beforeStep: number; what: string; hash: string; ledger: number; url: string }[];
  steps: TestnetStep[];
}

export interface DemoData {
  pools: PoolMeta[];
  report: { generatedAt: string; capitalUsd: number; costs: { slippage: number; fixedPerRebalance: number; swapFeeMultiplier: number } | null; verdict: Verdict[] };
  report100k: { generatedAt: string; capitalUsd: number; verdict: Verdict[] };
  aquariusHourly: {
    capturedAt: string;
    script: string;
    source: string;
    rows: { pool: string; pair: string; fee: number; hours: number; volumeUsd: number; grossFeesUsd: number; liquidityUsd: number; grossFeeApr: number | null }[];
  };
  testnet: TestnetRun | null;
}

export const DATA = raw as unknown as DemoData;

export const VENUE: Record<string, string> = { 'sushi-v3': 'Sushi Stellar V3', 'aquarius-cl': 'Aquarius concentrated' };

export const poolByAddress = (a: string): PoolMeta | undefined => DATA.pools.find((p) => p.pool === a);

export const dateOf = (iso: string): string => iso.slice(0, 10);
export const utcDate = (ts: number): string => new Date(ts * 1000).toISOString().slice(0, 10);
export const utcTime = (ts: number): string => new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/** Provenance for anything computed from one pool's committed swap capture. */
export function poolProvenance(p: PoolMeta, extra?: string): Provenance {
  return {
    kind: 'recorded',
    ledger: p.window.toLedger,
    date: dateOf(p.provenance.capturedAt),
    source: p.provenance.file,
    note: `${p.swaps.toLocaleString('en-US')} swaps, ledgers ${p.window.fromLedger.toLocaleString('en-US')} to ${p.window.toLedger.toLocaleString('en-US')} (${utcDate(p.window.fromTs)} to ${utcDate(p.window.toTs)}). Captured by ${p.provenance.script}.${extra ? ` ${extra}` : ''}`,
  };
}

/** Provenance for the committed backtest report (reports/report.json). */
export function reportProvenance(which: 'report' | 'report100k' = 'report'): Provenance {
  const r = which === 'report' ? DATA.report : DATA.report100k;
  return {
    kind: 'recorded',
    date: dateOf(r.generatedAt),
    source: which === 'report' ? 'reports/report.json' : 'reports/capital-100k/report.json',
    note: `node src/cli.ts report over the committed mainnet captures (swaps 2026-10-04 to 2026-11-03), capital $${r.capitalUsd.toLocaleString('en-US')} per position. Generated ${r.generatedAt}.`,
  };
}

export function hourlyProvenance(): Provenance {
  return {
    kind: 'recorded',
    date: dateOf(DATA.aquariusHourly.capturedAt),
    source: 'reports/aquarius-hourly-fees.json',
    note: `${DATA.aquariusHourly.source}, captured by ${DATA.aquariusHourly.script} at ${DATA.aquariusHourly.capturedAt}. Gross fees: Aquarius protocol share not deducted (unknown, CLP-007).`,
  };
}

export function testnetProvenance(run: TestnetRun, ledger?: number): Provenance {
  return {
    kind: 'testnet',
    ...(ledger !== undefined ? { ledger } : {}),
    date: dateOf(run.finishedAt),
    source: 'fixtures/testnet/vault-run.json',
    note: `${run.script}, ${run.startedAt} to ${run.finishedAt}. ${run.keys}`,
  };
}

const nf = (d: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmt = (n: number, d = 2): string => nf(d).format(n);
export const fmtSigned = (n: number, d = 2): string => (n > 0 ? '+' : n < 0 ? '−' : '') + nf(d).format(Math.abs(n));
export const fmtPct = (x: number, d = 2): string => `${nf(d).format(x * 100)}%`;
/** Whole dollars, but cents below $10 so a real small value never reads as a placeholder $0. */
export const fmtUsd = (n: number, d?: number): string => `$${nf(d ?? (Math.abs(n) < 10 ? 2 : 0)).format(n)}`;
export const widthLabel = (w: number): string => `±${nf(w < 0.001 ? 3 : 2).format(w * 100)}%`;

/** Parse "w=0.25% oor+3600s" (grid labels in reports) into plain words. */
export function configWords(label: string | null): string {
  if (!label) return 'none eligible';
  const m = /^w=([0-9.]+)% (.+)$/.exec(label);
  if (!m) return label;
  return `±${m[1]}% range, ${ruleWords(m[2]!)}`;
}

export function ruleWords(r: string): string {
  if (r === 'none') return 'never rebalance';
  if (r === 'oor+0s') return 'rebalance as soon as out of range';
  const oor = /^oor\+(\d+)s$/.exec(r);
  if (oor) return `rebalance after ${Number(oor[1]) / 3600} h out of range`;
  const thr = /^thr([0-9.]+)$/.exec(r);
  if (thr) return `rebalance at ${Number(thr[1]) * 100}% of the half-width`;
  return r;
}

const historyCache = new Map<string, Promise<PoolHistoryFile>>();
export function loadHistoryFile(p: PoolMeta): Promise<PoolHistoryFile> {
  let h = historyCache.get(p.pool);
  if (!h) {
    h = fetch(p.dataUrl).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${p.dataUrl}`);
      return r.json() as Promise<PoolHistoryFile>;
    });
    historyCache.set(p.pool, h);
    h.catch(() => historyCache.delete(p.pool));
  }
  return h;
}

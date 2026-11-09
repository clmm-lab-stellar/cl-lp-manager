// SPDX-License-Identifier: Apache-2.0
// Aquarius hourly statistics (720 hourly rows per pool) summarised into realised volume and
// gross swap fees per pool. Gross = volume * fee tier; the LP/protocol split is unknown (CLP-007).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AQUA_USD_SCALE, type AquaHourStat, type AquaPool } from "../data/aquarius.ts";

export interface HourlyFeeRow {
  pool: string;
  pair: string;
  fee: number;
  hours: number;
  volumeUsd: number;
  grossFeesUsd: number;
  liquidityUsd: number;
  grossFeeApr: number | null;
  apiApy: number;
}

export function aquariusHourlyFees(dir: string): { capturedAt: string; rows: HourlyFeeRow[] } {
  const pools = JSON.parse(readFileSync(join(dir, "pools.json"), "utf8")) as { capturedAt: string; items: AquaPool[] };
  const rows: HourlyFeeRow[] = [];
  const files = new Set(readdirSync(dir));
  for (const p of pools.items) {
    const f = `${p.address}.hourly.json`;
    if (!files.has(f)) continue;
    const hs = (JSON.parse(readFileSync(join(dir, f), "utf8")) as { items: AquaHourStat[] }).items;
    const volumeUsd = hs.reduce((s, h) => s + Number(h.volume_usd) / AQUA_USD_SCALE, 0);
    const fee = Number(p.fee);
    const liquidityUsd = Number(hs[0]?.liquidity_usd ?? p.liquidity_usd) / AQUA_USD_SCALE;
    rows.push({
      pool: p.address,
      pair: p.tokens_str.map((t) => t.split(":")[0]).join("/"),
      fee,
      hours: hs.length,
      volumeUsd,
      grossFeesUsd: volumeUsd * fee,
      liquidityUsd,
      // the hourly endpoint covers the last 30 days (720 hourly slots; hours without trades are absent)
      grossFeeApr: liquidityUsd > 0 ? ((volumeUsd * fee) / liquidityUsd) * (365 / 30) : null,
      apiApy: Number(p.apy),
    });
  }
  rows.sort((a, b) => b.grossFeesUsd - a.grossFeesUsd);
  return { capturedAt: pools.capturedAt, rows };
}

export function hourlyTable(rows: HourlyFeeRow[]): string {
  const usd = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const out = [
    "| Pool | Pair | Fee | Hours with data | 30-day volume | Gross fees (30 d) | Liquidity now | Gross fee APR | API `apy` |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of rows)
    out.push(
      `| \`${r.pool.slice(0, 8)}…\` | ${r.pair} | ${(r.fee * 100).toFixed(2)}% | ${r.hours} | ${usd(r.volumeUsd)} | ${usd(r.grossFeesUsd)} | ${usd(r.liquidityUsd)} | ${r.grossFeeApr === null ? "n/a" : `${(r.grossFeeApr * 100).toFixed(1)}%`} | ${(r.apiApy * 100).toFixed(2)}% |`,
    );
  return out.join("\n");
}

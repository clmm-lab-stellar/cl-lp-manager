// SPDX-License-Identifier: Apache-2.0
// pnpm demo:data. Builds the demo surface's data from committed files only (no network):
//   ../fixtures/{sushi,aquarius}/*.history.json  -> public/data/pools/<pool>.json (verbatim copies)
//   pool metadata + fee stats (computed with ../src/backtest/fees.ts) + report verdicts +
//   Aquarius hourly fees + the recorded testnet run   -> src/data/demo.json
// Every block carries its own provenance (capture time, script, ledger range, sources).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { feeStats } from "../../src/backtest/fees.ts";
import { fromFile, type PoolHistoryFile } from "../../src/types.ts";

const web = new URL("..", import.meta.url).pathname;
const proj = join(web, "..");
const outPools = join(web, "public/data/pools");
const outJson = join(web, "src/data/demo.json");

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const sym = (s: string) => (s === "native" ? "XLM" : s);

rmSync(outPools, { recursive: true, force: true });
mkdirSync(outPools, { recursive: true });

interface ReportVerdict {
  pool: string;
  pair: string;
  venue: string;
  beatsPassive: boolean;
  walkForwardBeats: boolean | null;
  bestLabel: string | null;
  bestExcessUsd: number | null;
  wfExcessUsd: number | null;
}
interface Report {
  generatedAt: string;
  capitalUsd: number;
  verdict: ReportVerdict[];
  grids: { pool: string; costs: { slippage: number; fixedPerRebalance: number; swapFeeMultiplier: number } }[];
}

const pools = [];
for (const venueDir of ["aquarius", "sushi"]) {
  const dir = join(proj, "fixtures", venueDir);
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".history.json")).sort()) {
    const file = readJson<PoolHistoryFile>(join(dir, name));
    const h = fromFile(file);
    const fs = feeStats(h);
    copyFileSync(join(dir, name), join(outPools, `${h.pool}.json`));
    pools.push({
      pool: h.pool,
      venue: h.venue,
      pair: `${sym(h.token0.symbol)}/${sym(h.token1.symbol)}`,
      token0: { ...h.token0, symbol: sym(h.token0.symbol) },
      token1: { ...h.token1, symbol: sym(h.token1.symbol) },
      feePpm: h.feePpm,
      protocolFeeShare: h.protocolFeeShare,
      window: h.window,
      days: Math.round((h.window.toTs - h.window.fromTs) / 86400),
      swaps: h.swaps.length,
      firstLedger: h.swaps[0]?.ledger ?? null,
      lastLedger: h.swaps[h.swaps.length - 1]?.ledger ?? null,
      token1UsdAtCapture: h.token1UsdAtCapture,
      tvlUsdAtCapture: h.tvlUsdAtCapture,
      fees: {
        volumeToken1: fs.volumeToken1,
        volumeUsd: fs.volumeUsd,
        totalFeesUsd: fs.totalFeesUsd,
        lpFeesUsd: fs.lpFeesUsd,
        poolFeeApr: fs.poolFeeApr,
      },
      provenance: { ...h.provenance, file: `fixtures/${venueDir}/${name}` },
      dataUrl: `data/pools/${h.pool}.json`,
    });
  }
}

const report = readJson<Report>(join(proj, "reports/report.json"));
const report100k = readJson<Report>(join(proj, "reports/capital-100k/report.json"));
const hourly = readJson<{ capturedAt: string; rows: { pool: string; pair: string; fee: number; hours: number; volumeUsd: number; grossFeesUsd: number; liquidityUsd: number; grossFeeApr: number | null }[] }>(
  join(proj, "reports/aquarius-hourly-fees.json"),
);
const sushiPools = readJson<unknown>(join(proj, "fixtures/sushi/pools.provenance.json"));

const runPath = join(proj, "fixtures/testnet/vault-run.json");
const testnet = existsSync(runPath) ? readJson<Record<string, unknown>>(runPath) : null;

const fixVerdict = (v: ReportVerdict) => ({ ...v, pair: v.pair.split("/").map(sym).join("/") });

const demo = {
  schema: "clp.demo-data.v1",
  builtFrom: [
    "fixtures/{sushi,aquarius}/*.history.json",
    "reports/report.json",
    "reports/capital-100k/report.json",
    "reports/aquarius-hourly-fees.json",
    "fixtures/testnet/vault-run.json",
  ],
  pools,
  report: {
    generatedAt: report.generatedAt,
    capitalUsd: report.capitalUsd,
    costs: report.grids[0]?.costs ?? null,
    verdict: report.verdict.map(fixVerdict),
  },
  report100k: { generatedAt: report100k.generatedAt, capitalUsd: report100k.capitalUsd, verdict: report100k.verdict.map(fixVerdict) },
  aquariusHourly: {
    capturedAt: hourly.capturedAt,
    script: "scripts/capture-aquarius.ts",
    source: "https://amm-api.aqua.network/statistics/pool/{address}/ (hourly rows, 720 hours)",
    rows: hourly.rows.map((r) => ({ ...r, pair: r.pair.split("/").map(sym).join("/") })),
  },
  sushiPoolsProvenance: sushiPools,
  testnet,
};

writeFileSync(outJson, JSON.stringify(demo) + "\n");
process.stdout.write(`demo data: ${pools.length} pools, ${hourly.rows.length} hourly rows, testnet run ${testnet ? "present" : "absent"} -> ${outJson}\n`);

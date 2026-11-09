// SPDX-License-Identifier: Apache-2.0
// cl-lp CLI (SPEC.md section 4). Offline: reads PoolHistoryFile JSON captured by scripts/.
//   node src/cli.ts fees <history.json...> [--json out.json] [--md out.md]
//   node src/cli.ts backtest <history.json> [--capital-usd 10000] [--widths 0.001,0.01] [--rules none,oor,thr0.8]
//                            [--slippage 0.0005] [--fixed 0.05] [--json out.json] [--md out.md]
//   node src/cli.ts aqua-hourly [--dir fixtures] [--json f] [--md f]
//   node src/cli.ts report [--dir fixtures] [--top 6] [--capital-usd 10000] [--out out]
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { feeStats, type FeeStats } from "./backtest/fees.ts";
import { DEFAULT_RULES, DEFAULT_WIDTHS, gridReport, parseRule, type GridReport } from "./backtest/grid.ts";
import { DEFAULT_COSTS, type CostModel } from "./backtest/engine.ts";
import { feeTable, gridMarkdown } from "./report/markdown.ts";
import { aquariusHourlyFees, hourlyTable } from "./backtest/hourly.ts";
import { fromFile, type PoolHistory, type PoolHistoryFile } from "./types.ts";

export function loadHistory(path: string): PoolHistory {
  return fromFile(JSON.parse(readFileSync(path, "utf8")) as PoolHistoryFile);
}

function write(path: string | undefined, text: string): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function capitalToken1(h: PoolHistory, capitalUsd: number): number {
  return h.token1UsdAtCapture ? capitalUsd / h.token1UsdAtCapture : capitalUsd;
}

function costsFrom(v: Record<string, unknown>): CostModel {
  return {
    ...DEFAULT_COSTS,
    ...(v.slippage !== undefined ? { slippage: Number(v.slippage) } : {}),
    ...(v.fixed !== undefined ? { fixedPerRebalance: Number(v.fixed) } : {}),
  };
}

export function historyFiles(dir: string): string[] {
  const out: string[] = [];
  for (const venue of readdirSync(dir)) {
    let names: string[];
    try {
      names = readdirSync(join(dir, venue));
    } catch {
      continue;
    }
    for (const n of names) if (n.endsWith(".history.json")) out.push(join(dir, venue, n));
  }
  return out.sort();
}

export interface FullReport {
  schema: "clp.report.v1";
  generatedAt: string;
  capitalUsd: number;
  fees: FeeStats[];
  grids: GridReport[];
  verdict: { pool: string; pair: string; venue: string; beatsPassive: boolean; walkForwardBeats: boolean | null; bestLabel: string | null; bestExcessUsd: number | null; wfExcessUsd: number | null }[];
}

export function buildReport(files: string[], top: number, capitalUsd: number, costs: CostModel): FullReport {
  const hs = files.map(loadHistory);
  const fees = hs.map(feeStats).sort((a, b) => (b.lpFeesUsd ?? 0) - (a.lpFeesUsd ?? 0));
  const chosen = fees.filter((f) => f.swaps >= 20).slice(0, top).map((f) => hs.find((h) => h.pool === f.pool)!);
  const grids = chosen.map((h) => gridReport(h, capitalToken1(h, capitalUsd), DEFAULT_WIDTHS, DEFAULT_RULES, costs));
  const verdict = grids.map((g) => {
    const h = chosen.find((x) => x.pool === g.pool)!;
    const u = h.token1UsdAtCapture ?? 1;
    return {
      pool: g.pool,
      pair: g.pair,
      venue: g.venue,
      beatsPassive: g.beatsPassive,
      walkForwardBeats: g.walkForward.secondHalfBeatsPassive,
      bestLabel: g.best?.label ?? null,
      bestExcessUsd: g.best ? g.best.excessVsPassive * u : null,
      wfExcessUsd: g.walkForward.secondHalfExcessVsPassive === null ? null : g.walkForward.secondHalfExcessVsPassive * u,
    };
  });
  return { schema: "clp.report.v1", generatedAt: new Date().toISOString(), capitalUsd, fees, grids, verdict };
}

export function reportMarkdown(r: FullReport, hs: Map<string, PoolHistory>): string {
  const parts = [
    `# CL LP backtest report`,
    "",
    `Generated ${r.generatedAt} from captured fixtures. Capital per position $${r.capitalUsd}. Unaudited research output; see README for the model and its limits.`,
    "",
    "## Realised fees over the captured window",
    "",
    feeTable(r.fees),
    "",
    "## Verdict per pool (best grid config vs passive full-range LP, after costs)",
    "",
    "| Pool | Venue | Best config (in-sample) | Excess vs passive | Beats passive | Walk-forward excess | Walk-forward beats |",
    "|---|---|---|---|---|---|---|",
    ...r.verdict.map(
      (v) =>
        `| ${v.pair} | ${v.venue} | ${v.bestLabel ?? "n/a"} | ${v.bestExcessUsd === null ? "n/a" : `$${v.bestExcessUsd.toFixed(2)}`} | ${v.beatsPassive ? "yes" : "no"} | ${v.wfExcessUsd === null ? "n/a" : `$${v.wfExcessUsd.toFixed(2)}`} | ${v.walkForwardBeats === null ? "n/a" : v.walkForwardBeats ? "yes" : "no"} |`,
    ),
    "",
    "## Grids",
    "",
    ...r.grids.map((g) => gridMarkdown(g, hs.get(g.pool)?.token1UsdAtCapture ?? null) + "\n"),
  ];
  return parts.join("\n");
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      json: { type: "string" },
      md: { type: "string" },
      "capital-usd": { type: "string", default: "10000" },
      widths: { type: "string" },
      rules: { type: "string" },
      slippage: { type: "string" },
      fixed: { type: "string" },
      dir: { type: "string", default: "fixtures" },
      top: { type: "string", default: "6" },
      out: { type: "string", default: "out" },
    },
  });
  const costs = costsFrom(values);
  if (cmd === "fees") {
    const rows = positionals.map((p) => feeStats(loadHistory(p)));
    write(values.json, JSON.stringify(rows, null, 1));
    const md = feeTable(rows);
    write(values.md, md + "\n");
    process.stdout.write(md + "\n");
    return 0;
  }
  if (cmd === "aqua-hourly") {
    const r = aquariusHourlyFees(join(values.dir!, "aquarius"));
    write(values.json, JSON.stringify(r, null, 1));
    const md = hourlyTable(r.rows);
    write(values.md, md + "\n");
    process.stdout.write(md + "\n");
    return 0;
  }
  if (cmd === "backtest") {
    const file = positionals[0];
    if (!file) throw new Error("backtest needs a history file");
    const h = loadHistory(file);
    const widths = values.widths ? values.widths.split(",").map(Number) : DEFAULT_WIDTHS;
    const rules = values.rules ? values.rules.split(",").map(parseRule) : DEFAULT_RULES;
    const g = gridReport(h, capitalToken1(h, Number(values["capital-usd"])), widths, rules, costs);
    write(values.json, JSON.stringify(g, null, 1));
    const md = gridMarkdown(g, h.token1UsdAtCapture);
    write(values.md, md + "\n");
    process.stdout.write(md + "\n");
    return 0;
  }
  if (cmd === "report") {
    const files = historyFiles(values.dir!);
    const r = buildReport(files, Number(values.top), Number(values["capital-usd"]), costs);
    const hs = new Map(files.map((f) => loadHistory(f)).map((h) => [h.pool, h]));
    const md = reportMarkdown(r, hs);
    write(join(values.out!, "report.json"), JSON.stringify(r, null, 1));
    write(join(values.out!, "report.md"), md + "\n");
    process.stdout.write(`wrote ${join(values.out!, "report.md")} and report.json (${r.grids.length} pools)\n`);
    return 0;
  }
  process.stderr.write("usage: cli.ts fees|backtest|report ... (see SPEC.md section 4)\n");
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (c) => (process.exitCode = c),
    (e: unknown) => {
      process.stderr.write(`${(e as Error).message}\n`);
      process.exitCode = 1;
    },
  );
}

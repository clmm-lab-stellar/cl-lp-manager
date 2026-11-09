// SPDX-License-Identifier: Apache-2.0
// Read-only Stellar access: RPC simulation of view calls (no signing, dummy source
// account, never submitted) and StellarExpert contract-event paging.
import {
  Account,
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { fetchJson } from "../util/http.ts";

export const MAINNET_RPC = "https://mainnet.sorobanrpc.com";
export const STELLAR_EXPERT = "https://api.stellar.expert/explorer/public";
/** All-zero ed25519 key as a strkey. Used only as the source of simulated (never signed) txs. */
const DUMMY_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

let lastSim = 0;

/** Simulate a read-only contract call on mainnet and return the decoded return value. */
export async function simulateView(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
  rpcUrl = MAINNET_RPC,
): Promise<unknown> {
  const wait = lastSim + 600 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastSim = Date.now();
  const server = new rpc.Server(rpcUrl);
  const tx = new TransactionBuilder(new Account(DUMMY_SOURCE, "0"), {
    fee: "100",
    networkPassphrase: Networks.PUBLIC,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(0)
    .build();
  let res: Awaited<ReturnType<typeof server.simulateTransaction>> | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await server.simulateTransaction(tx);
      break;
    } catch (e) {
      // network errors only; simulation errors come back in the response body
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, Math.min(2000 * 2 ** attempt, 60_000)));
    }
  }
  if (rpc.Api.isSimulationError(res)) throw new Error(`simulate ${contractId}.${method}: ${res.error}`);
  if (!res.result) throw new Error(`simulate ${contractId}.${method}: no result`);
  return scValToNative(res.result.retval);
}

export async function tokenBalance(token: string, holder: string): Promise<bigint> {
  const v = await simulateView(token, "balance", [new Address(holder).toScVal()]);
  return BigInt(v as bigint | number | string);
}

export async function tokenMeta(token: string): Promise<{ symbol: string; decimals: number }> {
  const symbol = String(await simulateView(token, "symbol"));
  const decimals = Number(await simulateView(token, "decimals"));
  return { symbol, decimals };
}

export interface ExpertEvent {
  id: string;
  ts: number;
  contract: string;
  topics: string[];
  topicsXdr: string[];
  bodyXdr: string;
  paging_token: string;
}

interface ExpertPage {
  _embedded?: { records?: ExpertEvent[] };
}

/** Ledger sequence from a StellarExpert event id / paging token (TOID: ledger << 32 | ...). */
export function ledgerFromPagingToken(token: string): number {
  const toid = BigInt(token.split("-")[0] ?? "0");
  return Number(toid >> 32n);
}

/**
 * Page through a contract's events on StellarExpert.
 * order "desc" stops once events are older than `sinceTs`; "asc" reads everything.
 */
export async function expertContractEvents(
  contract: string,
  opts: { order: "asc" | "desc"; sinceTs?: number; maxPages?: number; cacheDir?: string; onPage?: (n: number) => void },
): Promise<ExpertEvent[]> {
  const out: ExpertEvent[] = [];
  let cursor: string | undefined;
  const maxPages = opts.maxPages ?? 2000;
  for (let page = 0; page < maxPages; page++) {
    const url =
      `${STELLAR_EXPERT}/contract/${contract}/events?order=${opts.order}&limit=200` + (cursor ? `&cursor=${cursor}` : "");
    // Only cache pages behind a cursor: the first page of a "desc" read changes every ledger.
    const fetchOpts = cursor && opts.cacheDir ? { cacheDir: opts.cacheDir, minIntervalMs: 1000 } : { minIntervalMs: 1000 };
    const data = await fetchJson<ExpertPage>(url, fetchOpts);
    const records = data._embedded?.records ?? [];
    opts.onPage?.(page + 1);
    if (records.length === 0) break;
    let stop = false;
    for (const r of records) {
      if (opts.order === "desc" && opts.sinceTs !== undefined && r.ts < opts.sinceTs) {
        stop = true;
        break;
      }
      out.push(r);
    }
    if (stop || records.length < 200) break;
    cursor = records[records.length - 1]?.paging_token;
  }
  return out;
}

export function decodeBody(bodyXdr: string): unknown {
  return scValToNative(xdr.ScVal.fromXDR(bodyXdr, "base64"));
}

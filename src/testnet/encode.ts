// SPDX-License-Identifier: Apache-2.0
// Pure ScVal encoders and decoders for the testnet vault demo (CLP-018). No network here.
// Shapes follow contracts/vault/src/lib.rs (Config, State, VaultError) and the demo oracle's
// SEP-40 Asset enum. Used by scripts/testnet-vault.ts and by web/ to decode live reads.
import { Address, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";

/** Vault error codes (VaultError in contracts/vault/src/lib.rs). */
export const VAULT_ERRORS: Record<number, string> = {
  1: "Paused",
  2: "OracleMissing",
  3: "OracleStale",
  4: "PriceDeviation",
  5: "InRange",
  6: "Cooldown",
  7: "ZeroAmount",
  8: "InsufficientShares",
  9: "CapExceeded",
  10: "BadConfig",
  11: "Overflow",
};

/** Extracts `Error(Contract, #N)` from a simulation or diagnostic error string. */
export function contractErrorCode(message: string): number | null {
  const m = /Error\(Contract, #(\d+)\)/.exec(message);
  return m ? Number(m[1]) : null;
}

export function vaultErrorName(message: string): string | null {
  const c = contractErrorCode(message);
  return c === null ? null : (VAULT_ERRORS[c] ?? `Contract error #${c}`);
}

/** Integer square root (floor) of a non-negative bigint. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("isqrt of negative");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** floor(sqrt(num/den) * 2^96), the pool's sqrt_price_x96 for a raw price num/den. */
export function sqrtPriceX96(num: bigint, den: bigint): bigint {
  return isqrt((num << 192n) / den);
}

/** Raw price x 1e9 from sqrt_price_x96, same arithmetic as the vault's pool_price_scaled. */
export function poolPriceScaled(sqrtX96: bigint): bigint {
  const s = sqrtX96 >> 48n;
  return (s * s * 1_000_000_000n) >> 96n;
}

export const u32 = (n: number): xdr.ScVal => xdr.ScVal.scvU32(n);
export const i32 = (n: number): xdr.ScVal => xdr.ScVal.scvI32(n);
export const u64 = (n: bigint | number): xdr.ScVal => nativeToScVal(BigInt(n), { type: "u64" });
export const i128 = (n: bigint | number): xdr.ScVal => nativeToScVal(BigInt(n), { type: "i128" });
export const u256 = (n: bigint): xdr.ScVal => nativeToScVal(n, { type: "u256" });
export const addr = (a: string): xdr.ScVal => new Address(a).toScVal();
export const sym = (s: string): xdr.ScVal => xdr.ScVal.scvSymbol(s);

/** SEP-40 `Asset::Stellar(address)`: a contracttype enum is a vec [symbol, payload]. */
export function stellarAsset(contractId: string): xdr.ScVal {
  return xdr.ScVal.scvVec([sym("Stellar"), addr(contractId)]);
}

/** A contracttype struct is an ScMap with symbol keys in sorted order. */
export function structScVal(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  const keys = Object.keys(fields).sort();
  return xdr.ScVal.scvMap(keys.map((k) => new xdr.ScMapEntry({ key: sym(k), val: fields[k]! })));
}

export interface VaultConfig {
  admin: string;
  keeper: string;
  pool: string;
  token0: string;
  token1: string;
  oracle: string;
  decimals0: number;
  decimals1: number;
  halfWidthTicks: number;
  maxDevBps: number;
  maxAge: number;
  maxSlippageBps: number;
  minInterval: number;
  cap: bigint;
}

export function configScVal(c: VaultConfig): xdr.ScVal {
  return structScVal({
    admin: addr(c.admin),
    keeper: addr(c.keeper),
    pool: addr(c.pool),
    token0: addr(c.token0),
    token1: addr(c.token1),
    oracle: addr(c.oracle),
    decimals0: u32(c.decimals0),
    decimals1: u32(c.decimals1),
    half_width_ticks: i32(c.halfWidthTicks),
    max_dev_bps: u32(c.maxDevBps),
    max_age: u64(c.maxAge),
    max_slippage_bps: u32(c.maxSlippageBps),
    min_interval: u64(c.minInterval),
    cap: i128(c.cap),
  });
}

export interface VaultState {
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  totalShares: string;
  lastRebalance: number;
  rebalances: number;
  paused: boolean;
}

/** Decodes the vault `State` struct (from `get_state` or the instance storage map). */
export function decodeState(v: xdr.ScVal): VaultState {
  const n = scValToNative(v) as Record<string, unknown>;
  return {
    tickLower: Number(n.tick_lower),
    tickUpper: Number(n.tick_upper),
    liquidity: String(n.liquidity),
    totalShares: String(n.total_shares),
    lastRebalance: Number(n.last_rebalance),
    rebalances: Number(n.rebalances),
    paused: Boolean(n.paused),
  };
}

/** Finds the `State` entry in a contract instance's storage map (key: enum variant `State`). */
export function stateFromInstanceStorage(storage: readonly xdr.ScMapEntry[]): VaultState | null {
  for (const e of storage) {
    const k = scValToNative(e.key) as unknown;
    if (Array.isArray(k) && k.length === 1 && k[0] === "State") return decodeState(e.val);
  }
  return null;
}

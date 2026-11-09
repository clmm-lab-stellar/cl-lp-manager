// SPDX-License-Identifier: Apache-2.0
//! Stable-pair concentrated-liquidity vault (CLP-005). TESTNET ONLY, UNAUDITED, DEMO-ONLY.
//!
//! Holds one range position in an Aquarius-concentrated-shaped pool (function names and
//! signatures read from the mainnet contract spec on 2026-11-03; see SPEC.md section 5) and
//! re-centres it only when an oracle-bounded check passes:
//!   1. the oracle prices (SEP-40 `lastprice`) are fresher than `max_age` seconds;
//!   2. the pool price is within `max_dev_bps` of the oracle cross price;
//!   3. the pool tick has left the current range;
//!   4. at least `min_interval` seconds have passed since the last rebalance.
//!
//! The re-centring swap is bounded by `max_slippage_bps` against the oracle price.
//!
//! Share accounting is deliberately simple for a first version: deposit and withdraw first pull
//! the whole position back to idle balances, value them at the oracle price, then redeploy.
//! Gas-heavy but easy to reason about (CLP-008 replaces it with in-contract position math).
//!
//! Known trade-off, deliberately kept (see RISKS.md): exits (withdraw, pause) are not
//! oracle-gated and unwind the position with `min_amounts = 0`, so they stay open when the
//! oracle is down. The cost is that someone who moves the pool price around an exit can leave
//! the remaining shareholders with a worse token mix.
#![no_std]

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype, panic_with_error, symbol_short,
    token::TokenClient,
    vec, Address, Env, IntoVal, Symbol, Vec, U256,
};

// ---------------------------------------------------------------------------------------------
// External interfaces

/// SEP-40 asset identifier.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

/// SEP-40 price record.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

#[contractclient(name = "OracleClient")]
pub trait Sep40Oracle {
    fn lastprice(env: Env, asset: Asset) -> Option<PriceData>;
    fn decimals(env: Env) -> u32;
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Slot0 {
    pub sqrt_price_x96: U256,
    pub tick: i32,
}

/// Subset of the Aquarius concentrated pool interface the vault uses.
#[contractclient(name = "ClPoolClient")]
pub trait ClPool {
    fn get_slot0(env: Env) -> Slot0;
    fn get_tick_spacing(env: Env) -> i32;
    fn deposit_position(
        env: Env,
        sender: Address,
        tick_lower: i32,
        tick_upper: i32,
        desired_amounts: Vec<u128>,
        min_liquidity: u128,
    ) -> (Vec<u128>, u128);
    fn withdraw_position(env: Env, owner: Address, tick_lower: i32, tick_upper: i32, amount: u128, min_amounts: Vec<u128>) -> Vec<u128>;
    fn claim_position_fees(env: Env, owner: Address, tick_lower: i32, tick_upper: i32) -> Vec<u128>;
    fn swap(env: Env, user: Address, in_idx: u32, out_idx: u32, in_amount: u128, out_min: u128) -> u128;
}

// ---------------------------------------------------------------------------------------------
// Types

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VaultError {
    Paused = 1,
    OracleMissing = 2,
    OracleStale = 3,
    PriceDeviation = 4,
    InRange = 5,
    Cooldown = 6,
    ZeroAmount = 7,
    InsufficientShares = 8,
    CapExceeded = 9,
    BadConfig = 10,
    Overflow = 11,
}

/// Virtual shares and virtual assets (raw token1 units) added to both sides of every share price.
/// This is the ERC-4626 "virtual offset" defence against first-depositor and donation inflation
/// (CLP-012): a donation to the vault is mostly absorbed by the virtual side, so an attacker who
/// donates X can cost a later depositor at most about X / VIRTUAL_OFFSET. The price of it is that
/// a small part of every payout (VIRTUAL_OFFSET / (total_shares + VIRTUAL_OFFSET)) stays in the
/// vault for the next depositor instead of going to the redeemer.
pub const VIRTUAL_OFFSET: i128 = 1_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub keeper: Address,
    pub pool: Address,
    pub token0: Address,
    pub token1: Address,
    pub oracle: Address,
    /// Token decimals (raw units are 10^decimals per token).
    pub decimals0: u32,
    pub decimals1: u32,
    /// Range half-width in ticks; rounded out to the pool tick spacing.
    pub half_width_ticks: i32,
    pub max_dev_bps: u32,
    pub max_age: u64,
    pub max_slippage_bps: u32,
    pub min_interval: u64,
    /// Deposit cap on total vault value, raw token1 units (testnet safety rail).
    pub cap: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Default)]
pub struct State {
    pub tick_lower: i32,
    pub tick_upper: i32,
    pub liquidity: u128,
    pub total_shares: i128,
    pub last_rebalance: u64,
    pub rebalances: u32,
    pub paused: bool,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Config,
    State,
    Shares(Address),
}

/// Fixed-point scale for prices (raw token1 per raw token0).
pub const PRICE_SCALE: i128 = 1_000_000_000;

// ---------------------------------------------------------------------------------------------
// Pure helpers (unit-tested directly)

/// Raw pool price (token1 raw per token0 raw) x 1e9 from sqrt_price_x96.
/// (sqrt >> 48)^2 * 1e9 >> 96 keeps the product below 2^256 for sqrt < 2^160.
pub fn pool_price_scaled(env: &Env, sqrt_price_x96: &U256) -> i128 {
    let s = sqrt_price_x96.shr(48);
    let v = s.mul(&s).mul(&U256::from_u128(env, PRICE_SCALE as u128)).shr(96);
    match v.to_u128() {
        Some(x) if x <= i128::MAX as u128 => x as i128,
        _ => panic_with_error!(env, VaultError::Overflow),
    }
}

/// Oracle cross price, raw token1 per raw token0, x 1e9.
pub fn oracle_cross_scaled(p0: i128, p1: i128, decimals0: u32, decimals1: u32) -> Option<i128> {
    if p0 <= 0 || p1 <= 0 {
        return None;
    }
    let num = p0.checked_mul(PRICE_SCALE)?.checked_mul(10i128.checked_pow(decimals1)?)?;
    let den = p1.checked_mul(10i128.checked_pow(decimals0)?)?;
    Some(num / den)
}

/// |a - b| <= bps/10_000 * b
pub fn within_bps(a: i128, b: i128, bps: u32) -> bool {
    let diff = if a > b { a - b } else { b - a };
    diff.saturating_mul(10_000) <= b.saturating_mul(bps as i128)
}

/// Floor division for possibly negative ticks.
fn floor_div(a: i32, b: i32) -> i32 {
    let q = a / b;
    if (a % b != 0) && ((a < 0) != (b < 0)) {
        q - 1
    } else {
        q
    }
}

/// Range centred on `tick`, widened outward to multiples of `spacing`.
pub fn centred_range(tick: i32, half_width: i32, spacing: i32) -> (i32, i32) {
    let lower = floor_div(tick - half_width, spacing) * spacing;
    let upper_raw = tick + half_width;
    let mut upper = floor_div(upper_raw, spacing) * spacing;
    if upper < upper_raw {
        upper += spacing;
    }
    if upper <= lower {
        upper = lower + spacing;
    }
    (lower, upper)
}

/// Amount of token to sell so that value splits 50/50 at `price` (raw t1 per raw t0, x 1e9).
/// Returns (in_idx, amount_in, expected_out).
pub fn rebalance_swap(a0: i128, a1: i128, price: i128) -> Option<(u32, i128, i128)> {
    let v0 = a0.checked_mul(price)? / PRICE_SCALE;
    let total = v0.checked_add(a1)?;
    let half = total / 2;
    if v0 > half {
        let sell1_value = v0 - half;
        let amt0 = sell1_value.checked_mul(PRICE_SCALE)? / price;
        Some((0, amt0, sell1_value))
    } else if a1 > half {
        let amt1 = a1 - half;
        Some((1, amt1, amt1.checked_mul(PRICE_SCALE)? / price))
    } else {
        None
    }
}

// ---------------------------------------------------------------------------------------------
// Contract

// ---------------------------------------------------------------------------------------------
// Events

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Deposited {
    #[topic]
    pub from: Address,
    pub amount0: i128,
    pub amount1: i128,
    pub shares: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Withdrawn {
    #[topic]
    pub owner: Address,
    pub shares: i128,
    pub amount0: i128,
    pub amount1: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Rebalanced {
    pub tick_lower: i32,
    pub tick_upper: i32,
    pub liquidity: u128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PausedChanged {
    pub paused: bool,
}

#[contract]
pub struct ClVault;

fn config(env: &Env) -> Config {
    env.storage().instance().get(&DataKey::Config).unwrap()
}

fn state(env: &Env) -> State {
    env.storage().instance().get(&DataKey::State).unwrap_or_default()
}

/// About one day of ledgers at 5 s per ledger.
const DAY_LEDGERS: u32 = 17_280;

fn put_state(env: &Env, s: &State) {
    env.storage().instance().set(&DataKey::State, s);
    env.storage().instance().extend_ttl(30 * DAY_LEDGERS, 90 * DAY_LEDGERS);
}

fn shares_of(env: &Env, who: &Address) -> i128 {
    env.storage().persistent().get(&DataKey::Shares(who.clone())).unwrap_or(0)
}

fn set_shares(env: &Env, who: &Address, v: i128) {
    let key = DataKey::Shares(who.clone());
    env.storage().persistent().set(&key, &v);
    env.storage().persistent().extend_ttl(&key, 30 * DAY_LEDGERS, 90 * DAY_LEDGERS);
}

/// Let the pool pull the listed (token, amount) pairs from this contract inside the next call.
/// One `authorize_as_current_contract` call carries all entries for that call.
fn authorize_pulls(env: &Env, to: &Address, pulls: &[(&Address, i128)]) {
    let mut entries: Vec<InvokerContractAuthEntry> = Vec::new(env);
    for (token, amount) in pulls {
        if *amount <= 0 {
            continue;
        }
        entries.push_back(InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: (*token).clone(),
                fn_name: symbol_short!("transfer"),
                args: (env.current_contract_address(), to.clone(), *amount).into_val(env),
            },
            sub_invocations: vec![env],
        }));
    }
    if !entries.is_empty() {
        env.authorize_as_current_contract(entries);
    }
}

/// Checked oracle price; panics with the matching VaultError.
fn guarded_prices(env: &Env, c: &Config) -> (i128, i128) {
    let oracle = OracleClient::new(env, &c.oracle);
    let now = env.ledger().timestamp();
    let p0 = oracle.lastprice(&Asset::Stellar(c.token0.clone()));
    let p1 = oracle.lastprice(&Asset::Stellar(c.token1.clone()));
    let (p0, p1) = match (p0, p1) {
        (Some(a), Some(b)) => (a, b),
        _ => panic_with_error!(env, VaultError::OracleMissing),
    };
    // A timestamp in the future is as untrustworthy as an old one.
    if p0.timestamp > now || p1.timestamp > now || now - p0.timestamp > c.max_age || now - p1.timestamp > c.max_age {
        panic_with_error!(env, VaultError::OracleStale);
    }
    let oracle_px = match oracle_cross_scaled(p0.price, p1.price, c.decimals0, c.decimals1) {
        Some(x) if x > 0 => x,
        _ => panic_with_error!(env, VaultError::OracleMissing),
    };
    let slot = ClPoolClient::new(env, &c.pool).get_slot0();
    let pool_px = pool_price_scaled(env, &slot.sqrt_price_x96);
    if !within_bps(pool_px, oracle_px, c.max_dev_bps) {
        panic_with_error!(env, VaultError::PriceDeviation);
    }
    (oracle_px, slot.tick as i128)
}

/// Shares minted for `added` value when the vault holds `before` value and `total_shares` shares.
/// Both sides carry VIRTUAL_OFFSET, so the first deposit mints 1:1 and a donation cannot push the
/// share price high enough to round later deposits to zero.
fn mint_amount(env: &Env, added: i128, total_shares: i128, before: i128) -> i128 {
    let num = added
        .checked_mul(total_shares.checked_add(VIRTUAL_OFFSET).unwrap_or_else(|| panic_with_error!(env, VaultError::Overflow)))
        .unwrap_or_else(|| panic_with_error!(env, VaultError::Overflow));
    num / before.checked_add(VIRTUAL_OFFSET).unwrap_or_else(|| panic_with_error!(env, VaultError::Overflow))
}

/// Amount of one token paid for `shares` out of `balance`, with the same virtual offset.
fn redeem_amount(env: &Env, balance: i128, shares: i128, total_shares: i128) -> i128 {
    let num = balance.checked_mul(shares).unwrap_or_else(|| panic_with_error!(env, VaultError::Overflow));
    num / total_shares.checked_add(VIRTUAL_OFFSET).unwrap_or_else(|| panic_with_error!(env, VaultError::Overflow))
}

/// Pull the whole position (and its fees) back to idle balances.
fn unwind(env: &Env, c: &Config, s: &mut State) {
    let pool = ClPoolClient::new(env, &c.pool);
    let me = env.current_contract_address();
    if s.liquidity > 0 {
        pool.claim_position_fees(&me, &s.tick_lower, &s.tick_upper);
        pool.withdraw_position(&me, &s.tick_lower, &s.tick_upper, &s.liquidity, &vec![env, 0u128, 0u128]);
        s.liquidity = 0;
    }
}

/// Deploy all idle balances into [tick_lower, tick_upper].
fn deploy(env: &Env, c: &Config, s: &mut State) {
    let me = env.current_contract_address();
    let b0 = TokenClient::new(env, &c.token0).balance(&me);
    let b1 = TokenClient::new(env, &c.token1).balance(&me);
    if b0 <= 0 && b1 <= 0 {
        return;
    }
    authorize_pulls(env, &c.pool, &[(&c.token0, b0), (&c.token1, b1)]);
    let (_used, liq) =
        ClPoolClient::new(env, &c.pool).deposit_position(&me, &s.tick_lower, &s.tick_upper, &vec![env, b0 as u128, b1 as u128], &0u128);
    s.liquidity = liq;
}

fn idle_value(env: &Env, c: &Config, price: i128) -> i128 {
    let me = env.current_contract_address();
    let b0 = TokenClient::new(env, &c.token0).balance(&me);
    let b1 = TokenClient::new(env, &c.token1).balance(&me);
    b0.checked_mul(price)
        .map(|v| v / PRICE_SCALE)
        .and_then(|v| v.checked_add(b1))
        .unwrap_or_else(|| panic_with_error!(env, VaultError::Overflow))
}

#[contractimpl]
impl ClVault {
    pub fn __constructor(env: Env, config: Config) {
        if config.half_width_ticks <= 0
            || config.max_dev_bps == 0
            || config.max_dev_bps > 10_000
            || config.max_slippage_bps > 10_000
            || config.cap <= 0
            || config.max_age == 0
            || config.min_interval == 0
            || config.decimals0 > 18
            || config.decimals1 > 18
            || config.token0 == config.token1
        {
            panic_with_error!(&env, VaultError::BadConfig);
        }
        let spacing = ClPoolClient::new(&env, &config.pool).get_tick_spacing();
        let tick = ClPoolClient::new(&env, &config.pool).get_slot0().tick;
        let (lo, hi) = centred_range(tick, config.half_width_ticks, spacing);
        env.storage().instance().set(&DataKey::Config, &config);
        put_state(&env, &State { tick_lower: lo, tick_upper: hi, ..State::default() });
    }

    /// Deposit any mix of the two tokens; shares are minted at the oracle-valued contribution.
    pub fn deposit(env: Env, from: Address, amount0: i128, amount1: i128) -> i128 {
        from.require_auth();
        let c = config(&env);
        let mut s = state(&env);
        if s.paused {
            panic_with_error!(&env, VaultError::Paused);
        }
        if amount0 < 0 || amount1 < 0 || (amount0 == 0 && amount1 == 0) {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }
        let (price, _) = guarded_prices(&env, &c);
        unwind(&env, &c, &mut s);
        let before = idle_value(&env, &c, price);
        let me = env.current_contract_address();
        if amount0 > 0 {
            TokenClient::new(&env, &c.token0).transfer(&from, &me, &amount0);
        }
        if amount1 > 0 {
            TokenClient::new(&env, &c.token1).transfer(&from, &me, &amount1);
        }
        let after = idle_value(&env, &c, price);
        if after > c.cap {
            panic_with_error!(&env, VaultError::CapExceeded);
        }
        let added = after - before;
        let minted = mint_amount(&env, added, s.total_shares, before);
        if minted <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }
        set_shares(&env, &from, shares_of(&env, &from) + minted);
        s.total_shares += minted;
        deploy(&env, &c, &mut s);
        put_state(&env, &s);
        Deposited { from, amount0, amount1, shares: minted }.publish(&env);
        minted
    }

    /// Burn `shares` and receive the pro-rata share of both tokens. Not oracle-gated, so exits
    /// stay open when the oracle is down (the pro-rata payout needs no price).
    pub fn withdraw(env: Env, owner: Address, shares: i128) -> (i128, i128) {
        owner.require_auth();
        let c = config(&env);
        let mut s = state(&env);
        let have = shares_of(&env, &owner);
        if shares <= 0 || shares > have {
            panic_with_error!(&env, VaultError::InsufficientShares);
        }
        unwind(&env, &c, &mut s);
        let me = env.current_contract_address();
        let t0 = TokenClient::new(&env, &c.token0);
        let t1 = TokenClient::new(&env, &c.token1);
        let out0 = redeem_amount(&env, t0.balance(&me), shares, s.total_shares);
        let out1 = redeem_amount(&env, t1.balance(&me), shares, s.total_shares);
        set_shares(&env, &owner, have - shares);
        s.total_shares -= shares;
        if out0 > 0 {
            t0.transfer(&me, &owner, &out0);
        }
        if out1 > 0 {
            t1.transfer(&me, &owner, &out1);
        }
        if !s.paused {
            deploy(&env, &c, &mut s);
        }
        put_state(&env, &s);
        Withdrawn { owner, shares, amount0: out0, amount1: out1 }.publish(&env);
        (out0, out1)
    }

    /// Keeper-only. Re-centre the range when all oracle-bounded conditions hold.
    pub fn rebalance(env: Env) -> (i32, i32) {
        let c = config(&env);
        c.keeper.require_auth();
        let mut s = state(&env);
        if s.paused {
            panic_with_error!(&env, VaultError::Paused);
        }
        let now = env.ledger().timestamp();
        if s.rebalances > 0 && now.saturating_sub(s.last_rebalance) < c.min_interval {
            panic_with_error!(&env, VaultError::Cooldown);
        }
        let (price, tick) = guarded_prices(&env, &c);
        let tick = tick as i32;
        if tick >= s.tick_lower && tick < s.tick_upper {
            panic_with_error!(&env, VaultError::InRange);
        }
        unwind(&env, &c, &mut s);
        let me = env.current_contract_address();
        let b0 = TokenClient::new(&env, &c.token0).balance(&me);
        let b1 = TokenClient::new(&env, &c.token1).balance(&me);
        if let Some((in_idx, amount_in, expected_out)) = rebalance_swap(b0, b1, price) {
            if amount_in > 0 {
                let out_min = expected_out * (10_000 - c.max_slippage_bps as i128) / 10_000;
                let token_in = if in_idx == 0 { &c.token0 } else { &c.token1 };
                authorize_pulls(&env, &c.pool, &[(token_in, amount_in)]);
                ClPoolClient::new(&env, &c.pool).swap(&me, &in_idx, &(1 - in_idx), &(amount_in as u128), &(out_min.max(0) as u128));
            }
        }
        let spacing = ClPoolClient::new(&env, &c.pool).get_tick_spacing();
        let (lo, hi) = centred_range(tick, c.half_width_ticks, spacing);
        s.tick_lower = lo;
        s.tick_upper = hi;
        deploy(&env, &c, &mut s);
        s.last_rebalance = now;
        s.rebalances += 1;
        put_state(&env, &s);
        Rebalanced { tick_lower: lo, tick_upper: hi, liquidity: s.liquidity }.publish(&env);
        (lo, hi)
    }

    /// Admin-only. Pause pulls the position to idle; unpause redeploys into the current range.
    pub fn set_paused(env: Env, paused: bool) {
        let c = config(&env);
        c.admin.require_auth();
        let mut s = state(&env);
        if paused {
            unwind(&env, &c, &mut s);
        } else {
            deploy(&env, &c, &mut s);
        }
        s.paused = paused;
        put_state(&env, &s);
        PausedChanged { paused }.publish(&env);
    }

    pub fn get_state(env: Env) -> State {
        state(&env)
    }

    pub fn get_config(env: Env) -> Config {
        config(&env)
    }

    pub fn shares(env: Env, who: Address) -> i128 {
        shares_of(&env, &who)
    }
}

#[cfg(test)]
mod test;

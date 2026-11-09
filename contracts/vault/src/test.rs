// SPDX-License-Identifier: Apache-2.0
//! Vault tests against a mock CL pool and a mock SEP-40 oracle.
//! The mock pool keeps deposited token amounts per position unchanged (no price-dependent
//! composition); it exists to exercise the vault's guard, range, swap and share logic.
extern crate std;

use super::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
    token::StellarAssetClient,
    Map,
};

// ------------------------------------------------------------------ mock pool

#[contracttype]
#[derive(Clone)]
enum PK {
    T0,
    T1,
    Slot,
    Spacing,
    Fee,
    Pos(Address, i32, i32),
    Fees(Address),
}

#[contract]
pub struct MockPool;

fn q96(env: &Env) -> U256 {
    U256::from_u128(env, 1u128 << 96)
}

#[contractimpl]
impl MockPool {
    pub fn __constructor(env: Env, t0: Address, t1: Address, spacing: i32, fee_bps: u32) {
        env.storage().instance().set(&PK::T0, &t0);
        env.storage().instance().set(&PK::T1, &t1);
        env.storage().instance().set(&PK::Spacing, &spacing);
        env.storage().instance().set(&PK::Fee, &fee_bps);
        env.storage().instance().set(&PK::Slot, &Slot0 { sqrt_price_x96: q96(&env), tick: 0 });
    }
    pub fn set_slot(env: Env, sqrt_price_x96: U256, tick: i32) {
        env.storage().instance().set(&PK::Slot, &Slot0 { sqrt_price_x96, tick });
    }
    pub fn add_fees(env: Env, owner: Address, f0: i128, f1: i128) {
        env.storage().instance().set(&PK::Fees(owner), &(f0, f1));
    }
    pub fn get_slot0(env: Env) -> Slot0 {
        env.storage().instance().get(&PK::Slot).unwrap()
    }
    pub fn get_tick_spacing(env: Env) -> i32 {
        env.storage().instance().get(&PK::Spacing).unwrap()
    }
    pub fn deposit_position(
        env: Env,
        sender: Address,
        tick_lower: i32,
        tick_upper: i32,
        desired_amounts: Vec<u128>,
        _min_liquidity: u128,
    ) -> (Vec<u128>, u128) {
        sender.require_auth();
        let t0: Address = env.storage().instance().get(&PK::T0).unwrap();
        let t1: Address = env.storage().instance().get(&PK::T1).unwrap();
        let a0 = desired_amounts.get(0).unwrap() as i128;
        let a1 = desired_amounts.get(1).unwrap() as i128;
        let me = env.current_contract_address();
        if a0 > 0 {
            TokenClient::new(&env, &t0).transfer(&sender, &me, &a0);
        }
        if a1 > 0 {
            TokenClient::new(&env, &t1).transfer(&sender, &me, &a1);
        }
        let key = PK::Pos(sender, tick_lower, tick_upper);
        let (p0, p1, l): (i128, i128, u128) = env.storage().instance().get(&key).unwrap_or((0, 0, 0));
        let liq = (a0 + a1) as u128;
        env.storage().instance().set(&key, &(p0 + a0, p1 + a1, l + liq));
        (vec![&env, a0 as u128, a1 as u128], liq)
    }
    pub fn withdraw_position(
        env: Env,
        owner: Address,
        tick_lower: i32,
        tick_upper: i32,
        amount: u128,
        _min_amounts: Vec<u128>,
    ) -> Vec<u128> {
        owner.require_auth();
        let key = PK::Pos(owner.clone(), tick_lower, tick_upper);
        let (p0, p1, l): (i128, i128, u128) = env.storage().instance().get(&key).unwrap();
        assert!(amount <= l, "withdraw more than liquidity");
        let o0 = p0 * amount as i128 / l as i128;
        let o1 = p1 * amount as i128 / l as i128;
        env.storage().instance().set(&key, &(p0 - o0, p1 - o1, l - amount));
        let t0: Address = env.storage().instance().get(&PK::T0).unwrap();
        let t1: Address = env.storage().instance().get(&PK::T1).unwrap();
        let me = env.current_contract_address();
        if o0 > 0 {
            TokenClient::new(&env, &t0).transfer(&me, &owner, &o0);
        }
        if o1 > 0 {
            TokenClient::new(&env, &t1).transfer(&me, &owner, &o1);
        }
        vec![&env, o0 as u128, o1 as u128]
    }
    pub fn claim_position_fees(env: Env, owner: Address, _tick_lower: i32, _tick_upper: i32) -> Vec<u128> {
        owner.require_auth();
        let (f0, f1): (i128, i128) = env.storage().instance().get(&PK::Fees(owner.clone())).unwrap_or((0, 0));
        env.storage().instance().set(&PK::Fees(owner.clone()), &(0i128, 0i128));
        let t0: Address = env.storage().instance().get(&PK::T0).unwrap();
        let t1: Address = env.storage().instance().get(&PK::T1).unwrap();
        let me = env.current_contract_address();
        if f0 > 0 {
            TokenClient::new(&env, &t0).transfer(&me, &owner, &f0);
        }
        if f1 > 0 {
            TokenClient::new(&env, &t1).transfer(&me, &owner, &f1);
        }
        vec![&env, f0 as u128, f1 as u128]
    }
    /// Swaps at the slot price, charging fee_bps.
    pub fn swap(env: Env, user: Address, in_idx: u32, out_idx: u32, in_amount: u128, out_min: u128) -> u128 {
        user.require_auth();
        assert!(in_idx != out_idx);
        let slot: Slot0 = env.storage().instance().get(&PK::Slot).unwrap();
        let price = pool_price_scaled(&env, &slot.sqrt_price_x96);
        let fee: u32 = env.storage().instance().get(&PK::Fee).unwrap();
        let gross = if in_idx == 0 { in_amount as i128 * price / PRICE_SCALE } else { in_amount as i128 * PRICE_SCALE / price };
        let out = gross * (10_000 - fee as i128) / 10_000;
        assert!(out as u128 >= out_min, "slippage");
        let t0: Address = env.storage().instance().get(&PK::T0).unwrap();
        let t1: Address = env.storage().instance().get(&PK::T1).unwrap();
        let (tin, tout) = if in_idx == 0 { (t0, t1) } else { (t1, t0) };
        let me = env.current_contract_address();
        TokenClient::new(&env, &tin).transfer(&user, &me, &(in_amount as i128));
        TokenClient::new(&env, &tout).transfer(&me, &user, &out);
        out as u128
    }
}

// ------------------------------------------------------------------ mock oracle

#[contracttype]
#[derive(Clone)]
enum OK {
    Prices,
}

#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    pub fn set(env: Env, asset: Asset, price: i128, timestamp: u64) {
        let mut m: Map<Asset, PriceData> = env.storage().instance().get(&OK::Prices).unwrap_or(Map::new(&env));
        m.set(asset, PriceData { price, timestamp });
        env.storage().instance().set(&OK::Prices, &m);
    }
    pub fn lastprice(env: Env, asset: Asset) -> Option<PriceData> {
        let m: Map<Asset, PriceData> = env.storage().instance().get(&OK::Prices).unwrap_or(Map::new(&env));
        m.get(asset)
    }
    pub fn decimals(_env: Env) -> u32 {
        14
    }
}

// ------------------------------------------------------------------ fixture

const ONE: i128 = 100_000_000_000_000; // 1.0 at 14 oracle decimals
const UNIT: i128 = 10_000_000; // 1 token at 7 decimals

struct Fx {
    env: Env,
    vault: Address,
    pool: Address,
    oracle: Address,
    t0: Address,
    t1: Address,
    admin: Address,
    keeper: Address,
    user: Address,
}

fn setup() -> Fx {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);
    let admin = Address::generate(&env);
    let keeper = Address::generate(&env);
    let user = Address::generate(&env);
    let t0 = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let t1 = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let pool = env.register(MockPool, (t0.clone(), t1.clone(), 10i32, 5u32));
    let oracle = env.register(MockOracle, ());
    let oc = MockOracleClient::new(&env, &oracle);
    oc.set(&Asset::Stellar(t0.clone()), &ONE, &1_000_000);
    oc.set(&Asset::Stellar(t1.clone()), &ONE, &1_000_000);
    // pool liquidity for swaps
    StellarAssetClient::new(&env, &t0).mint(&pool, &(1_000_000 * UNIT));
    StellarAssetClient::new(&env, &t1).mint(&pool, &(1_000_000 * UNIT));
    StellarAssetClient::new(&env, &t0).mint(&user, &(10_000 * UNIT));
    StellarAssetClient::new(&env, &t1).mint(&user, &(10_000 * UNIT));
    let cfg = Config {
        admin: admin.clone(),
        keeper: keeper.clone(),
        pool: pool.clone(),
        token0: t0.clone(),
        token1: t1.clone(),
        oracle: oracle.clone(),
        decimals0: 7,
        decimals1: 7,
        half_width_ticks: 25,
        max_dev_bps: 50,
        max_age: 600,
        max_slippage_bps: 30,
        min_interval: 3600,
        cap: 1_000_000 * UNIT,
    };
    let vault = env.register(ClVault, (cfg,));
    Fx { env, vault, pool, oracle, t0, t1, admin, keeper, user }
}

fn sqrt_for_tick_price(env: &Env, price: f64) -> U256 {
    // sqrt(price) * 2^96, enough precision for tests
    let s = libm_sqrt(price) * (1u128 << 64) as f64;
    U256::from_u128(env, s as u128).shl(32)
}

fn libm_sqrt(x: f64) -> f64 {
    // Newton iterations; no_std-friendly and exact enough for test prices near 1.
    let mut g = if x > 1.0 { x } else { 1.0 };
    for _ in 0..60 {
        g = 0.5 * (g + x / g);
    }
    g
}

// ------------------------------------------------------------------ pure helpers

#[test]
fn helper_prices_ranges_and_swaps() {
    let env = Env::default();
    assert_eq!(pool_price_scaled(&env, &q96(&env)), PRICE_SCALE);
    assert_eq!(pool_price_scaled(&env, &q96(&env).shl(1)), 4 * PRICE_SCALE);
    assert_eq!(oracle_cross_scaled(2 * ONE, ONE, 7, 7), Some(2 * PRICE_SCALE));
    assert_eq!(oracle_cross_scaled(ONE, ONE, 7, 6), Some(PRICE_SCALE / 10));
    assert_eq!(oracle_cross_scaled(0, ONE, 7, 7), None);
    assert!(within_bps(1_004_000_000, PRICE_SCALE, 50));
    assert!(!within_bps(1_006_000_000, PRICE_SCALE, 50));
    assert_eq!(centred_range(0, 25, 10), (-30, 30));
    assert_eq!(centred_range(-16193, 25, 10), (-16220, -16160));
    assert_eq!(centred_range(7, 1, 60), (0, 60));
    assert_eq!(rebalance_swap(100, 0, PRICE_SCALE), Some((0, 50, 50)));
    assert_eq!(rebalance_swap(0, 100, 2 * PRICE_SCALE), Some((1, 50, 25)));
    assert_eq!(rebalance_swap(50, 50, PRICE_SCALE), None);
}

// ------------------------------------------------------------------ vault behaviour

#[test]
fn deposit_mints_value_shares_and_deploys() {
    let f = setup();
    let v = ClVaultClient::new(&f.env, &f.vault);
    let s0 = v.deposit(&f.user, &(100 * UNIT), &(100 * UNIT));
    assert_eq!(s0, 200 * UNIT);
    let st = v.get_state();
    assert_eq!((st.tick_lower, st.tick_upper), (-30, 30));
    assert_eq!(st.liquidity, (200 * UNIT) as u128);
    assert_eq!(TokenClient::new(&f.env, &f.t0).balance(&f.vault), 0);
    // second depositor gets proportional shares
    let other = Address::generate(&f.env);
    StellarAssetClient::new(&f.env, &f.t1).mint(&other, &(50 * UNIT));
    let s1 = v.deposit(&other, &0, &(50 * UNIT));
    assert_eq!(s1, 50 * UNIT);
    assert_eq!(v.get_state().total_shares, 250 * UNIT);
}

#[test]
fn deposit_respects_cap_and_guard() {
    let f = setup();
    let v = ClVaultClient::new(&f.env, &f.vault);
    StellarAssetClient::new(&f.env, &f.t1).mint(&f.user, &(2_000_000 * UNIT));
    assert_eq!(v.try_deposit(&f.user, &0, &(1_000_001 * UNIT)), Err(Ok(VaultError::CapExceeded.into())));
    // pool price 1% away from oracle: deposit refused
    MockPoolClient::new(&f.env, &f.pool).set_slot(&sqrt_for_tick_price(&f.env, 1.01), &100);
    assert_eq!(v.try_deposit(&f.user, &UNIT, &UNIT), Err(Ok(VaultError::PriceDeviation.into())));
}

#[test]
fn rebalance_refuses_in_range_stale_deviation_and_cooldown() {
    let f = setup();
    let v = ClVaultClient::new(&f.env, &f.vault);
    v.deposit(&f.user, &(100 * UNIT), &(100 * UNIT));
    assert_eq!(v.try_rebalance(), Err(Ok(VaultError::InRange.into())));

    // move pool to tick 40 at price ~1.004 (out of [-30,30)), oracle agrees
    let pool = MockPoolClient::new(&f.env, &f.pool);
    let oc = MockOracleClient::new(&f.env, &f.oracle);
    pool.set_slot(&sqrt_for_tick_price(&f.env, 1.004), &40);
    oc.set(&Asset::Stellar(f.t0.clone()), &(ONE + ONE * 4 / 1000), &1_000_000);

    // stale oracle
    f.env.ledger().with_mut(|l| l.timestamp = 1_000_000 + 601);
    assert_eq!(v.try_rebalance(), Err(Ok(VaultError::OracleStale.into())));
    oc.set(&Asset::Stellar(f.t0.clone()), &(ONE + ONE * 4 / 1000), &1_000_601);
    oc.set(&Asset::Stellar(f.t1.clone()), &ONE, &1_000_601);

    // oracle disagrees with pool by 1%
    oc.set(&Asset::Stellar(f.t0.clone()), &(ONE + ONE * 14 / 1000), &1_000_601);
    assert_eq!(v.try_rebalance(), Err(Ok(VaultError::PriceDeviation.into())));
    oc.set(&Asset::Stellar(f.t0.clone()), &(ONE + ONE * 4 / 1000), &1_000_601);

    // passes: new range centred on tick 40
    assert_eq!(v.rebalance(), (10, 70));
    let st = v.get_state();
    assert_eq!(st.rebalances, 1);
    assert_eq!((st.tick_lower, st.tick_upper), (10, 70));

    // cooldown
    pool.set_slot(&sqrt_for_tick_price(&f.env, 1.004), &200);
    assert_eq!(v.try_rebalance(), Err(Ok(VaultError::Cooldown.into())));
}

#[test]
fn rebalance_swaps_to_half_and_half_at_oracle_price() {
    let f = setup();
    let v = ClVaultClient::new(&f.env, &f.vault);
    v.deposit(&f.user, &(200 * UNIT), &0); // all token0
    MockPoolClient::new(&f.env, &f.pool).set_slot(&q96(&f.env), &-100); // price 1, tick out of range
    v.rebalance();
    let st = v.get_state();
    // mock pool records deposited amounts; 100 token0 sold for 100*(1-5bps) token1
    let pos_value = st.liquidity as i128;
    assert_eq!(pos_value, 100 * UNIT + 100 * UNIT * 9995 / 10_000);
    assert_eq!((st.tick_lower, st.tick_upper), (-130, -70));
}

#[test]
fn withdraw_pays_pro_rata_including_fees_even_with_stale_oracle() {
    let f = setup();
    let v = ClVaultClient::new(&f.env, &f.vault);
    let shares = v.deposit(&f.user, &(100 * UNIT), &(100 * UNIT));
    // pool owes the vault 2 + 2 tokens of fees
    MockPoolClient::new(&f.env, &f.pool).add_fees(&f.vault, &(2 * UNIT), &(2 * UNIT));
    f.env.ledger().with_mut(|l| l.timestamp = 9_999_999); // oracle stale
    let (o0, o1) = v.withdraw(&f.user, &(shares / 2));
    // 102 tokens idle x 100 shares / (200 shares + virtual offset): a hair under the exact half.
    let exact = 102 * UNIT * (shares / 2) / (shares + VIRTUAL_OFFSET);
    assert_eq!((o0, o1), (exact, exact));
    assert!(o0 < 51 * UNIT && o0 > 51 * UNIT - 10 * VIRTUAL_OFFSET);
    assert_eq!(v.shares(&f.user), shares / 2);
    assert_eq!(v.try_withdraw(&f.user, &(shares)), Err(Ok(VaultError::InsufficientShares.into())));
}

#[test]
fn pause_unwinds_and_blocks_deposits_and_rebalance() {
    let f = setup();
    let v = ClVaultClient::new(&f.env, &f.vault);
    v.deposit(&f.user, &(10 * UNIT), &(10 * UNIT));
    v.set_paused(&true);
    assert_eq!(v.get_state().liquidity, 0);
    assert_eq!(TokenClient::new(&f.env, &f.t0).balance(&f.vault), 10 * UNIT);
    assert_eq!(v.try_deposit(&f.user, &UNIT, &UNIT), Err(Ok(VaultError::Paused.into())));
    assert_eq!(v.try_rebalance(), Err(Ok(VaultError::Paused.into())));
    v.set_paused(&false);
    assert_eq!(v.get_state().liquidity, (20 * UNIT) as u128);
    let _ = (&f.admin, &f.keeper);
}

#[test]
fn rebalance_needs_keeper_auth_and_contract_pulls_are_self_authorised() {
    let f = setup();
    let v = ClVaultClient::new(&f.env, &f.vault);
    v.deposit(&f.user, &(100 * UNIT), &(100 * UNIT));
    MockPoolClient::new(&f.env, &f.pool).set_slot(&q96(&f.env), &-100);

    // No auths mocked at all: the keeper's signature is missing.
    f.env.set_auths(&[]);
    assert!(v.try_rebalance().is_err());

    // Only the keeper's auth for `rebalance` is mocked. The vault's token pulls inside the pool
    // must then be covered by authorize_as_current_contract, or this call fails.
    f.env.mock_auths(&[MockAuth {
        address: &f.keeper,
        invoke: &MockAuthInvoke { contract: &f.vault, fn_name: "rebalance", args: ().into_val(&f.env), sub_invokes: &[] },
    }]);
    assert_eq!(v.rebalance(), (-130, -70));

    // A random address cannot rebalance.
    let mallory = Address::generate(&f.env);
    MockPoolClient::new(&f.env, &f.pool).set_slot(&q96(&f.env), &500);
    f.env.ledger().with_mut(|l| l.timestamp += 7200);
    let oc = MockOracleClient::new(&f.env, &f.oracle);
    f.env.mock_all_auths();
    let ts = f.env.ledger().timestamp();
    oc.set(&Asset::Stellar(f.t0.clone()), &ONE, &ts);
    oc.set(&Asset::Stellar(f.t1.clone()), &ONE, &ts);
    f.env.mock_auths(&[MockAuth {
        address: &mallory,
        invoke: &MockAuthInvoke { contract: &f.vault, fn_name: "rebalance", args: ().into_val(&f.env), sub_invokes: &[] },
    }]);
    assert!(v.try_rebalance().is_err());
}

#[test]
fn constructor_rejects_bad_config() {
    let f = setup();
    let mut cfg = ClVaultClient::new(&f.env, &f.vault).get_config();
    cfg.half_width_ticks = 0;
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        f.env.register(ClVault, (cfg.clone(),));
    }));
    assert!(r.is_err());
}

#[test]
fn constructor_rejects_each_bad_field() {
    let f = setup();
    let good = ClVaultClient::new(&f.env, &f.vault).get_config();
    let mut bads = std::vec::Vec::new();
    let mut c = good.clone();
    c.max_age = 0;
    bads.push(c);
    let mut c = good.clone();
    c.min_interval = 0;
    bads.push(c);
    let mut c = good.clone();
    c.decimals0 = 19;
    bads.push(c);
    let mut c = good.clone();
    c.token1 = c.token0.clone();
    bads.push(c);
    for bad in bads {
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            f.env.register(ClVault, (bad.clone(),));
        }));
        assert!(r.is_err());
    }
}

#[test]
fn future_dated_oracle_price_is_refused() {
    let f = setup();
    let v = ClVaultClient::new(&f.env, &f.vault);
    v.deposit(&f.user, &(100 * UNIT), &(100 * UNIT));
    let oc = MockOracleClient::new(&f.env, &f.oracle);
    oc.set(&Asset::Stellar(f.t0.clone()), &ONE, &(1_000_000 + 5_000));
    assert_eq!(v.try_deposit(&f.user, &UNIT, &UNIT), Err(Ok(VaultError::OracleStale.into())));
}

#[test]
fn set_paused_emits_an_event() {
    let f = setup();
    let v = ClVaultClient::new(&f.env, &f.vault);
    v.set_paused(&true);
    use soroban_sdk::testutils::Events as _;
    assert_eq!(f.env.events().all().events().len(), 1);
}

/// CLP-012: first-depositor / donation inflation. The attacker deposits the smallest amount, then
/// donates X straight to the vault, then a victim deposits. With the virtual offset the attacker
/// never ends up with more than they put in, the victim is never minted zero, and the victim's
/// loss stays under a small multiple of X / VIRTUAL_OFFSET.
#[test]
fn donation_inflation_does_not_pay_the_attacker() {
    for donation in [1i128, 1_000, 10_000, 1_000_000, 100 * UNIT, 5_000 * UNIT] {
        let f = setup();
        let v = ClVaultClient::new(&f.env, &f.vault);
        let t1 = TokenClient::new(&f.env, &f.t1);
        let attacker = f.user.clone();
        let victim = Address::generate(&f.env);
        StellarAssetClient::new(&f.env, &f.t1).mint(&victim, &(1_000 * UNIT));
        let attacker_start = t1.balance(&attacker);
        // attacker: 1 raw unit of token1, then a direct transfer ("donation") to the vault
        let a_shares = v.deposit(&attacker, &0, &1);
        assert_eq!(a_shares, 1);
        t1.transfer(&attacker, &f.vault, &donation);
        // victim deposits 1000 tokens of token1
        let deposit = 1_000 * UNIT;
        let v_shares = v.deposit(&victim, &0, &deposit);
        assert!(v_shares > 0, "victim minted zero shares at donation {donation}");
        // everybody leaves
        v.withdraw(&attacker, &a_shares);
        v.withdraw(&victim, &v_shares);
        let attacker_end = t1.balance(&attacker);
        assert!(attacker_end <= attacker_start, "attacker profited at donation {donation}: {attacker_start} -> {attacker_end}");
        let victim_back = t1.balance(&victim);
        let victim_loss = 1_000 * UNIT - victim_back;
        // bound: dilution by the virtual holder plus rounding driven by the donation
        let bound = donation / VIRTUAL_OFFSET * 2 + deposit * VIRTUAL_OFFSET / (deposit + VIRTUAL_OFFSET) + 10;
        assert!(victim_loss <= bound, "victim lost {victim_loss} > bound {bound} at donation {donation}");
    }
}

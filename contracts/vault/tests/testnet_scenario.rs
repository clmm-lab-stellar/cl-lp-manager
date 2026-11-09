// SPDX-License-Identifier: Apache-2.0
//! CLP-017: the exact scenario `scripts/testnet-vault.ts` runs on testnet, run here first against
//! the deployable demo pool and demo oracle (not the in-file test mocks). Parameters must match
//! the script's `SCENARIO` constant.
use sik_cl_lp_manager_demo_oracle::{Asset as OAsset, DemoOracle, DemoOracleClient};
use sik_cl_lp_manager_demo_pool::{DemoPool, DemoPoolClient};
use sik_cl_lp_manager_vault::{ClVault, ClVaultClient, Config, VaultError};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, U256,
};

const UNIT: i128 = 10_000_000;
const ONE: i128 = 100_000_000_000_000; // 1.0 at 14 oracle decimals

/// sqrt(price) * 2^96, by integer square root of price * 2^192 (price given as num/den).
fn sqrt_x96(env: &Env, num: u128, den: u128) -> U256 {
    // isqrt(num/den * 2^192) = isqrt(num * 2^192 / den); 2^192 / den fits for den <= 1e6.
    let target = U256::from_u128(env, 1).shl(192).div(&U256::from_u128(env, den)).mul(&U256::from_u128(env, num));
    // Newton iteration on U256.
    let mut x = U256::from_u128(env, 1).shl(96);
    for _ in 0..200 {
        let y = x.add(&target.div(&x)).shr(1);
        if y == x {
            break;
        }
        x = y;
    }
    x
}

#[test]
fn testnet_scenario_against_demo_contracts() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_800_000_000);
    let admin = Address::generate(&env);
    let keeper = Address::generate(&env);
    let user = Address::generate(&env);
    let t0 = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let t1 = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let oracle = env.register(DemoOracle, (admin.clone(),));
    let pool = env.register(DemoPool, (admin.clone(), t0.clone(), t1.clone(), 10i32, 5u32));
    let oc = DemoOracleClient::new(&env, &oracle);
    let pc = DemoPoolClient::new(&env, &pool);
    let assets = vec![&env, OAsset::Stellar(t0.clone()), OAsset::Stellar(t1.clone())];
    oc.set_prices(&assets, &vec![&env, ONE, ONE], &0);
    StellarAssetClient::new(&env, &t0).mint(&pool, &(100_000 * UNIT));
    StellarAssetClient::new(&env, &t1).mint(&pool, &(100_000 * UNIT));
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
    let v = ClVaultClient::new(&env, &vault);
    assert_eq!((v.get_state().tick_lower, v.get_state().tick_upper), (-30, 30));

    // 1. deposit
    assert_eq!(v.deposit(&user, &(1_000 * UNIT), &(1_000 * UNIT)), 2_000 * UNIT);
    // 2. in range: refused
    assert_eq!(v.try_rebalance(), Err(Ok(VaultError::InRange.into())));
    // 3. pool moves to 1.004 (tick 40); oracle agrees but is an hour old: refused stale
    pc.set_slot(&sqrt_x96(&env, 1004, 1000), &40);
    oc.set_prices(&assets, &vec![&env, ONE + ONE * 4 / 1000, ONE], &3_600);
    assert_eq!(v.try_rebalance(), Err(Ok(VaultError::OracleStale.into())));
    // 4. fresh oracle 1% away from the pool: refused deviation
    oc.set_prices(&assets, &vec![&env, ONE + ONE * 14 / 1000, ONE], &0);
    assert_eq!(v.try_rebalance(), Err(Ok(VaultError::PriceDeviation.into())));
    // 5. fresh oracle agrees: rebalance re-centres on tick 40
    oc.set_prices(&assets, &vec![&env, ONE + ONE * 4 / 1000, ONE], &0);
    assert_eq!(v.rebalance(), (10, 70));
    let st = v.get_state();
    assert_eq!(st.rebalances, 1);
    // the 50/50 swap sold about 1 token0 (value split at 1.004), so token0 < token1 in the position
    let held0 = TokenClient::new(&env, &t0).balance(&pool);
    assert!(held0 > 100_000 * UNIT, "pool received token0 from the vault swap");
    // 6. pool moves again right away: refused cooldown
    pc.set_slot(&sqrt_x96(&env, 1020, 1000), &200);
    oc.set_prices(&assets, &vec![&env, ONE + ONE * 20 / 1000, ONE], &0);
    assert_eq!(v.try_rebalance(), Err(Ok(VaultError::Cooldown.into())));
    // 7. withdraw half the shares, with the oracle stale (exits are not oracle-gated)
    oc.set_prices(&assets, &vec![&env, ONE, ONE], &86_400);
    let (o0, o1) = v.withdraw(&user, &(1_000 * UNIT));
    assert!(o0 > 0 && o1 > 0);
    // value at 1.004 conserved up to the 5 bps swap fee and rounding: half of 1,004 + 1,000
    let value = o0 * 1004 / 1000 + o1;
    assert!(value > 1_001 * UNIT && value <= 1_002 * UNIT, "withdrew value {value}");
    assert_eq!(v.shares(&user), 1_000 * UNIT);
}

#[test]
fn sqrt_helper_matches_known_values() {
    let env = Env::default();
    assert_eq!(sqrt_x96(&env, 1, 1), U256::from_u128(&env, 1).shl(96));
    assert_eq!(sqrt_x96(&env, 4, 1), U256::from_u128(&env, 2).shl(96));
}

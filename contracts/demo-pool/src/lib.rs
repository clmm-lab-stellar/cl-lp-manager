// SPDX-License-Identifier: Apache-2.0
//! TESTNET DEMO ONLY (CLP-017). A minimal stand-in for an Aquarius concentrated pool, so the
//! vault's oracle-bounded rebalance can be exercised on testnet with contracts we control.
//!
//! What it is NOT: it is not Aquarius and not an AMM. A position keeps exactly the token
//! amounts deposited into it (no price-dependent composition), "liquidity" is the raw sum of
//! those amounts, and the pool price only moves when the admin calls `set_slot`. Swaps settle at
//! the admin-set price minus `fee_bps`. It exists to drive the vault through its guard paths.
//!
//! Same function names and signatures as the subset of the Aquarius pool the vault calls
//! (SPEC.md 2.3 / 5.1), so the vault code is unchanged between this and a real pool.
#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token::TokenClient, vec, Address, Env, Vec, U256};

/// Same shape as the Aquarius `get_slot0` return value.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Slot0 {
    pub sqrt_price_x96: U256,
    pub tick: i32,
}

#[contracttype]
#[derive(Clone)]
enum PK {
    Admin,
    T0,
    T1,
    Slot,
    Spacing,
    Fee,
    Pos(Address, i32, i32),
    Fees(Address),
}

const PRICE_SCALE: i128 = 1_000_000_000;
const DAY: u32 = 17_280;

/// Raw price (token1 raw per token0 raw) x 1e9 from sqrt_price_x96; same formula as the vault.
fn price_scaled(env: &Env, sqrt_price_x96: &U256) -> i128 {
    let s = sqrt_price_x96.shr(48);
    let v = s.mul(&s).mul(&U256::from_u128(env, PRICE_SCALE as u128)).shr(96);
    v.to_u128().filter(|x| *x <= i128::MAX as u128).expect("price overflow") as i128
}

fn bump(env: &Env) {
    env.storage().instance().extend_ttl(30 * DAY, 90 * DAY);
}

fn get<V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(env: &Env, k: &PK) -> V {
    env.storage().instance().get(k).expect("not initialised")
}

#[contract]
pub struct DemoPool;

#[contractimpl]
impl DemoPool {
    pub fn __constructor(env: Env, admin: Address, t0: Address, t1: Address, spacing: i32, fee_bps: u32) {
        assert!(spacing > 0 && fee_bps < 10_000, "bad config");
        let st = env.storage().instance();
        st.set(&PK::Admin, &admin);
        st.set(&PK::T0, &t0);
        st.set(&PK::T1, &t1);
        st.set(&PK::Spacing, &spacing);
        st.set(&PK::Fee, &fee_bps);
        st.set(&PK::Slot, &Slot0 { sqrt_price_x96: U256::from_u128(&env, 1u128 << 96), tick: 0 });
        bump(&env);
    }

    /// Admin-only: move the pool price (stands in for market activity, which testnet lacks).
    pub fn set_slot(env: Env, sqrt_price_x96: U256, tick: i32) {
        get::<Address>(&env, &PK::Admin).require_auth();
        env.storage().instance().set(&PK::Slot, &Slot0 { sqrt_price_x96, tick });
        bump(&env);
    }

    /// Admin-only: credit claimable fees to a position owner (paid from the pool's balance).
    pub fn add_fees(env: Env, owner: Address, f0: i128, f1: i128) {
        get::<Address>(&env, &PK::Admin).require_auth();
        assert!(f0 >= 0 && f1 >= 0, "negative fees");
        env.storage().instance().set(&PK::Fees(owner), &(f0, f1));
        bump(&env);
    }

    pub fn get_slot0(env: Env) -> Slot0 {
        get(&env, &PK::Slot)
    }

    pub fn get_tick_spacing(env: Env) -> i32 {
        get(&env, &PK::Spacing)
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
        assert!(tick_lower < tick_upper, "bad range");
        let a0 = desired_amounts.get(0).unwrap_or(0) as i128;
        let a1 = desired_amounts.get(1).unwrap_or(0) as i128;
        let me = env.current_contract_address();
        if a0 > 0 {
            TokenClient::new(&env, &get(&env, &PK::T0)).transfer(&sender, &me, &a0);
        }
        if a1 > 0 {
            TokenClient::new(&env, &get(&env, &PK::T1)).transfer(&sender, &me, &a1);
        }
        let key = PK::Pos(sender, tick_lower, tick_upper);
        let (p0, p1, l): (i128, i128, u128) = env.storage().instance().get(&key).unwrap_or((0, 0, 0));
        let liq = (a0 + a1) as u128;
        env.storage().instance().set(&key, &(p0 + a0, p1 + a1, l + liq));
        bump(&env);
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
        let (p0, p1, l): (i128, i128, u128) = env.storage().instance().get(&key).expect("no position");
        assert!(amount > 0 && amount <= l, "withdraw more than liquidity");
        let o0 = p0 * amount as i128 / l as i128;
        let o1 = p1 * amount as i128 / l as i128;
        if amount == l {
            env.storage().instance().remove(&key);
        } else {
            env.storage().instance().set(&key, &(p0 - o0, p1 - o1, l - amount));
        }
        let me = env.current_contract_address();
        if o0 > 0 {
            TokenClient::new(&env, &get(&env, &PK::T0)).transfer(&me, &owner, &o0);
        }
        if o1 > 0 {
            TokenClient::new(&env, &get(&env, &PK::T1)).transfer(&me, &owner, &o1);
        }
        bump(&env);
        vec![&env, o0 as u128, o1 as u128]
    }

    pub fn claim_position_fees(env: Env, owner: Address, _tick_lower: i32, _tick_upper: i32) -> Vec<u128> {
        owner.require_auth();
        let key = PK::Fees(owner.clone());
        let (f0, f1): (i128, i128) = env.storage().instance().get(&key).unwrap_or((0, 0));
        env.storage().instance().remove(&key);
        let me = env.current_contract_address();
        if f0 > 0 {
            TokenClient::new(&env, &get(&env, &PK::T0)).transfer(&me, &owner, &f0);
        }
        if f1 > 0 {
            TokenClient::new(&env, &get(&env, &PK::T1)).transfer(&me, &owner, &f1);
        }
        bump(&env);
        vec![&env, f0 as u128, f1 as u128]
    }

    /// Swaps at the admin-set slot price, charging fee_bps; reverts below out_min.
    pub fn swap(env: Env, user: Address, in_idx: u32, out_idx: u32, in_amount: u128, out_min: u128) -> u128 {
        user.require_auth();
        assert!(in_idx < 2 && out_idx < 2 && in_idx != out_idx, "bad index");
        let slot: Slot0 = get(&env, &PK::Slot);
        let price = price_scaled(&env, &slot.sqrt_price_x96);
        assert!(price > 0, "zero price");
        let fee: u32 = get(&env, &PK::Fee);
        let amt = in_amount as i128;
        let gross = if in_idx == 0 { amt * price / PRICE_SCALE } else { amt * PRICE_SCALE / price };
        let out = gross * (10_000 - fee as i128) / 10_000;
        assert!(out >= 0 && out as u128 >= out_min, "slippage");
        let (tin, tout): (Address, Address) =
            if in_idx == 0 { (get(&env, &PK::T0), get(&env, &PK::T1)) } else { (get(&env, &PK::T1), get(&env, &PK::T0)) };
        let me = env.current_contract_address();
        TokenClient::new(&env, &tin).transfer(&user, &me, &amt);
        if out > 0 {
            TokenClient::new(&env, &tout).transfer(&me, &user, &out);
        }
        bump(&env);
        out as u128
    }
}

#[cfg(test)]
mod test {
    extern crate std;
    use super::*;
    use soroban_sdk::{testutils::Address as _, token::StellarAssetClient};

    #[test]
    fn set_slot_is_admin_only_and_swap_uses_it() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let t0 = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let t1 = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let pool = env.register(DemoPool, (admin.clone(), t0.clone(), t1.clone(), 10i32, 5u32));
        let c = DemoPoolClient::new(&env, &pool);
        // No auth mocked: admin-only call fails.
        assert!(c.try_set_slot(&U256::from_u128(&env, 2u128 << 96), &13863).is_err());
        env.mock_all_auths();
        StellarAssetClient::new(&env, &t0).mint(&pool, &1_000_000);
        StellarAssetClient::new(&env, &t1).mint(&pool, &1_000_000);
        StellarAssetClient::new(&env, &t0).mint(&user, &1_000);
        // price 4 (sqrt 2): 1000 token0 -> 4000 * (1 - 5 bps) = 3998 token1
        c.set_slot(&U256::from_u128(&env, 2u128 << 96), &13863);
        assert_eq!(c.swap(&user, &0, &1, &1_000, &3_998), 3_998);
        assert!(c.try_swap(&user, &1, &0, &4_000, &1_001).is_err());
    }

    #[test]
    fn positions_return_what_was_deposited() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let lp = Address::generate(&env);
        let t0 = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let t1 = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let pool = env.register(DemoPool, (admin.clone(), t0.clone(), t1.clone(), 10i32, 5u32));
        let c = DemoPoolClient::new(&env, &pool);
        StellarAssetClient::new(&env, &t0).mint(&lp, &100);
        StellarAssetClient::new(&env, &t1).mint(&lp, &300);
        let (_, liq) = c.deposit_position(&lp, &-10, &10, &vec![&env, 100u128, 300u128], &0);
        assert_eq!(liq, 400);
        assert_eq!(c.withdraw_position(&lp, &-10, &10, &200, &vec![&env, 0u128, 0u128]), vec![&env, 50u128, 150u128]);
        assert_eq!(c.withdraw_position(&lp, &-10, &10, &200, &vec![&env, 0u128, 0u128]), vec![&env, 50u128, 150u128]);
        assert!(c.try_withdraw_position(&lp, &-10, &10, &1, &vec![&env, 0u128, 0u128]).is_err());
    }
}

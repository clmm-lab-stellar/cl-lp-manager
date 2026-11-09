// SPDX-License-Identifier: Apache-2.0
//! TESTNET DEMO ONLY (CLP-017). An admin-set price feed with the SEP-40 `lastprice` / `decimals`
//! shape the vault reads. Not a real oracle: prices are whatever the admin writes. `age_secs`
//! back-dates the timestamp so the vault's staleness guard can be shown on testnet.
#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, Symbol, Vec};

/// SEP-40 asset identifier (same shape as the vault's).
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

#[contracttype]
#[derive(Clone)]
enum OK {
    Admin,
    Prices,
}

pub const DECIMALS: u32 = 14;
const DAY: u32 = 17_280;

#[contract]
pub struct DemoOracle;

#[contractimpl]
impl DemoOracle {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&OK::Admin, &admin);
        env.storage().instance().extend_ttl(30 * DAY, 90 * DAY);
    }

    /// Admin-only. Sets `prices[i]` for `assets[i]`, stamped `now - age_secs`.
    pub fn set_prices(env: Env, assets: Vec<Asset>, prices: Vec<i128>, age_secs: u64) {
        let admin: Address = env.storage().instance().get(&OK::Admin).expect("not initialised");
        admin.require_auth();
        assert!(assets.len() == prices.len() && !assets.is_empty(), "length mismatch");
        let ts = env.ledger().timestamp().saturating_sub(age_secs);
        let mut m: Map<Asset, PriceData> = env.storage().instance().get(&OK::Prices).unwrap_or(Map::new(&env));
        for (a, p) in assets.iter().zip(prices.iter()) {
            assert!(p > 0, "price must be positive");
            m.set(a, PriceData { price: p, timestamp: ts });
        }
        env.storage().instance().set(&OK::Prices, &m);
        env.storage().instance().extend_ttl(30 * DAY, 90 * DAY);
    }

    pub fn lastprice(env: Env, asset: Asset) -> Option<PriceData> {
        let m: Map<Asset, PriceData> = env.storage().instance().get(&OK::Prices).unwrap_or(Map::new(&env));
        m.get(asset)
    }

    pub fn decimals(_env: Env) -> u32 {
        DECIMALS
    }
}

#[cfg(test)]
mod test {
    extern crate std;
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        vec,
    };

    #[test]
    fn admin_sets_backdated_prices() {
        let env = Env::default();
        env.ledger().with_mut(|l| l.timestamp = 10_000);
        let admin = Address::generate(&env);
        let id = env.register(DemoOracle, (admin.clone(),));
        let c = DemoOracleClient::new(&env, &id);
        let a = Asset::Stellar(Address::generate(&env));
        assert!(c.try_set_prices(&vec![&env, a.clone()], &vec![&env, 5i128], &0).is_err());
        env.mock_all_auths();
        c.set_prices(&vec![&env, a.clone()], &vec![&env, 5i128], &3_600);
        assert_eq!(c.lastprice(&a), Some(PriceData { price: 5, timestamp: 6_400 }));
        assert_eq!(c.lastprice(&Asset::Other(Symbol::new(&env, "X"))), None);
        assert_eq!(c.decimals(), 14);
    }
}

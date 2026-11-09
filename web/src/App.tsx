// SPDX-License-Identifier: Apache-2.0
import { ChartLineUp, CoinVertical, House, ListChecks, Vault as VaultIcon } from '@phosphor-icons/react';
import { lazy, Suspense } from 'react';
import { AppShell, GateBadge, Skeleton } from './ui/kit';
import { href, useRoute } from './lib/route';
import { Overview } from './views/Overview';
import { Explorer } from './views/Explorer';
import { Fees } from './views/Fees';
import { Status } from './views/Status';

// The vault view pulls in the Stellar SDK for its live read; load it only when opened.
const Vault = lazy(() => import('./views/Vault').then((m) => ({ default: m.Vault })));

export function App() {
  const route = useRoute();
  const nav = [
    { label: 'Overview', href: href('overview'), active: route.view === 'overview', icon: <House /> },
    { label: 'Backtest explorer', href: href('explore'), active: route.view === 'explore', icon: <ChartLineUp /> },
    { label: 'Fee volume', href: href('fees'), active: route.view === 'fees', icon: <CoinVertical /> },
    { label: 'Testnet vault', href: href('vault'), active: route.view === 'vault', icon: <VaultIcon /> },
    { label: 'Status and limits', href: href('status'), active: route.view === 'status', icon: <ListChecks /> },
  ];
  return (
    <AppShell
      project={{ name: 'CL LP Manager', code: 'CLP', family: 'Markets and liquidity data', href: href('overview') }}
      gates={
        <>
          <GateBadge kind="mainnet-read-only" />
          <GateBadge kind="testnet-only" />
          <GateBadge kind="unaudited" />
          <GateBadge kind="demo-only" />
        </>
      }
      nav={nav}
      honesty="Mainnet data is read-only and recorded. The vault runs on testnet only, with throwaway keys. Every figure shows where it came from."
    >
      {route.view === 'overview' && <Overview />}
      {route.view === 'explore' && <Explorer initialPool={route.params.get('pool')} />}
      {route.view === 'fees' && <Fees />}
      {route.view === 'vault' && (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <Vault />
        </Suspense>
      )}
      {route.view === 'status' && <Status />}
    </AppShell>
  );
}

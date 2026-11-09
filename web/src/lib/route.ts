// SPDX-License-Identifier: Apache-2.0
// Hash routing: #/ (overview), #/explore?pool=..., #/fees, #/vault, #/status.
import { useEffect, useState } from 'react';

export type View = 'overview' | 'explore' | 'fees' | 'vault' | 'status';

export interface Route {
  view: View;
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = h.split('?');
  const view: View = (['explore', 'fees', 'vault', 'status'] as const).find((v) => v === path) ?? 'overview';
  return { view, params: new URLSearchParams(query) };
}

export function href(view: View, params?: Record<string, string>): string {
  const q = params ? new URLSearchParams(params).toString() : '';
  return `#/${view === 'overview' ? '' : view}${q ? `?${q}` : ''}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

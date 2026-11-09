// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Static build (dist/), relative base so it can be served from any path.
// The backtest engine and the testnet decoders are imported from ../src (the same code the CLI
// and tests run); dedupe keeps one copy of the Stellar SDK in the bundle.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: { dedupe: ['@stellar/stellar-sdk'] },
  server: { fs: { allow: ['..'] } },
  build: { chunkSizeWarningLimit: 1600 },
});

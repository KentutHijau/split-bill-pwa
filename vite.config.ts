/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const environment = (
  globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  }
).process?.env;
const repositoryName = environment?.GITHUB_REPOSITORY?.split('/').at(-1);
const isGitHubActions = environment?.GITHUB_ACTIONS === 'true';
const base = isGitHubActions && repositoryName ? `/${repositoryName}/` : '/';
const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      scope: base,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Makan Split',
        short_name: 'Makan Split',
        description: 'Split restaurant bills fairly',
        theme_color: '#f5673a',
        background_color: '#fffaf3',
        display: 'standalone',
        id: base,
        start_url: base,
        scope: base,
        icons: [
          {
            src: `${base}icon.svg`,
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [new RegExp(`^${escapedBase}share/`)],
        runtimeCaching: [],
      },
    }),
  ],
  test: { environment: 'node' },
});

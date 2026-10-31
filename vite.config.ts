import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Project-site base for https://8fjr29kfvb-collab.github.io/mossgate-puzzles/
// Dev stays at / so local links are / and /play/.
const pagesBase = '/mossgate-puzzles/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? pagesBase : '/',
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        play: fileURLToPath(new URL('./play/index.html', import.meta.url)),
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 41773,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 41773,
    strictPort: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 30_000,
  },
}));

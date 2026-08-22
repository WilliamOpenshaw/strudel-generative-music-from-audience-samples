import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    dedupe: [
      '@strudel/core',
      '@strudel/webaudio',
      '@strudel/mini',
      '@strudel/tonal',
      '@strudel/draw',
    ],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        audience: resolve(__dirname, 'audience.html'),
      },
    },
  },
});

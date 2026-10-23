import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages: https://ayun-jeong.github.io/ayun-pad/
export default defineConfig({
  base: '/ayun-pad/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    setupFiles: ['./tests/setup.js'],
    // Las APIs reales pueden tardar: damos margen a cada test.
    testTimeout: 15_000,
    // Reintenta una vez si falla por un problema de red puntual.
    retry: 1,
  },
});

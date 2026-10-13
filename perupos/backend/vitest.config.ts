import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Los tests comparten una base de datos: se ejecutan uno tras otro.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://perupos:perupos@localhost:5432/perupos_test',
      UPLOAD_DIR: 'test/.uploads',
      JWT_SECRET: 'test-secret-de-al-menos-32-caracteres!!',
      PAYMENTS_PROVIDER: 'mock',
      PSE_PROVIDER: 'mock',
      PUSH_ENABLED: 'false',
      JOBS_ENABLED: 'false',
    },
  },
});

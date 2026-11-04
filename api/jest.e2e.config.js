/** End-to-end tests: real HTTP calls against a real PostgreSQL test database (DATABASE_URL_TEST). */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'test/tsconfig.json' }] },
  testTimeout: 30000,
};

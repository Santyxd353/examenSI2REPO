module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/scripts/test-env.cjs'],
  testMatch: ['**/apps/api/test/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'apps/api/tsconfig.jest.json' }],
  },
  testTimeout: 30000,
  maxWorkers: 1,
};

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Test file patterns
    include: ['tests/**/*.test.js'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['lib/**/*.js'],
      exclude: [
        'lib/test-workflow.js', // Existing test file
        'lib/index.js', // Just re-exports
      ],
      thresholds: {
        // Target coverage levels
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60,
      },
    },

    // Timeout for async tests
    testTimeout: 10000,

    // Reporter settings
    reporters: ['default'],

    // Watch mode settings
    watch: false,

    // Global setup/teardown
    globalSetup: undefined,
  },
});

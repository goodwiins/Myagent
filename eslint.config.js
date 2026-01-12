import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',  // Node.js 18+ native fetch
      },
    },
    rules: {
      // Error prevention
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],

      // Code quality
      'no-empty': ['warn', { allowEmptyCatch: false }],
      'no-empty-function': 'warn',
      'prefer-const': 'warn',
      'no-var': 'error',

      // Style (relaxed)
      'semi': ['warn', 'always'],
      'quotes': ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
      'comma-dangle': ['warn', 'always-multiline'],

      // Async/Promise
      'no-async-promise-executor': 'error',
      'require-await': 'off', // Too noisy for wrapper functions
    },
  },
  {
    // Ignore patterns
    ignores: [
      'node_modules/**',
      '.goodflows/**',
      'coverage/**',
      'dist/**',
    ],
  },
];

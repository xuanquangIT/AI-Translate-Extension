import js from '@eslint/js';
import globals from 'globals';

/** Lint rules focus on correctness; formatting belongs to Prettier. */
export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.zip', '.local-mt/**', '.claude/worktrees/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }]
    }
  },
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } }
  },
  {
    files: ['src/content/**/*.js'],
    languageOptions: { sourceType: 'script' }
  },
  {
    files: ['src/background/**/*.js'],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.webextensions } }
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' }
  }
];

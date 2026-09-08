// Flat config (ESLint 9). Pragmatic by design: this exists so `npm run lint`
// catches real mistakes (unused bindings, accidental reassignment, broken hook
// deps), not to enforce a house style — formatting rules are switched off at the
// end by eslint-config-prettier.
import js from '@eslint/js'
import globals from 'globals'
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

/** Rules shared by every TypeScript block; the TS-aware unused-vars replaces the core one. */
const tsRules = {
  ...tsPlugin.configs.recommended.rules,
  // TypeScript already resolves identifiers, and core no-undef cannot see
  // type-space globals such as the `React` namespace — it only produces false
  // positives here. This is typescript-eslint's own recommendation.
  'no-undef': 'off',
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': [
    'warn',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
  ],
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-empty-object-type': 'warn',
  'no-console': 'warn',
  'prefer-const': 'error',
}

export default [
  {
    ignores: [
      '**/node_modules/**',
      'dist/**',
      'server/dist/**',
      '**/*.test.js',
      'vite.config.js',
      'vite.config.d.ts',
      '**/*.tsbuildinfo',
    ],
  },

  js.configs.recommended,

  // Backend: Node globals, TypeScript.
  {
    files: ['server/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: tsRules,
  },

  // Plain-Node maintenance scripts (no TypeScript, no build step).
  {
    files: ['scripts/**/*.mjs', 'server/scripts/**/*.mjs', '*.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': 'off', // these scripts talk to the operator through stdout
      'prefer-const': 'error',
    },
  },

  // Frontend: browser globals, TypeScript, React + hooks.
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.jsx', 'vite.config.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react,
      'react-hooks': reactHooks,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...tsRules,
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs['recommended-latest'].rules,
      // React Compiler diagnostics shipped with react-hooks v6. They flag real
      // patterns (fetch-on-mount effects that setState, a callback referenced
      // above its declaration) but clearing them means restructuring every page's
      // data loading, so they stay visible as warnings instead.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/immutability': 'warn',
      // The new JSX transform means React need not be in scope or imported.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
    },
  },

  prettier,
]

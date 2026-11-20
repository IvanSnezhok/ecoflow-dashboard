// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', '.expo/*'] },
  {
    // "@panel/..." is the web panel's src/, resolved by tsconfig paths and metro.config.js
    settings: { 'import/resolver': { typescript: { project: './tsconfig.json' } } },
    rules: { 'import/no-unresolved': ['error', { ignore: ['^@panel/'] }] },
  },
]);

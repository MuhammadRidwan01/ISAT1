import js from '@eslint/js';
export default [
  { ignores: ['bench/**', 'dist/**', 'node_modules/**'] },
  js.configs.recommended,
  { languageOptions: { globals: { process: 'readonly', console: 'readonly' } } },
];
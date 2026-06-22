import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['out/**', 'dist-builder/**', 'node_modules/**'] },

  // Main + preload run in Node.
  {
    files: ['src/main/**/*.{js,ts}', 'src/preload/**/*.{js,ts}', 'electron.vite.config.ts'],
    languageOptions: { globals: globals.node },
  },

  // Renderer runs in the browser.
  {
    files: ['src/renderer/**/*.{js,jsx,ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // React rules apply to the renderer only.
  {
    files: ['src/renderer/**/*.{jsx,tsx}'],
    ...react.configs.flat.recommended,
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off', // new JSX transform
      'react/prop-types': 'off', // types come from TS, not prop-types
    },
  },

  // Pragmatic relaxations while the JS→TS migration is in progress.
  {
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },

  prettier,
);

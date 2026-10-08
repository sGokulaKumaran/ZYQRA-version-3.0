import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Pages load their data in an effect when they come into view; this rule
      // also flags those async loaders, which only set state after awaiting.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // A context file exports its provider together with its hook.
    files: ['src/context/**'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])

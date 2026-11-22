import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import vue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['**/dist/', '**/.nuxt/', '**/.output/', 'backend/drizzle/', 'web/']),
  {
    files: ['eslint.config.mjs'],
    extends: [js.configs.recommended],
  },
  {
    files: ['{backend,mini-app}/**/*.ts', 'mini-app/**/*.vue'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  vue.configs['flat/essential'],
  {
    files: ['mini-app/**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      // Nuxt typecheck resolves and checks auto-imports in Vue scripts.
      'no-undef': 'off',
    },
  },
)

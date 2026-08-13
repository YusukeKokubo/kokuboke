import eslint from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'android/**', 'node_modules/**', 'scratchpad/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'server/**/*.ts', 'shared/**/*.ts'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // plugin の recommended は React Compiler 向けが大量に入る。
      // 足しすぎない方針なので、古典の Hooks 二則だけから始める。
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
)

import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

// Flat-config port of the previous .eslintrc.json (ESLint 9 dropped the old
// format). Same base — next/core-web-vitals — and the same unused-vars rule.

// eslint-plugin-react-hooks 7 (pulled in by eslint-config-next 16) adds the
// React Compiler rules on top of the two classic ones. This app does not use
// the compiler, and the new rules flag ~380 long-standing patterns as errors —
// which would fail `next build`. Keep exactly the rules the project had.
const CLASSIC_HOOK_RULES = ['rules-of-hooks', 'exhaustive-deps']
const compilerRulesOff = Object.fromEntries(
  Object.keys(reactHooks.rules)
    .filter(name => !CLASSIC_HOOK_RULES.includes(name))
    .map(name => [`react-hooks/${name}`, 'off']),
)

const config = [
  { ignores: ['.next/', 'out/', 'build/', 'next-env.d.ts', 'public/'] },
  ...nextCoreWebVitals,
  {
    // ESLint 9 reports stale eslint-disable comments by default; 8 did not.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      ...compilerRulesOff,
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
      }],
    },
  },
]

export default config

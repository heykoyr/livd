import js from '@eslint/js';
import next from 'eslint-config-next/core-web-vitals';

/**
 * ESLint, flat config.
 *
 * `next lint` was removed in Next 16, and this project never had a config file
 * to migrate to — `npm run lint` had simply never run. The `lint` script now
 * invokes ESLint directly.
 *
 * `core-web-vitals` is the stricter of the two Next presets: it promotes the
 * rules that cost real users real milliseconds — unoptimised images, sync
 * scripts, blocking font loads — from warning to error. It brings React,
 * react-hooks, jsx-a11y, import and the TypeScript parser with it, but it does
 * not include `eslint:recommended`, so that is added here: the base set is
 * where `no-control-regex`, `no-fallthrough` and the other genuine-bug rules
 * live.
 *
 * Two `files` globs appear below and both are deliberate. A flat-config rule
 * can only be named where its plugin is in scope, and the plugins Next
 * registers are scoped to the extensions it lists — `.cjs` is not among them.
 * A rules block with no `files` therefore applies to `scripts/*.cjs` too and
 * fails to resolve the plugin name at all.
 */

/** Exactly the extensions `eslint-config-next` registers its plugins for. */
const NEXT_FILES = ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'];

const config = [
  {
    ignores: ['.next/**', '.data/**', '.seed-sql/**', 'node_modules/**', 'next-env.d.ts'],
  },

  js.configs.recommended,
  ...next,

  {
    rules: {
      // `catch {}` is used deliberately where the failure is genuinely not
      // actionable — reading a theme out of localStorage in a private window,
      // say — and every one of those carries a comment saying so. Anywhere
      // else, a swallowed error is a defect.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  {
    files: NEXT_FILES,
    rules: {
      // Livd ships no <img>. If one is ever needed it will be a remote
      // property photo, and next/image's loader is the wrong tool for a URL
      // the CSP does not allow loading anyway. Revisit if that changes.
      '@next/next/no-img-element': 'off',

      // Not in Next's a11y subset. The codebase already suppresses it in the
      // one place autofocus is justified — the dedicated search page, where
      // the field is the point of the page — so enabling it keeps that
      // suppression meaningful rather than decorative.
      'jsx-a11y/no-autofocus': ['error', { ignoreNonDOM: true }],

      // This flags a pattern here rather than a defect. Every occurrence is an
      // effect synchronising React with something outside it that the server
      // could not have known: a theme applied by a pre-paint script, a draft
      // in localStorage, a debounced fetch, the result of a server action, a
      // drawer closing because the route changed. Rewriting them to satisfy
      // the React Compiler is real work with real regression risk, most of it
      // in the review wizard. Left visible as warnings so the list stays
      // honest, rather than switched off.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },

  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Three rules from `eslint:recommended` that TypeScript already does
      // better, and that misfire on TypeScript syntax. Turning them off for
      // .ts/.tsx is what typescript-eslint's own `eslint-recommended` overlay
      // does; it is written out here rather than pulled in, so the reason is
      // visible.
      //
      //   no-undef      — does not know about TS globals, so `React` in a JSX
      //                   namespace type reads as undefined. `tsc` catches a
      //                   genuinely undefined name, and catches it properly.
      //   no-unused-vars — counts the parameter names in a function *type* as
      //                   unused bindings. Replaced below by the
      //                   TypeScript-aware version of the same rule.
      //   no-redeclare  — an interface and a const may legitimately share a
      //                   name; declaration merging is a TypeScript feature.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-redeclare': 'off',

      // `next/typescript` registers the plugin but enables none of its rules,
      // and a rule can only be named where its plugin is in scope — hence the
      // matching `files` here.
      //
      // An unused import or binding is nearly always the residue of a change
      // that was not finished. A leading underscore is how to say
      // "deliberately unused".
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  {
    // Build and maintenance scripts are Node programs run by hand from a
    // terminal, not application code. Printing is the whole point of them.
    files: ['scripts/**', '*.mjs', '*.cjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', __dirname: 'readonly' },
    },
    rules: {
      'no-console': 'off',
    },
  },
];

export default config;

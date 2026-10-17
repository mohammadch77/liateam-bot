import next from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...next,
  ...nextTs,
  prettier,
  {
    rules: {
      // Database access only through src/server/repositories (and the db layer itself).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['pg', '@/lib/db', '@/lib/db/*'],
              message: 'Use a repository in src/server/repositories.',
            },
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
    },
  },
  {
    files: ['src/lib/db/**', 'src/server/repositories/**', 'scripts/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['src/lib/logger/**', 'scripts/**', 'tests/**'],
    rules: { 'no-console': 'off' },
  },
];

export default config;

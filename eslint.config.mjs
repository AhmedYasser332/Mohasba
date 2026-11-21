import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'src/domain/* must stay 100% pure TypeScript.' },
            { name: 'react-dom', message: 'src/domain/* must stay 100% pure TypeScript.' },
            { name: 'idb', message: 'src/domain/* must stay 100% pure TypeScript.' },
            { name: 'fs', message: 'src/domain/* must not import Node APIs.' },
            { name: 'path', message: 'src/domain/* must not import Node APIs.' },
            { name: 'crypto', message: 'src/domain/* must not import Node APIs.' },
            { name: 'http', message: 'src/domain/* must not import Node APIs.' },
            { name: 'https', message: 'src/domain/* must not import Node APIs.' },
            { name: 'os', message: 'src/domain/* must not import Node APIs.' },
            { name: 'child_process', message: 'src/domain/* must not import Node APIs.' },
            { name: 'server-only', message: 'src/domain/* must stay 100% pure TypeScript.' },
          ],
          patterns: [
            { group: ['next', 'next/*'], message: 'src/domain/* must not import Next.js.' },
            { group: ['@supabase/*'], message: 'src/domain/* must not import Supabase.' },
            { group: ['node:*'], message: 'src/domain/* must not import Node built-ins.' },
            {
              group: [
                '@/client/*',
                '@/server/*',
                '@/app/*',
                '../client/*',
                '../server/*',
                '../app/*',
                '../../client/*',
                '../../server/*',
                '../../app/*',
              ],
              message: 'src/domain/* cannot depend on outer layers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/client/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'server-only', message: 'src/client/* cannot import server-only.' },
          ],
          patterns: [
            {
              group: ['@/server/*', '../server/*', '../../server/*', '../../../server/*'],
              message: 'src/client/* must never import src/server/*.',
            },
            {
              group: ['@supabase/*'],
              message: 'Client code must never import @supabase/* directly.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/server/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'server-only',
              message: 'Do not import server-only in src/server/* (breaks Cloudflare wrangler bundling).',
            },
            {
              name: 'next/headers',
              message: 'Use standard Web Request instead of next/headers.',
            },
            {
              name: 'next/cookies',
              message: 'Use standard Web Request instead of next/cookies.',
            },
            { name: 'react', message: 'src/server/* must not import React.' },
            { name: 'react-dom', message: 'src/server/* must not import React DOM.' },
          ],
          patterns: [
            {
              group: ['@/client/*', '../client/*', '../../client/*'],
              message: 'src/server/* must not import src/client/*.',
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;

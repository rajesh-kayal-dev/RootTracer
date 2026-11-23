import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'docs/**',
      'designs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx,mts,cts}'],
  })),
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'never' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@roottracer/*-service',
                '@roottracer/gateway',
                '**/*-service/**',
                '**/gateway/**',
              ],
              message:
                'Services communicate through contracts, never through another service implementation.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'apps/web/**/*.{ts,tsx}',
      'packages/sdk-node/src/**/*.{ts,mts,cts}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@roottracer/config',
                '@roottracer/logger',
                '@roottracer/*-service',
                '@roottracer/gateway',
                '**/services/**',
                '**/*-service/**',
                '**/gateway/**',
              ],
              message:
                'Frontend and SDK code must not import backend infrastructure or service implementations.',
            },
          ],
        },
      ],
    },
  },
];

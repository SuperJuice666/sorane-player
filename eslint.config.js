import globals from 'globals';

export default [
  { ignores: ['build/**', 'data/**', 'work/**', 'node_modules/**'] },
  {
    files: ['web/src/**/*.js'],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { caughtErrors: 'none', argsIgnorePattern: '^_' }],
      'no-unreachable': 'error',
    },
  },
];

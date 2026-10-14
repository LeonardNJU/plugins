import { defineConfig } from 'vitest/config';

// Unit tests of plugin logic: `<plugin>/test/*.test.mjs`. Keep the logic in
// plain ES modules under `<plugin>/src/lib/` so tests import it directly;
// `src/index.js` only wires it to the api.
export default defineConfig({
  test: {
    include: ['*/test/**/*.test.{js,mjs}', 'test-utils/**/*.test.{js,mjs}'],
    exclude: ['node_modules/**', 'e2e/**', 'test-env/**'],
    environment: 'node',
  },
});

import { defineConfig } from 'vitest/config';

/**
 * The specification suite's configuration.
 *
 * The setup file is the whole of it: the runner reports an unhandled rejection and exits zero, so without it a
 * specification can pass while a promise nothing observed carried a fault out of the code under test.
 */
export default defineConfig({ test: { setupFiles: ['./test/unhandled-rejections.ts'] } });

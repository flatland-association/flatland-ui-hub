// The frontend build every worker's backend serves (global-setup.ts builds it).
import { resolve } from 'node:path';

export const FRONTEND_DIR = resolve(__dirname, '../..');
/** `ng build --output-path dist/e2e` writes the app to its `browser/` folder. */
export const E2E_OUTPUT = resolve(FRONTEND_DIR, 'dist/e2e');
export const E2E_DIST = resolve(E2E_OUTPUT, 'browser');

/**
 * `E2E_BASE_URL` points the suite at an app that already runs (e.g. `npm run
 * start` on :4200 with its backend on :8000). Then nothing is built and no
 * backend is started, and failures cannot quote the backend log.
 */
export const EXTERNAL_BASE_URL = process.env['E2E_BASE_URL'];

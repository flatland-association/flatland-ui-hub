// Build the frontend once per run; every worker's backend serves this build
// (support/backend.ts). A development build, as start-demo.sh makes: faster to
// build, and console errors keep readable stack traces.
//
// E2E_SKIP_BUILD=1 reuses the last build (quick re-runs while only tests
// change). E2E_BASE_URL skips it, because the suite then runs against an app
// that is already up.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { E2E_DIST, EXTERNAL_BASE_URL, FRONTEND_DIR } from './build';

export default function globalSetup(): void {
  if (EXTERNAL_BASE_URL) return;
  if (process.env['E2E_SKIP_BUILD'] === '1') {
    if (!existsSync(join(E2E_DIST, 'index.html'))) {
      throw new Error(`E2E_SKIP_BUILD=1, but there is no earlier build in ${E2E_DIST}`);
    }
    return;
  }
  const started = Date.now();
  process.stdout.write('E2E: building the frontend (development) into dist/e2e …\n');
  try {
    execFileSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['ng', 'build', '--configuration', 'development', '--output-path', 'dist/e2e'],
      { cwd: FRONTEND_DIR, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    const { stdout = '', stderr = '' } = err as { stdout?: string; stderr?: string };
    throw new Error(`E2E: ng build failed:\n${stdout}\n${stderr}`);
  }
  process.stdout.write(`E2E: build done in ${Math.round((Date.now() - started) / 1000)} s\n`);
}

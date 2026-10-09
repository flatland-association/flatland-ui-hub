// One backend process per Playwright worker.
//
// Each worker starts its own `uvicorn app.main:app` on 127.0.0.1:<8100 + the
// worker's parallel index>, serving the frontend build from global-setup.ts the
// way start-demo.sh does (same origin, so the app talks to that backend only).
// Work a test leaves behind cannot slow another worker's tests, and a failure
// can name the backend error behind it (`backendErrors`).
import { spawn, type ChildProcess } from 'node:child_process';

import { E2E_DIST } from './build';
import { BACKEND_DIR, PYTHON } from './python';

export const BASE_PORT = 8100;
const START_TIMEOUT_MS = 60_000;
/** Lines of backend output kept in memory; a test reads only its own slice. */
const LOG_LIMIT = 20_000;

export class WorkerBackend {
  readonly url: string;
  private proc: ChildProcess | null = null;
  private lines: string[] = [];
  /** Index of `lines[0]` in the whole output, so marks survive trimming. */
  private dropped = 0;
  private partial = '';
  /** The spec file the running process has served. */
  file: string | null = null;

  constructor(readonly port: number) {
    this.url = `http://127.0.0.1:${port}`;
  }

  async start(): Promise<void> {
    if (await this.healthy()) {
      throw new Error(
        `E2E backend: port ${this.port} is already in use. Stop whatever runs there ` +
          `(a backend left over from an aborted run: \`lsof -i :${this.port}\`).`,
      );
    }
    const proc = spawn(
      PYTHON,
      ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(this.port), '--no-access-log'],
      {
        cwd: BACKEND_DIR,
        env: { ...process.env, FRONTEND_DIST: E2E_DIST, PYTHONUNBUFFERED: '1' },
        // Own process group, so stop() also ends the forked Director workers.
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    this.proc = proc;
    proc.stdout?.on('data', (chunk: Buffer) => this.append(chunk));
    proc.stderr?.on('data', (chunk: Buffer) => this.append(chunk));
    const exited = new Promise<never>((_, reject) =>
      proc.once('exit', (code) =>
        reject(new Error(`E2E backend on :${this.port} exited with code ${code}:\n${this.tail(40)}`)),
      ),
    );
    exited.catch(() => undefined);
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (!(await this.healthy())) {
      if (Date.now() > deadline) {
        await this.stop();
        throw new Error(`E2E backend on :${this.port} not healthy after ${START_TIMEOUT_MS / 1000} s:\n${this.tail(40)}`);
      }
      await Promise.race([exited, new Promise((r) => setTimeout(r, 200))]);
    }
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    this.proc = null;
    if (!proc || proc.exitCode !== null || proc.pid === undefined) return;
    const exited = new Promise<void>((r) => proc.once('exit', () => r()));
    killGroup(proc.pid, 'SIGTERM');
    const timer = setTimeout(() => killGroup(proc.pid!, 'SIGKILL'), 5_000);
    await exited;
    clearTimeout(timer);
    // uvicorn exits before forked children that are still planning.
    killGroup(proc.pid, 'SIGKILL');
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Synchronous last resort when the worker process exits without teardown. */
  killNow(): void {
    if (this.proc?.pid !== undefined) killGroup(this.proc.pid, 'SIGKILL');
  }

  /** A position in the output; `since(mark)` returns what came after it. */
  mark(): number {
    return this.dropped + this.lines.length;
  }

  since(mark: number): string[] {
    return this.lines.slice(Math.max(0, mark - this.dropped));
  }

  private tail(n: number): string {
    return this.lines.slice(-n).join('\n');
  }

  private append(chunk: Buffer): void {
    const text = this.partial + chunk.toString('utf8');
    const parts = text.split('\n');
    this.partial = parts.pop() ?? '';
    this.lines.push(...parts);
    if (this.lines.length > LOG_LIMIT) {
      const cut = this.lines.length - LOG_LIMIT;
      this.lines.splice(0, cut);
      this.dropped += cut;
    }
  }

  private async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(1_000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
}

/**
 * The exceptions in a slice of backend output: the last line of each Python
 * traceback (`AssertionError: …`), plus the errors the backend caught and only
 * logged (`Contentions forecast failed for <id>: AssertionError()`).
 */
export function backendExceptions(lines: string[]): string[] {
  const found: string[] = [];
  let inTraceback = false;
  let last: string | null = null;
  for (const line of lines) {
    if (line.startsWith('Traceback (most recent call last)')) {
      inTraceback = true;
      continue;
    }
    if (inTraceback) {
      if (line.startsWith(' ') || line.startsWith('\t') || line.trim() === '') continue;
      if (/^(During handling|The above exception)/.test(line)) continue;
      // First unindented line after the frames: `ExcType: message`.
      last = line.trim();
      inTraceback = false;
      if (found[found.length - 1] !== last) found.push(last);
      continue;
    }
    if (/\bfailed\b.*\b\w+(Error|Exception)\b/i.test(line)) found.push(line.trim());
  }
  return found;
}

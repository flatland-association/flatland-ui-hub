// The backend folder and the Python interpreter scripts/setup-dev.sh installed
// into: backend/.venv when it exists, otherwise whatever `python3` is on PATH
// (an active virtualenv, or the system Python in the dev container, which runs
// setup with SETUP_NO_VENV=1).
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const BACKEND_DIR = resolve(__dirname, '../../../backend');

export const PYTHON =
  [join(BACKEND_DIR, '.venv', 'bin', 'python'), join(BACKEND_DIR, '.venv', 'Scripts', 'python.exe')].find((p) =>
    existsSync(p),
  ) ?? 'python3';

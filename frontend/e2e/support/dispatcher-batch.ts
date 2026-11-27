import { execFileSync } from 'node:child_process';
import { BACKEND_DIR, PYTHON } from './python';

/** The evaluator reads the authored event time; the dispatcher never sees it. */
export function dispatcherDemoStep(): number {
  const script = 'from app.core.dispatcher import DEMO_SETUP as d; from app.core.scenario_presets import select_disturbances; print(min(e["step"] for item in select_disturbances(d["scenario_preset_id"],d["disturbance_ids"]) for e in item["events"]))';
  return Number(execFileSync(PYTHON, ['-c', script], { cwd: BACKEND_DIR, encoding: 'utf8' }).trim());
}

/** Real CLI runtime, compared with a completed UI run; no prepared results. */
export function runDispatcherBatch(config: unknown): any {
  const script = 'import asyncio,json,sys; from app.dispatcher_batch import run; print(json.dumps(asyncio.run(run(json.load(sys.stdin)))))';
  return JSON.parse(execFileSync(PYTHON, ['-c', script], {
    cwd: BACKEND_DIR, input: JSON.stringify(config), encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ONLINE_LEARNING_AUTOSTART: '0' },
  }));
}

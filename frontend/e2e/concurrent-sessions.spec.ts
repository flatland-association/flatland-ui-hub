// Two sessions alive at the same time — two browser tabs, or two people on the
// shared demo — must not break each other. Found while running the setup
// matrix in parallel; this test pins it down against the backend directly.
import { expect, test } from './support/fixtures';

const BACKEND = 'http://localhost:8000';

test('a session still steps after a second, smaller session was created', async ({ request }) => {
  // KNOWN BUG: concurrent sessions share one observation builder. Flatland's
  // `RailEnv.__init__` has `obs_builder_object=GlobalObsForRailEnv()` as a
  // default argument — one instance for every env built without its own — and
  // each new env re-binds it to itself. Stepping the older session then reads
  // the newer env's agents: `IndexError: list index out of range` in
  // flatland/envs/observations.py `get()`, HTTP 500 on POST /session/<id>/step
  // (no CORS header on the 500, so the browser reports a CORS error).
  test.fail();

  const first = await request.post(`${BACKEND}/session`, { data: { number_of_agents: 8, seed: 42 } });
  expect(first.ok(), 'POST /session (8 trains)').toBe(true);
  const firstId = (await first.json()).id as string;

  const second = await request.post(`${BACKEND}/session`, { data: { number_of_agents: 2, seed: 7 } });
  expect(second.ok(), 'POST /session (2 trains)').toBe(true);

  const step = await request.post(`${BACKEND}/session/${firstId}/step`, {
    data: { policy: 'deadlock_avoidance', n_steps: 1 },
  });
  expect(step.status(), 'POST /session/<first>/step after the second session exists').toBe(200);
});

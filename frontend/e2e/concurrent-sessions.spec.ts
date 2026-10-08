// Two live sessions (two tabs, two people on the shared demo) must not break
// each other. Checked directly against the backend.
import { expect, test } from './support/fixtures';

test('a session still steps after a second, smaller session was created', async ({ request }) => {
  const created: string[] = [];
  try {
    const first = await request.post('/session', { data: { number_of_agents: 8, seed: 42 } });
    expect(first.ok(), 'POST /session (8 trains)').toBe(true);
    const firstId = (await first.json()).id as string;
    created.push(firstId);

    const second = await request.post('/session', { data: { number_of_agents: 2, seed: 7 } });
    expect(second.ok(), 'POST /session (2 trains)').toBe(true);
    created.push((await second.json()).id as string);

    const step = await request.post(`/session/${firstId}/step`, {
      data: { policy: 'deadlock_avoidance', n_steps: 1 },
    });
    expect(step.status(), 'POST /session/<first>/step after the second session exists').toBe(200);
  } finally {
    for (const id of created) await request.delete(`/session/${id}`).catch(() => undefined);
  }
});

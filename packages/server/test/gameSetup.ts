import type { TestClient } from './harness.js';

/**
 * Drives two already-connected, joined players from `LOBBY` into a running
 * 1v1 `IN_GAME`, through the real T-17 Team Select flow (`start_game` ->
 * `TEAM_SELECT`, `set_team`/`set_ready` for both, `start_game` -> `IN_GAME`)
 * rather than T-14's old direct-to-`IN_GAME` shortcut. Shared by every
 * harness test that needs a running 1v1 game as setup, not as its own
 * subject under test.
 */
export async function startOneVOneGame(alice: TestClient, bob: TestClient): Promise<void> {
  alice.send({ t: 'start_game' });
  await alice.expect('state', (m) => m.phase === 'TEAM_SELECT');
  await bob.expect('state', (m) => m.phase === 'TEAM_SELECT');

  alice.send({ t: 'set_team', team: 'WHITE' });
  await alice.expect('state', (m) => (m.seats as Array<{ team: string | null }>).some((s) => s.team === 'WHITE'));
  bob.send({ t: 'set_team', team: 'BLACK' });
  await bob.expect('state', (m) => (m.seats as Array<{ team: string | null }>).some((s) => s.team === 'BLACK'));

  alice.send({ t: 'set_ready', ready: true });
  bob.send({ t: 'set_ready', ready: true });
  await alice.expect('state', (m) => (m.seats as Array<{ ready: boolean }>).every((s) => s.ready));
  await bob.expect('state', (m) => (m.seats as Array<{ ready: boolean }>).every((s) => s.ready));

  alice.send({ t: 'start_game' });
  await alice.expect('state', (m) => m.phase === 'IN_GAME');
  await bob.expect('state', (m) => m.phase === 'IN_GAME');
}

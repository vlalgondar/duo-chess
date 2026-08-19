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

export interface FourPlayers {
  readonly alice: TestClient; // host -> WHITE
  readonly bob: TestClient; // BLACK
  readonly carol: TestClient; // WHITE
  readonly dave: TestClient; // BLACK
}

/**
 * Drives four already-connected, joined players from `LOBBY` into a running
 * 2v2 `IN_GAME` (WHITE: alice+carol, BLACK: bob+dave) through the real T-17
 * Team Select flow — the team shape T-18/T-19/T-20's propose/accept
 * machinery actually needs, since a 2v2 team requires confirmation while
 * `startOneVOneGame`'s solo teams never do.
 */
export async function startTwoVTwoGame({ alice, bob, carol, dave }: FourPlayers): Promise<void> {
  const all = [alice, bob, carol, dave];

  alice.send({ t: 'start_game' });
  await Promise.all(all.map((c) => c.expect('state', (m) => m.phase === 'TEAM_SELECT')));

  alice.send({ t: 'set_team', team: 'WHITE' });
  bob.send({ t: 'set_team', team: 'BLACK' });
  carol.send({ t: 'set_team', team: 'WHITE' });
  dave.send({ t: 'set_team', team: 'BLACK' });
  await Promise.all(
    all.map((c) => c.expect('state', (m) => (m.seats as Array<{ team: string | null }>).every((s) => s.team !== null))),
  );

  for (const client of all) client.send({ t: 'set_ready', ready: true });
  await Promise.all(all.map((c) => c.expect('state', (m) => (m.seats as Array<{ ready: boolean }>).every((s) => s.ready))));

  alice.send({ t: 'start_game' });
  await Promise.all(all.map((c) => c.expect('state', (m) => m.phase === 'IN_GAME')));
}

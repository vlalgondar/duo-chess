import { describe, expect, it } from 'vitest';
import { startOneVOneGame } from './gameSetup.js';
import { spawnRoom } from './harness.js';

async function readyTwoPlayerRoom(code: string) {
  const room = await spawnRoom({ code });
  const alice = await room.connect({ username: 'alice' }); // host -> WHITE
  await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);
  const bob = await room.connect({ username: 'bob' }); // BLACK
  await bob.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);
  await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);
  return { room, alice, bob };
}

describe('clocks with durable object alarms (T-16)', () => {
  it(
    'ends a 2-second game by server-initiated game_over: TIMEOUT with no further client messages after the first move',
    async () => {
      const { room, alice, bob } = await readyTwoPlayerRoom('GM9AC2');
      await room.setTimeControl({ baseMs: 2_000, incrementMs: 0, label: 'test-2s' });

      await startOneVOneGame(alice, bob);

      // White's commit starts the clock running against BLACK (§4.6). Neither
      // client sends anything else — the alarm, not a client, must end this.
      alice.send({ t: 'propose', from: 'e2', to: 'e4' });
      await alice.expect('move_committed', (m) => m.san === 'e4');
      await bob.expect('move_committed', (m) => m.san === 'e4');

      const gameOverAlice = await alice.expect('game_over', () => true, { timeout: 4_000 });
      const gameOverBob = await bob.expect('game_over', () => true, { timeout: 4_000 });
      expect(gameOverAlice).toMatchObject({ status: 'TIMEOUT', winner: 'WHITE' });
      expect(gameOverBob).toMatchObject({ status: 'TIMEOUT', winner: 'WHITE' });

      const snapshot = await room.debugState();
      expect(snapshot.room?.game?.status).toBe('TIMEOUT');
      expect(snapshot.room?.game?.clock.running).toBe(false);
      // BLACK is the flagged team — its clock must freeze at its true live
      // value (zero), not whatever it stored when its turn started.
      expect(snapshot.room?.game?.clock.blackMs).toBe(0);
      expect(snapshot.room?.game?.clock.whiteMs).toBe(2_000);

      alice.disconnect();
      bob.disconnect();
    },
    8_000,
  );

  it('credits the increment exactly once per commit, not zero or twice', async () => {
    const { room, alice, bob } = await readyTwoPlayerRoom('GM9AC3');
    await room.setTimeControl({ baseMs: 60_000, incrementMs: 1_000, label: 'test-60+1' });

    await startOneVOneGame(alice, bob);

    // White's clock was never running before this commit, so elapsed is
    // exactly 0 — the increment lands on top of the untouched base with no
    // timing tolerance needed, the cleanest possible "exactly once" check.
    alice.send({ t: 'propose', from: 'e2', to: 'e4' });
    const whiteMove = await alice.expect('move_committed', (m) => m.san === 'e4');
    expect(whiteMove.clock).toMatchObject({ whiteMs: 61_000 });

    // Black's clock *was* running (started by White's commit above), so a
    // little real wall-clock time is unavoidable — assert a tight window
    // that only a single +1000ms credit (not a missed or doubled one) fits.
    bob.send({ t: 'propose', from: 'e7', to: 'e5' });
    const blackMove = await bob.expect('move_committed', (m) => m.san === 'e5');
    const blackMs = (blackMove.clock as { blackMs: number }).blackMs;
    expect(blackMs).toBeGreaterThan(60_500); // would be <= 60_000 if the increment weren't credited
    expect(blackMs).toBeLessThanOrEqual(61_000); // would exceed 61_000 if credited twice

    alice.disconnect();
    bob.disconnect();
  });

  it('re-arms the alarm after a forced Durable Object eviction', async () => {
    const { room, alice, bob } = await readyTwoPlayerRoom('GM9AC4');
    await room.setTimeControl({ baseMs: 60_000, incrementMs: 0, label: 'test-60s' });

    await startOneVOneGame(alice, bob);

    // Starts the clock (and schedules the flag-fall alarm) for BLACK.
    alice.send({ t: 'propose', from: 'e2', to: 'e4' });
    await alice.expect('move_committed');
    await bob.expect('move_committed');

    await room.forceReset();

    const alarmRan = await room.advanceTo();
    expect(alarmRan).toBe(true);

    alice.disconnect();
    bob.disconnect();
  });
});

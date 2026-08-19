import { DEFAULT_ROOM_SETTINGS } from '@duo/shared';
import { describe, expect, it } from 'vitest';
import { startTwoVTwoGame } from './gameSetup.js';
import { spawnRoom, type TestClient, type TestMessage } from './harness.js';

function chatText(m: TestMessage): string | undefined {
  return (m.message as { text?: string } | undefined)?.text;
}

describe('spectators (T-23)', () => {
  it('a 5th+ joiner spectates once all 4 seats are taken', async () => {
    const room = await spawnRoom({ code: 'SP9AAA' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    const carol = await room.connect({ username: 'carol' });
    const dave = await room.connect({ username: 'dave' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 4);

    const eve = await room.connect({ username: 'eve' });
    const state = await eve.expect('state', (m) => Array.isArray(m.spectators) && m.spectators.length === 1);
    expect((state.seats as unknown[]).length).toBe(4);
    expect((state.spectators as Array<{ username: string }>)[0]?.username).toBe('eve');

    // Every other joined socket also sees the roster grow.
    await alice.expect('state', (m) => Array.isArray(m.spectators) && m.spectators.length === 1);

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
    eve.disconnect();
  });

  it('anyone joining mid-game spectates, even with an open seat (§5.7)', async () => {
    const room = await spawnRoom({ code: 'SP9AAB' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);

    alice.send({ t: 'start_game' });
    await alice.expect('state', (m) => m.phase === 'TEAM_SELECT');
    alice.send({ t: 'set_team', team: 'WHITE' });
    bob.send({ t: 'set_team', team: 'BLACK' });
    alice.send({ t: 'set_ready', ready: true });
    bob.send({ t: 'set_ready', ready: true });
    alice.send({ t: 'start_game' });
    await alice.expect('state', (m) => m.phase === 'IN_GAME');

    // Only 2 of 4 seats are occupied, but the room is IN_GAME, so a new joiner spectates.
    const carol = await room.connect({ username: 'carol' });
    const state = await carol.expect('state', (m) => Array.isArray(m.spectators) && m.spectators.length === 1);
    expect((state.seats as unknown[]).length).toBe(2);

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
  });

  it('refuses a 5th joiner with SPECTATORS_DISABLED when the host has turned spectators off', async () => {
    const room = await spawnRoom({ code: 'SP9AAC' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    const carol = await room.connect({ username: 'carol' });
    const dave = await room.connect({ username: 'dave' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 4);

    alice.send({ t: 'update_settings', settings: { ...DEFAULT_ROOM_SETTINGS, allowSpectators: false } });
    await alice.expect('state', (m) => (m.settings as { allowSpectators: boolean }).allowSpectators === false);

    const eve = await room.connect({ username: 'eve' });
    const error = await eve.expect('error', (m) => m.code === 'SPECTATORS_DISABLED');
    expect(error.code).toBe('SPECTATORS_DISABLED');

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
    eve.disconnect();
  });

  /**
   * §5.7's "open seat" success path (`roomEngine.promoteSpectator` moving a
   * spectator into a seat freed by `leaveRoom`) is exhaustively covered at
   * the engine level in `roomEngine.test.ts` — that suite frees the seat by
   * calling `leaveRoom` directly, since it's a pure function. It can't be
   * driven end-to-end through this harness yet: `RoomDO` never calls
   * `leaveRoom` (a disconnect only flips `connected: false` via
   * `setConnected`, T-09) and the wire protocol has no `leave` message, so a
   * seat can never actually shrink below 4 through the live protocol today —
   * see TASKS.md's Findings for this task. What *is* reachable and worth
   * proving here is that `RoomDO.handlePromoteSpectator` forwards the
   * engine's rejection correctly for the realistic case (room already full).
   */
  it('rejects promote_spectator with ROOM_FULL once all 4 seats are already taken', async () => {
    const room = await spawnRoom({ code: 'SP9AAD' });
    const alice = await room.connect({ username: 'alice' }); // host
    const bob = await room.connect({ username: 'bob' });
    const carol = await room.connect({ username: 'carol' });
    const dave = await room.connect({ username: 'dave' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 4);

    const eve = await room.connect({ username: 'eve' });
    const spectated = await eve.expect('state', (m) => Array.isArray(m.spectators) && m.spectators.length === 1);
    const evePublicId = spectated.you as string;

    alice.send({ t: 'promote_spectator', publicId: evePublicId, team: 'BLACK' });
    const error = await alice.expect('error', (m) => m.code === 'ROOM_FULL');
    expect(error.code).toBe('ROOM_FULL');
    // Rejected — eve is still a spectator, not a seat.
    const snapshot = await room.debugState();
    expect(snapshot.room?.spectators.some((s) => s.publicId === evePublicId)).toBe(true);
    expect(snapshot.room?.seats.some((s) => s.publicId === evePublicId)).toBe(false);

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
    eve.disconnect();
  });

  it('rejects promote_spectator for an unknown publicId with SPECTATOR_NOT_FOUND', async () => {
    const room = await spawnRoom({ code: 'SP9AAH' });
    const alice = await room.connect({ username: 'alice' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);

    alice.send({ t: 'promote_spectator', publicId: 'nobody', team: 'WHITE' });
    const error = await alice.expect('error', (m) => m.code === 'SPECTATOR_NOT_FOUND');
    expect(error.code).toBe('SPECTATOR_NOT_FOUND');

    alice.disconnect();
  });

  it('rejects promote_spectator from a non-host with NOT_HOST', async () => {
    const room = await spawnRoom({ code: 'SP9AAE' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    const carol = await room.connect({ username: 'carol' });
    const dave = await room.connect({ username: 'dave' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 4);

    const eve = await room.connect({ username: 'eve' });
    const spectated = await eve.expect('state', (m) => Array.isArray(m.spectators) && m.spectators.length === 1);
    const evePublicId = spectated.you as string;

    bob.send({ t: 'promote_spectator', publicId: evePublicId, team: 'WHITE' });
    const error = await bob.expect('error', (m) => m.code === 'NOT_HOST');
    expect(error.code).toBe('NOT_HOST');

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
    eve.disconnect();
  });

  it('rejects promote_spectator during IN_GAME with INVALID_PHASE', async () => {
    const room = await spawnRoom({ code: 'SP9AAF' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);

    const carol = await room.connect({ username: 'carol' }); // still LOBBY, plenty of open seats — carol seats, not spectates
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 3);

    alice.send({ t: 'start_game' });
    await Promise.all(
      [alice, bob, carol].map((c) => c.expect('state', (m) => m.phase === 'TEAM_SELECT')),
    );
    alice.send({ t: 'set_team', team: 'WHITE' });
    bob.send({ t: 'set_team', team: 'BLACK' });
    carol.send({ t: 'set_team', team: 'WHITE' });
    await Promise.all(
      [alice, bob, carol].map((c) => c.expect('state', (m) => (m.seats as Array<{ team: string | null }>).every((s) => s.team !== null))),
    );
    for (const c of [alice, bob, carol]) c.send({ t: 'set_ready', ready: true });
    await Promise.all([alice, bob, carol].map((c) => c.expect('state', (m) => (m.seats as Array<{ ready: boolean }>).every((s) => s.ready))));
    alice.send({ t: 'start_game' });
    await Promise.all([alice, bob, carol].map((c) => c.expect('state', (m) => m.phase === 'IN_GAME')));

    // 4th joiner spectates since the room is IN_GAME (even with one open seat).
    const dave = await room.connect({ username: 'dave' });
    const spectated = await dave.expect('state', (m) => Array.isArray(m.spectators) && m.spectators.length === 1);
    const davePublicId = spectated.you as string;

    alice.send({ t: 'promote_spectator', publicId: davePublicId, team: 'BLACK' });
    const error = await alice.expect('error', (m) => m.code === 'INVALID_PHASE');
    expect(error.code).toBe('INVALID_PHASE');

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
  });

  it('a spectator never receives proposal_update, annotation_update, or TEAM chat across a full 2v2 game', async () => {
    const room = await spawnRoom({ code: 'SP9AAG' });
    const alice = await room.connect({ username: 'alice' }); // host -> WHITE
    const bob = await room.connect({ username: 'bob' }); // BLACK
    const carol = await room.connect({ username: 'carol' }); // WHITE (alice's teammate)
    const dave = await room.connect({ username: 'dave' }); // BLACK
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 4);

    const eve = await room.connect({ username: 'eve' }); // 5th joiner -> spectator
    await eve.expect('state', (m) => Array.isArray(m.spectators) && m.spectators.length === 1);

    await startTwoVTwoGame({ alice, bob, carol, dave });

    // A teammate annotation, before any move.
    alice.send({ t: 'annotate', annotations: [{ kind: 'CIRCLE', from: 'e4', color: 'A' }] });
    await carol.expect('annotation_update', (m) => (m.annotations as Array<{ from: string }>).some((a) => a.from === 'e4'));

    // TEAM chat between alice and carol.
    alice.send({ t: 'chat', text: 'go for e4', channel: 'TEAM' });
    await carol.expect('chat_message', (m) => chatText(m) === 'go for e4');

    // 1. f3 e5 2. g4 Qh4# — Fool's Mate, played through propose/accept the whole way.
    const moves: Array<[TestClient, TestClient, string, string, string]> = [
      [alice, carol, 'f2', 'f3', 'f3'],
      [bob, dave, 'e7', 'e5', 'e5'],
      [carol, alice, 'g2', 'g4', 'g4'],
      [dave, bob, 'd8', 'h4', 'Qh4#'],
    ];
    for (const [proposer, teammate, from, to, san] of moves) {
      proposer.send({ t: 'propose', from, to });
      const update = await teammate.expect('proposal_update', (m) => (m.proposal as { san?: string } | null)?.san === san);
      const proposalId = (update.proposal as { id: string }).id;
      teammate.send({ t: 'accept', proposalId });
      await Promise.all([alice, bob, carol, dave, eve].map((c) => c.expect('move_committed', (m) => m.san === san)));
    }

    const gameOver = await eve.expect('game_over');
    expect(gameOver).toMatchObject({ status: 'CHECKMATE', winner: 'BLACK' });

    // The leak assertion: across the whole game above, eve never got a team-scoped message.
    await Promise.all([
      eve.expectNever('proposal_update', { within: 200 }),
      eve.expectNever('annotation_update', { within: 200 }),
      eve.expectNever('chat_message', { within: 200, predicate: (m) => chatText(m) === 'go for e4' }),
    ]);

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
    eve.disconnect();
  });
});

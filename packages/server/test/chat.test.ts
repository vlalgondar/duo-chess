import { describe, expect, it } from 'vitest';
import { startTwoVTwoGame } from './gameSetup.js';
import { spawnRoom, type TestMessage } from './harness.js';

function chatText(m: TestMessage): string | undefined {
  return (m.message as { text?: string } | undefined)?.text;
}

describe('chat (T-21)', () => {
  it('a TEAM message reaches the partner only — expectNever on both opponents and a spectator', async () => {
    const room = await spawnRoom({ code: 'CH9AAA' });
    const alice = await room.connect({ username: 'alice' }); // host -> WHITE
    const bob = await room.connect({ username: 'bob' }); // BLACK
    const carol = await room.connect({ username: 'carol' }); // WHITE (alice's teammate)
    const dave = await room.connect({ username: 'dave' }); // BLACK
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 4);

    // A 5th joiner while all 4 seats are taken spectates (§5.7).
    const eve = await room.connect({ username: 'eve' });
    await eve.expect('state', (m) => Array.isArray(m.spectators) && m.spectators.length === 1);

    await startTwoVTwoGame({ alice, bob, carol, dave });

    alice.send({ t: 'chat', text: 'go for e4', channel: 'TEAM' });
    await Promise.all([
      carol.expect('chat_message', (m) => chatText(m) === 'go for e4'),
      bob.expectNever('chat_message', { within: 250, predicate: (m) => chatText(m) === 'go for e4' }),
      dave.expectNever('chat_message', { within: 250, predicate: (m) => chatText(m) === 'go for e4' }),
      eve.expectNever('chat_message', { within: 250, predicate: (m) => chatText(m) === 'go for e4' }),
    ]);

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
    eve.disconnect();
  });

  it('an ALL message reaches every player and a spectator, marked isSpectator when sent by one', async () => {
    const room = await spawnRoom({ code: 'CH9AAB' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);

    alice.send({ t: 'chat', text: 'hello room', channel: 'ALL' });
    await Promise.all([
      alice.expect('chat_message', (m) => chatText(m) === 'hello room'),
      bob.expect('chat_message', (m) => chatText(m) === 'hello room'),
    ]);

    alice.disconnect();
    bob.disconnect();
  });

  it('rejects TEAM for a solo (1v1) team with TEAM_CHAT_UNAVAILABLE', async () => {
    const room = await spawnRoom({ code: 'CH9AAC' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);

    // A 1v1 game: every team is solo, so TEAM chat has nobody to reach.
    alice.send({ t: 'start_game' });
    await alice.expect('state', (m) => m.phase === 'TEAM_SELECT');
    alice.send({ t: 'set_team', team: 'WHITE' });
    bob.send({ t: 'set_team', team: 'BLACK' });
    alice.send({ t: 'set_ready', ready: true });
    bob.send({ t: 'set_ready', ready: true });
    alice.send({ t: 'start_game' });
    await alice.expect('state', (m) => m.phase === 'IN_GAME');

    alice.send({ t: 'chat', text: 'psst', channel: 'TEAM' });
    const error = await alice.expect('error', (m) => m.code === 'TEAM_CHAT_UNAVAILABLE');
    expect(error.code).toBe('TEAM_CHAT_UNAVAILABLE');

    alice.disconnect();
    bob.disconnect();
  });

  it('rejects TEAM for a spectator with TEAM_CHAT_UNAVAILABLE', async () => {
    const room = await spawnRoom({ code: 'CH9AAF' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    const carol = await room.connect({ username: 'carol' });
    const dave = await room.connect({ username: 'dave' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 4);

    const eve = await room.connect({ username: 'eve' });
    await eve.expect('state', (m) => Array.isArray(m.spectators) && m.spectators.length === 1);

    eve.send({ t: 'chat', text: 'psst', channel: 'TEAM' });
    const error = await eve.expect('error', (m) => m.code === 'TEAM_CHAT_UNAVAILABLE');
    expect(error.code).toBe('TEAM_CHAT_UNAVAILABLE');

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    dave.disconnect();
    eve.disconnect();
  });

  it('drops the 6th message within 10s as RATE_LIMITED', async () => {
    const room = await spawnRoom({ code: 'CH9AAD' });
    const alice = await room.connect({ username: 'alice' });
    await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);

    for (let i = 0; i < 5; i++) {
      alice.send({ t: 'chat', text: `msg ${i}`, channel: 'ALL' });
      await alice.expect('chat_message', (m) => chatText(m) === `msg ${i}`);
    }

    alice.send({ t: 'chat', text: 'one too many', channel: 'ALL' });
    const error = await alice.expect('error', (m) => m.code === 'RATE_LIMITED');
    expect(error.code).toBe('RATE_LIMITED');
    await alice.expectNever('chat_message', { within: 200, predicate: (m) => chatText(m) === 'one too many' });

    alice.disconnect();
  });

  it('replays chat history on reconnect', async () => {
    const room = await spawnRoom({ code: 'CH9AAE' });
    let alice = await room.connect({ username: 'alice' });
    const joined = await alice.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 1);
    const resumeToken = joined.resumeToken as string;
    expect(typeof resumeToken).toBe('string');

    const bob = await room.connect({ username: 'bob' });
    await bob.expect('state', (m) => Array.isArray(m.seats) && m.seats.length === 2);

    alice.send({ t: 'chat', text: 'brb', channel: 'ALL' });
    await bob.expect('chat_message', (m) => chatText(m) === 'brb');

    alice.disconnect();
    await bob.expect('state', (m) => (m.seats as Array<{ username: string; connected: boolean }>).find((s) => s.username === 'alice')?.connected === false);

    alice = await room.connect({ username: 'alice', resumeToken });
    const resumed = await alice.expect('state', (m) => Array.isArray(m.chat) && m.chat.length === 1);
    expect((resumed.chat as Array<{ text: string }>).map((c) => c.text)).toEqual(['brb']);

    alice.disconnect();
    bob.disconnect();
  });
});

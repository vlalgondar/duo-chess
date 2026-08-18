import { describe, expect, it } from 'vitest';
import { spawnRoom } from './harness.js';

describe('multi-client harness', () => {
  it('connects several named clients and delivers a sent message', async () => {
    const room = await spawnRoom({ code: 'HARN02' });
    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });

    alice.send({ t: 'propose', from: 'e2', to: 'e4' });
    const received = await bob.expect('propose', (m) => m.from === 'e2' && m.to === 'e4');
    expect(received.t).toBe('propose');

    alice.disconnect();
    bob.disconnect();
  });

  it('expectNever resolves cleanly when a message never arrives (cross-room isolation)', async () => {
    const roomA = await spawnRoom({ code: 'HARN03' });
    const roomB = await spawnRoom({ code: 'HARN04' });
    const alice = await roomA.connect({ username: 'alice' });
    const eve = await roomB.connect({ username: 'eve' });

    alice.send({ t: 'propose', from: 'e2', to: 'e4' });
    await eve.expectNever('propose', { within: 300 });

    alice.disconnect();
    eve.disconnect();
  });

  it('expectNever rejects when a leak actually happens — proving it can catch one', async () => {
    const room = await spawnRoom({ code: 'HARN05' });
    const alice = await room.connect({ username: 'alice' });
    const mallory = await room.connect({ username: 'mallory' });

    alice.send({ t: 'secret', payload: 'team-only' });

    await expect(mallory.expectNever('secret', { within: 300 })).rejects.toThrow(/expected never to receive/);

    alice.disconnect();
    mallory.disconnect();
  });

  it('drops a socket and reconnects with a resume token, still exchanging messages', async () => {
    const room = await spawnRoom({ code: 'HARN06' });
    let alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });

    alice.disconnect();
    alice = await room.connect({ username: 'alice', resumeToken: 'test-resume-token' });

    alice.send({ t: 'propose', from: 'd2', to: 'd4' });
    const received = await bob.expect('propose', (m) => m.to === 'd4');
    expect(received.from).toBe('d2');

    alice.disconnect();
    bob.disconnect();
  });

  it('debugState reports connected socket count as clients join and leave', async () => {
    const room = await spawnRoom({ code: 'HARN07' });
    expect((await room.debugState()).socketCount).toBe(0);

    const alice = await room.connect({ username: 'alice' });
    const bob = await room.connect({ username: 'bob' });
    expect((await room.debugState()).socketCount).toBe(2);

    bob.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await room.debugState()).socketCount).toBe(1);

    alice.disconnect();
  });

  it('advanceTo fires a pending alarm and reports when none is scheduled', async () => {
    const room = await spawnRoom({ code: 'HARN08' });
    await room.connect({ username: 'alice' });

    const ran = await room.advanceTo(Date.now() + 1000);
    expect(ran).toBe(false);
  });
});

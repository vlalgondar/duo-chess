import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const ALLOWED_ORIGIN = 'http://localhost:5173';

function wsRequest(code: string, origin: string = ALLOWED_ORIGIN): Request {
  return new Request(`http://example.com/ws/${code}`, {
    headers: { Upgrade: 'websocket', Origin: origin },
  });
}

function acceptedSocket(response: Response): WebSocket {
  const ws = response.webSocket;
  if (!ws) {
    throw new Error('expected a WebSocket response');
  }
  ws.accept();
  return ws;
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timed out waiting for message')), 2000);
    ws.addEventListener(
      'message',
      (event) => {
        clearTimeout(timeout);
        const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
        resolve(JSON.parse(raw) as Record<string, unknown>);
      },
      { once: true },
    );
  });
}

// T-30: these tests exercise transport plumbing (socket sharing, origin checks, routing),
// not create-vs-join semantics — `create` defaults to `true` so a fresh code's first join
// still succeeds, same as before that distinction existed; pass `false` for a second joiner
// sharing an already-created code.
function join(ws: WebSocket, code: string, username: string, create = true): void {
  ws.send(JSON.stringify({ t: 'join', code, username, ...(create ? { create: true } : {}) }));
}

describe('websocket transport', () => {
  it('upgrades and answers a join with a state message for the sender', async () => {
    const response = await exports.default.fetch(wsRequest('ECHQ29'));
    expect(response.status).toBe(101);
    const ws = acceptedSocket(response);

    const received = nextMessage(ws);
    join(ws, 'ECHQ29', 'alice');
    const state = await received;
    expect(state).toMatchObject({ t: 'state', seq: 1, you: expect.any(String) });

    ws.close();
  });

  it('shares a Durable Object between two sockets on the same code', async () => {
    const code = 'SHARE9';
    const wsA = acceptedSocket(await exports.default.fetch(wsRequest(code)));
    const wsB = acceptedSocket(await exports.default.fetch(wsRequest(code)));

    join(wsA, code, 'alice');
    await nextMessage(wsA);

    const bReceived = nextMessage(wsB);
    join(wsB, code, 'bob', false);
    const bState = await bReceived;
    expect(Array.isArray(bState.seats) && bState.seats.length).toBe(2);

    wsA.close();
    wsB.close();
  });

  it('does not deliver room state to a socket on a different code', async () => {
    const wsA = acceptedSocket(await exports.default.fetch(wsRequest('RMAAAA')));
    const wsB = acceptedSocket(await exports.default.fetch(wsRequest('RMBBBB')));

    join(wsA, 'RMAAAA', 'alice');
    await nextMessage(wsA);

    let bMessageCount = 0;
    wsB.addEventListener('message', () => {
      bMessageCount += 1;
    });

    join(wsB, 'RMBBBB', 'bob');
    await nextMessage(wsB); // bob's own join state, from RMBBBB

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(bMessageCount).toBe(1); // only bob's own state — nothing from RMAAAA

    wsA.close();
    wsB.close();
  });

  it('rejects an upgrade from a disallowed origin', async () => {
    const response = await exports.default.fetch(wsRequest('BADORG', 'http://evil.example'));
    expect(response.status).toBe(403);
  });

  it('returns 404 for a path that is not a room', async () => {
    const response = await exports.default.fetch(
      new Request('http://example.com/nope', { headers: { Origin: ALLOWED_ORIGIN } }),
    );
    expect(response.status).toBe(404);
  });
});

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

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timed out waiting for message')), 2000);
    ws.addEventListener(
      'message',
      (event) => {
        clearTimeout(timeout);
        resolve(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data));
      },
      { once: true },
    );
  });
}

describe('websocket transport', () => {
  it('echo round-trips a message back to the sender', async () => {
    const response = await exports.default.fetch(wsRequest('ECHO01'));
    expect(response.status).toBe(101);
    const ws = acceptedSocket(response);

    const received = nextMessage(ws);
    ws.send('hello');
    expect(await received).toBe('hello');

    ws.close();
  });

  it('shares a Durable Object between two sockets on the same code', async () => {
    const code = 'SHARE1';
    const wsA = acceptedSocket(await exports.default.fetch(wsRequest(code)));
    const wsB = acceptedSocket(await exports.default.fetch(wsRequest(code)));

    const bReceived = nextMessage(wsB);
    wsA.send('from-a');
    expect(await bReceived).toBe('from-a');

    wsA.close();
    wsB.close();
  });

  it('does not deliver messages to a socket on a different code', async () => {
    const wsA = acceptedSocket(await exports.default.fetch(wsRequest('ROOMAA')));
    const wsB = acceptedSocket(await exports.default.fetch(wsRequest('ROOMBB')));

    let bReceivedAnything = false;
    wsB.addEventListener('message', () => {
      bReceivedAnything = true;
    });

    wsA.send('leaky?');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(bReceivedAnything).toBe(false);

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

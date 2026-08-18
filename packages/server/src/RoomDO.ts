import { DurableObject } from 'cloudflare:workers';

// Reserved WebSocket close codes (RFC 6455 §7.4.1) — a client that closes
// without sending an explicit code reports one of these to webSocketClose,
// and re-sending it verbatim throws.
const RESERVED_CLOSE_CODES = new Set([1005, 1006, 1015]);

/**
 * Shell for the per-room Durable Object. For now every socket accepted by an
 * instance is broadcast every message from every other socket on that same
 * instance — this is what makes "same code -> same object" observable from
 * outside, ahead of real room state landing in T-09.
 */
export class RoomDO extends DurableObject {
  override fetch(request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): void {
    for (const socket of this.ctx.getWebSockets()) {
      socket.send(message);
    }
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): void {
    ws.close(RESERVED_CLOSE_CODES.has(code) ? 1000 : code, reason);
  }

  override webSocketError(_ws: WebSocket, error: unknown): void {
    console.error('RoomDO websocket error', error);
  }
}

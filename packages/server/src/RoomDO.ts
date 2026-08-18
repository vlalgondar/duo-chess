import { DurableObject } from 'cloudflare:workers';
import {
  createRoom,
  joinRoom,
  parseClientMessage,
  redactFor,
  setConnected,
  type ClientRoomView,
  type ErrorCode,
  type Room,
  type Seat,
  type Spectator,
} from '@duo/shared';

// Reserved WebSocket close codes (RFC 6455 §7.4.1) — a client that closes
// without sending an explicit code reports one of these to webSocketClose,
// and re-sending it verbatim throws.
const RESERVED_CLOSE_CODES = new Set([1005, 1006, 1015]);

const ROOM_STORAGE_KEY = 'room';
const RESUME_TOKENS_STORAGE_KEY = 'resumeTokens';
const SEQ_STORAGE_KEY = 'seq';

/** What `ws.serializeAttachment()` carries so identity survives hibernation (CLAUDE.md rule 5). */
interface SocketAttachment {
  readonly seatId: string;
}

function isSocketAttachment(value: unknown): value is SocketAttachment {
  return typeof value === 'object' && value !== null && typeof (value as { seatId?: unknown }).seatId === 'string';
}

function findParticipant(room: Room, seatId: string): Seat | Spectator | undefined {
  return room.seats.find((s) => s.seatId === seatId) ?? room.spectators.find((s) => s.seatId === seatId);
}

/**
 * `RoomDO` holds the room's authoritative `Room`, applies pure `@duo/shared`
 * engine actions to it, and is the only thing that ever calls `redactFor()`
 * to put state on the wire (CLAUDE.md rule 3). In-memory state is a cache —
 * every mutation is persisted before the response goes out, and rehydrated
 * in the constructor (rule 6), so a Durable Object eviction between messages
 * is invisible to connected clients.
 *
 * T-09 wires up only `join` (issuing `seatId`/`resumeToken`, and reconnection
 * reclaiming a seat by token) plus connect/disconnect tracking. The other
 * client -> server message types are valid per the wire protocol but have no
 * engine support yet (team select, moves, chat, ...); they're deliberately
 * left unhandled here for the tasks that build that machinery.
 */
export class RoomDO extends DurableObject {
  private room: Room | null = null;
  private resumeTokens: Record<string, string> = {};
  private seq = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<Room>(ROOM_STORAGE_KEY)) ?? null;
      this.resumeTokens = (await ctx.storage.get<Record<string, string>>(RESUME_TOKENS_STORAGE_KEY)) ?? {};
      this.seq = (await ctx.storage.get<number>(SEQ_STORAGE_KEY)) ?? 0;
    });
  }

  override fetch(request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      this.sendError(ws, 'INVALID_MESSAGE', 'malformed JSON');
      return;
    }

    const parsed = parseClientMessage(json);
    if (!parsed.ok) {
      this.sendError(ws, 'INVALID_MESSAGE', parsed.issues.join('; '));
      return;
    }
    const message = parsed.value;

    if (message.t === 'join') {
      await this.handleJoin(ws, message.code, message.username, message.resumeToken);
      return;
    }

    const attachment = ws.deserializeAttachment();
    if (!isSocketAttachment(attachment)) {
      this.sendError(ws, 'NOT_JOINED', 'send join before any other message', message.nonce);
      return;
    }

    // Every other message type is real wire protocol but has no engine
    // behind it yet — later tasks (team select, propose/accept, chat, ...)
    // add the handling as their own machinery lands.
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    ws.close(RESERVED_CLOSE_CODES.has(code) ? 1000 : code, reason);

    const attachment = ws.deserializeAttachment();
    if (!isSocketAttachment(attachment) || !this.room) return;

    this.room = setConnected(this.room, attachment.seatId, false, Date.now());
    await this.persist();
    await this.broadcastState();
  }

  override webSocketError(_ws: WebSocket, error: unknown): void {
    console.error('RoomDO websocket error', error);
  }

  private async handleJoin(ws: WebSocket, code: string, username: string, resumeToken?: string): Promise<void> {
    if (isSocketAttachment(ws.deserializeAttachment())) {
      // Already joined on this socket — treat a repeat `join` as a resync request.
      await this.broadcastState();
      return;
    }

    const now = Date.now();

    if (resumeToken) {
      const seatId = this.resumeTokens[resumeToken];
      const participant = seatId && this.room ? findParticipant(this.room, seatId) : undefined;
      if (this.room && seatId && participant) {
        this.room = setConnected(this.room, seatId, true, now);
        ws.serializeAttachment({ seatId } satisfies SocketAttachment);
        await this.persist();
        await this.broadcastState({ seatId, resumeToken });
        return;
      }
      // Stale or unknown token: fall through and join fresh.
    }

    const seatId = crypto.randomUUID();
    const publicId = crypto.randomUUID();
    const joiner = { seatId, publicId, username };

    const result = this.room ? joinRoom(this.room, joiner, now) : undefined;
    if (result && !result.ok) {
      this.sendError(ws, result.code, result.code);
      return;
    }

    this.room = result ? result.value.room : createRoom(code, joiner, now);

    const newToken = crypto.randomUUID();
    this.resumeTokens = { ...this.resumeTokens, [newToken]: seatId };
    ws.serializeAttachment({ seatId } satisfies SocketAttachment);
    await this.persist();
    await this.broadcastState({ seatId, resumeToken: newToken });
  }

  /**
   * Sends every connected, joined socket its own `redactFor()` view under
   * the same `seq` — the one path from server state to the wire (CLAUDE.md
   * rule 3). `justJoined` carries the fresh/reused resume token that goes
   * only to the socket that triggered this broadcast, never to anyone else.
   */
  private async broadcastState(justJoined?: { seatId: string; resumeToken: string }): Promise<void> {
    const room = this.room;
    if (!room) return;

    this.seq += 1;
    await this.ctx.storage.put(SEQ_STORAGE_KEY, this.seq);

    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (!isSocketAttachment(attachment)) continue;

      const viewer = findParticipant(room, attachment.seatId);
      if (!viewer) continue;

      const view: ClientRoomView = redactFor(room, viewer);
      const resumeToken = justJoined?.seatId === attachment.seatId ? justJoined.resumeToken : undefined;
      socket.send(JSON.stringify({ t: 'state', seq: this.seq, ...view, ...(resumeToken ? { resumeToken } : {}) }));
    }
  }

  private sendError(ws: WebSocket, code: ErrorCode, message: string, nonce?: string): void {
    ws.send(JSON.stringify({ t: 'error', code, message, nonce }));
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put({
      [ROOM_STORAGE_KEY]: this.room,
      [RESUME_TOKENS_STORAGE_KEY]: this.resumeTokens,
    });
  }

  /**
   * Test-only introspection accessor, called via `runInDurableObject` from
   * the harness — never reachable over the wire. Bypasses `redactFor()`
   * deliberately: this is for assertions, not anything a client should see.
   */
  debugState(): { socketCount: number; room: Room | null } {
    return { socketCount: this.ctx.getWebSockets().length, room: this.room };
  }
}

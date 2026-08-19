import { DurableObject } from 'cloudflare:workers';
import {
  advanceToTeamSelect,
  commitMove,
  createRoom,
  flagFallDeadline,
  joinRoom,
  parseClientMessage,
  randomizeTeams,
  redactFor,
  remainingMs,
  resolveTimeout,
  setConnected,
  setReady,
  setTeam,
  startGameFromTeamSelect,
  updateSettings,
  type ClientRoomView,
  type ErrorCode,
  type GameState,
  type GameStatus,
  type PromotionPiece,
  type Room,
  type RoomSettings,
  type Seat,
  type Spectator,
  type Square,
  type Team,
} from '@duo/shared';

/** §8/§7: "clock_sync ... Every ~5s and on every commit." */
const CLOCK_SYNC_INTERVAL_MS = 5_000;

const GAME_OVER_REASON: Record<GameStatus, string> = {
  ACTIVE: 'active',
  CHECKMATE: 'Checkmate',
  STALEMATE: 'Stalemate',
  DRAW: 'Draw',
  TIMEOUT: 'Timeout',
  RESIGNED: 'Resignation',
  ABANDONED: 'Abandonment',
};

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
 * T-09 wires up `join` (issuing `seatId`/`resumeToken`, and reconnection
 * reclaiming a seat by token) plus connect/disconnect tracking. T-14 adds
 * `propose` (see `handlePropose`). T-17 adds `set_team`/`set_ready`/
 * `randomize_teams`/`update_settings` and makes `start_game` phase-aware
 * (LOBBY -> TEAM_SELECT -> IN_GAME, see `handleStartGame`'s doc comment).
 * Every other client -> server message type is valid per the wire protocol
 * but has no engine
 * support yet (multi-player accept/reject, chat, ...); deliberately left
 * unhandled here for the tasks that build that machinery.
 */
export class RoomDO extends DurableObject {
  private room: Room | null = null;
  private resumeTokens: Record<string, string> = {};
  private seq = 0;
  /**
   * Next `clock_sync` broadcast time — deliberately not persisted. Unlike
   * flag-fall, a missed periodic sync after an eviction is harmless (§9: the
   * client already resyncs from the authoritative `clock` on every `state`),
   * so it's cheaper to just re-derive "5s from now" than to carry another
   * field through storage for it.
   */
  private nextClockSyncAt: number | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<Room>(ROOM_STORAGE_KEY)) ?? null;
      this.resumeTokens = (await ctx.storage.get<Record<string, string>>(RESUME_TOKENS_STORAGE_KEY)) ?? {};
      this.seq = (await ctx.storage.get<number>(SEQ_STORAGE_KEY)) ?? 0;
      // §9 "Alarm survival": re-derive and re-set the alarm from stored state
      // on every rehydration, belt-and-braces — an eviction must never lose a
      // pending flag-fall.
      await this.scheduleAlarm();
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

    if (message.t === 'start_game') {
      await this.handleStartGame(ws, attachment.seatId, message.nonce);
      return;
    }

    if (message.t === 'set_team') {
      await this.handleSetTeam(ws, attachment.seatId, message.team, message.nonce);
      return;
    }

    if (message.t === 'set_ready') {
      await this.handleSetReady(ws, attachment.seatId, message.ready, message.nonce);
      return;
    }

    if (message.t === 'randomize_teams') {
      await this.handleRandomizeTeams(ws, attachment.seatId, message.nonce);
      return;
    }

    if (message.t === 'update_settings') {
      await this.handleUpdateSettings(ws, attachment.seatId, message.settings, message.nonce);
      return;
    }

    if (message.t === 'propose') {
      await this.handlePropose(ws, attachment.seatId, message.from, message.to, message.promotion, message.nonce);
      return;
    }

    // Every other message type is real wire protocol but has no engine
    // behind it yet — later tasks (accept/reject/withdraw for multi-player
    // teams, chat, ...) add the handling as their own machinery lands.
  }

  /**
   * `start_game` does double duty across the two phases it can fire from
   * (T-17, resolving the §5.3/§5.4 screen-map ambiguity — TASKS.md
   * Findings): from `LOBBY` it's the existing T-10 Lobby "Start" button,
   * now advancing to the FIFA screen (`advanceToTeamSelect`) instead of
   * directly into a game; from `TEAM_SELECT` it's that screen's own "Start
   * Game" button, validated by `startGameFromTeamSelect`. No new wire
   * message needed — same button-press semantics either room state answers.
   */
  private async handleStartGame(ws: WebSocket, seatId: string, nonce?: string): Promise<void> {
    if (!this.room) {
      this.sendError(ws, 'INVALID_PHASE', 'no room to start', nonce);
      return;
    }

    const result =
      this.room.phase === 'TEAM_SELECT'
        ? startGameFromTeamSelect(this.room, seatId, Math.random)
        : advanceToTeamSelect(this.room, seatId);
    if (!result.ok) {
      this.sendError(ws, result.code, result.code, nonce);
      return;
    }

    this.room = result.value;
    await this.persist();
    await this.broadcastState();
    if (this.room.phase === 'IN_GAME') {
      this.broadcastClockSync();
      await this.scheduleAlarm();
    }
  }

  private async handleSetTeam(ws: WebSocket, seatId: string, team: Team | null, nonce?: string): Promise<void> {
    if (!this.room) {
      this.sendError(ws, 'SEAT_NOT_FOUND', 'no room', nonce);
      return;
    }
    const result = setTeam(this.room, seatId, team, Date.now());
    if (!result.ok) {
      this.sendError(ws, result.code, result.code, nonce);
      return;
    }
    this.room = result.value;
    await this.persist();
    await this.broadcastState();
  }

  private async handleSetReady(ws: WebSocket, seatId: string, ready: boolean, nonce?: string): Promise<void> {
    if (!this.room) {
      this.sendError(ws, 'SEAT_NOT_FOUND', 'no room', nonce);
      return;
    }
    const result = setReady(this.room, seatId, ready, Date.now());
    if (!result.ok) {
      this.sendError(ws, result.code, result.code, nonce);
      return;
    }
    this.room = result.value;
    await this.persist();
    await this.broadcastState();
  }

  /** Host-only, full replacement of `settings` (§7). Scaffolded client-side since T-10; unwired server-side until now. */
  private async handleUpdateSettings(
    ws: WebSocket,
    seatId: string,
    settings: RoomSettings,
    nonce?: string,
  ): Promise<void> {
    if (!this.room) {
      this.sendError(ws, 'SEAT_NOT_FOUND', 'no room', nonce);
      return;
    }
    const result = updateSettings(this.room, seatId, settings);
    if (!result.ok) {
      this.sendError(ws, result.code, result.code, nonce);
      return;
    }
    this.room = result.value;
    await this.persist();
    await this.broadcastState();
  }

  private async handleRandomizeTeams(ws: WebSocket, seatId: string, nonce?: string): Promise<void> {
    if (!this.room) {
      this.sendError(ws, 'SEAT_NOT_FOUND', 'no room', nonce);
      return;
    }
    const result = randomizeTeams(this.room, seatId, Math.random);
    if (!result.ok) {
      this.sendError(ws, result.code, result.code, nonce);
      return;
    }
    this.room = result.value;
    await this.persist();
    await this.broadcastState();
  }

  /**
   * `propose` auto-commits immediately for every team (T-14). That was
   * exactly right when every team was solo by construction (§4.4's "solo
   * team ... propose() immediately followed by an internal auto-commit").
   * Team Select (T-17) can now seat two players on one side, but the
   * confirmation gate for that case — a real proposal slot, requiring the
   * teammate to `accept` — is T-18's job specifically, not this task's; see
   * TASKS.md's T-17 Findings for why a 2v2/2v1 game is reachable before
   * T-18 lands and what that means until it does.
   */
  private async handlePropose(
    ws: WebSocket,
    seatId: string,
    from: Square,
    to: Square,
    promotion: PromotionPiece | undefined,
    nonce?: string,
  ): Promise<void> {
    const room = this.room;
    if (!room || !room.game || room.phase !== 'IN_GAME') {
      this.sendError(ws, 'ILLEGAL_MOVE', 'no game in progress', nonce);
      return;
    }

    const seat = room.seats.find((s) => s.seatId === seatId);
    const mover: Team | undefined = seat?.team ?? undefined;
    if (!mover) {
      this.sendError(ws, 'NOT_YOUR_TURN', 'not a player in this game', nonce);
      return;
    }

    const result = commitMove(room.game, { from, to, promotion }, mover, Date.now(), room.settings.timeControl);
    if (!result.ok) {
      this.sendError(ws, result.code, result.code, nonce);
      return;
    }

    this.room = { ...room, game: result.value };
    await this.persist();

    const san = result.value.moveHistory.at(-1)!;
    this.broadcastAll({
      t: 'move_committed',
      san,
      fen: result.value.fen,
      clock: result.value.clock,
      by: seat!.publicId,
    });
    await this.broadcastState();
    // §7/§8: "clock_sync ... Every ~5s and on every commit" — reset the
    // periodic timer here too, so a sync that just went out on commit isn't
    // immediately duplicated by the alarm a few seconds later.
    this.nextClockSyncAt = Date.now() + CLOCK_SYNC_INTERVAL_MS;
    this.broadcastClockSync();

    if (result.value.status !== 'ACTIVE') {
      this.broadcastAll({
        t: 'game_over',
        status: result.value.status,
        winner: result.value.winner,
        reason: GAME_OVER_REASON[result.value.status],
      });
    }

    // Rescheduled per commit (CLAUDE.md rule 4's single-slot deadline queue):
    // whichever of flag-fall or the next periodic sync is soonest wins the
    // DO's one alarm slot.
    await this.scheduleAlarm();
  }

  /**
   * Fires when the earliest deadline in the queue (flag-fall or the next
   * periodic `clock_sync`) is reached. There is exactly one alarm slot per
   * object (CLAUDE.md rule 4), so this always re-derives and re-arms the
   * alarm for whatever is next before returning, whether or not it did
   * anything this time — `scheduleAlarm` is the only place that calls
   * `ctx.storage.setAlarm()`.
   */
  override async alarm(): Promise<void> {
    const now = Date.now();
    const game = this.room?.game;

    if (game && game.status === 'ACTIVE') {
      const deadline = flagFallDeadline(game.clock, game.sideToMove, this.room!.settings.timeControl);
      if (deadline !== null && now >= deadline) {
        await this.resolveFlagFall(game, game.sideToMove, now);
      }
    }

    const activeGame = this.room?.game;
    if (
      this.room?.phase === 'IN_GAME' &&
      activeGame?.status === 'ACTIVE' &&
      this.nextClockSyncAt !== undefined &&
      now >= this.nextClockSyncAt
    ) {
      this.broadcastClockSync(now);
      this.nextClockSyncAt = now + CLOCK_SYNC_INTERVAL_MS;
    }

    await this.scheduleAlarm(now);
  }

  /**
   * Ends the game on time (§4.1 "Timeout" row) — a loss for `flaggedTeam`, or
   * a draw if the opponent can't mate. Freezes `clock` to each team's true
   * live remaining time at `now` (via `remainingMs`, the same arithmetic
   * `flagFallDeadline` is built on) rather than just stopping it in place —
   * without this the flagged team's stored `*Ms` is still whatever it was
   * when their turn started, so a client would show them well above zero on
   * a game the server just ended for running out of time.
   */
  private async resolveFlagFall(game: GameState, flaggedTeam: Team, now: number): Promise<void> {
    const room = this.room;
    if (!room || !room.game) return;

    const { status, winner } = resolveTimeout(game.fen, flaggedTeam);
    const clock = {
      whiteMs: remainingMs(game.clock, 'WHITE', game.sideToMove, now),
      blackMs: remainingMs(game.clock, 'BLACK', game.sideToMove, now),
      turnStartedAt: null,
      running: false,
    };
    this.room = { ...room, game: { ...game, status, winner, clock } };
    await this.persist();
    await this.broadcastState();
    this.broadcastAll({ t: 'game_over', status, winner, reason: GAME_OVER_REASON[status] });
  }

  /** `{ whiteMs, blackMs, turnStartedAt, serverNow }` — the client's rAF interpolation resyncs against this (§8.6). */
  private broadcastClockSync(now = Date.now()): void {
    const game = this.room?.game;
    if (!game) return;
    this.broadcastAll({
      t: 'clock_sync',
      whiteMs: game.clock.whiteMs,
      blackMs: game.clock.blackMs,
      turnStartedAt: game.clock.turnStartedAt,
      serverNow: now,
    });
  }

  /**
   * Recomputes the single alarm slot from the current deadline queue —
   * flag-fall (if a clock is running) and the next periodic `clock_sync` (if
   * a game is in progress) — and arms `ctx.storage.setAlarm()` for whichever
   * is soonest. The only place that calls `setAlarm`/`deleteAlarm`, so every
   * caller (join/rehydrate, start_game, propose, the alarm handler itself)
   * routes through here rather than poking the alarm directly.
   */
  private async scheduleAlarm(now = Date.now()): Promise<void> {
    const room = this.room;
    const game = room?.game;
    if (!room || !game || room.phase !== 'IN_GAME' || game.status !== 'ACTIVE') {
      this.nextClockSyncAt = undefined;
      await this.ctx.storage.deleteAlarm();
      return;
    }

    if (this.nextClockSyncAt === undefined) {
      this.nextClockSyncAt = now + CLOCK_SYNC_INTERVAL_MS;
    }

    const deadlines = [this.nextClockSyncAt];
    const flagFall = flagFallDeadline(game.clock, game.sideToMove, room.settings.timeControl);
    if (flagFall !== null) deadlines.push(flagFall);

    await this.ctx.storage.setAlarm(Math.min(...deadlines));
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

  /**
   * Sends the same message verbatim to every joined socket — for message
   * types whose payload is already public (`move_committed`, `game_over`)
   * and so has no per-viewer redaction to do, unlike `broadcastState()`.
   */
  private broadcastAll(message: Record<string, unknown>): void {
    const json = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (!isSocketAttachment(socket.deserializeAttachment())) continue;
      socket.send(json);
    }
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

  /**
   * Test-only settings override, called via `runInDurableObject` — never
   * reachable over the wire (same precedent as `debugState()`). `T-16`'s own
   * harness tests need a short/fast time control to exercise flag-fall
   * without a real multi-minute wait; `update_settings` isn't wired to the
   * wire protocol until T-17 (see TASKS.md Findings), so this is the only
   * way to configure one pre-game.
   */
  async debugSetTimeControl(timeControl: Room['settings']['timeControl']): Promise<void> {
    if (!this.room) return;
    this.room = { ...this.room, settings: { ...this.room.settings, timeControl } };
    await this.persist();
  }
}

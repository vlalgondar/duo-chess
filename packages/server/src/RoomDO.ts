import { DurableObject } from 'cloudflare:workers';
import {
  abandonmentDeadline,
  acceptProposal,
  advanceToTeamSelect,
  annotationColorFor,
  connectedTeamSize,
  createRoom,
  expireVotes,
  flagFallDeadline,
  GAME_OVER_REASON,
  joinRoom,
  parseClientMessage,
  promoteSpectator,
  randomizeTeams,
  redactFor,
  rejectProposal,
  rematch,
  remainingMs,
  requiresConfirmation,
  resolveAbandonment,
  resolveTimeout,
  sendChatMessage,
  setAnnotations,
  setConnected,
  setReady,
  setTeam,
  startGameFromTeamSelect,
  submitMove,
  submitVote,
  toWireAnnotation,
  toWireProposal,
  updateSettings,
  VOTE_EXPIRY_MS,
  withdrawProposal,
  type Annotation,
  type ChatChannel,
  type ClientRoomView,
  type ErrorCode,
  type GameState,
  type PromotionPiece,
  type Proposal,
  type Room,
  type RoomSettings,
  type Seat,
  type Spectator,
  type Square,
  type Team,
  type TeamVoteKind,
  type WireAnnotation,
} from '@duo/shared';

/** §8/§7: "clock_sync ... Every ~5s and on every commit." */
const CLOCK_SYNC_INTERVAL_MS = 5_000;

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

/**
 * `ctx.getWebSockets()` can still list a socket whose underlying transport
 * already closed but whose `webSocketClose` handler hasn't run yet (T-10's
 * Findings: this raced reliably under Playwright's multi-context teardown
 * and threw an uncaught `TypeError` out of every broadcast loop). Guarding
 * every `send()` call site with this is cheap and unconditionally correct —
 * a closing/closed socket was never going to receive the message anyway.
 */
function isSocketOpen(socket: WebSocket): boolean {
  return socket.readyState === 1; // WebSocket.OPEN — a plain literal, since `readyState` has no exported enum here
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
 * T-18/T-20 add `withdraw`/`accept`/`reject`. T-21 adds `chat` (see
 * `handleChat`). T-22 adds `annotate` (see `handleAnnotate`). T-23 adds
 * `promote_spectator` (see `handlePromoteSpectator`) — `join` has spectated
 * a 5th+ joiner, or anyone joining `IN_GAME`, since T-09/T-07's `joinRoom`.
 * T-25 adds `vote` (see `handleVote`) — resign/draw-offer/draw-accept, the
 * generic `TeamVote` mechanic, folded into the same single-slot deadline
 * queue (rule 4) that already drives flag-fall and abandonment. T-27 adds
 * `ping` (see `handlePing`) — a direct reply to the requesting socket only,
 * no room mutation, so the client's RTT indicator (§8 rule 10) never waits
 * behind a `broadcastState()`.
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
  /**
   * §4.5's 30s vote-expiry window — an instance field (not persisted, not part of `Room`) rather
   * than a hardcoded constant so `debugSetVoteExpiryMs` can shrink it for tests, the same
   * precedent `debugSetTimeControl` (T-16) set for proving a real, unforced alarm firing without
   * a genuine 30-second wait.
   */
  private voteExpiryMs = VOTE_EXPIRY_MS;

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

    if (message.t === 'withdraw') {
      await this.handleWithdraw(ws, attachment.seatId, message.proposalId, message.nonce);
      return;
    }

    if (message.t === 'accept') {
      await this.handleAccept(ws, attachment.seatId, message.proposalId, message.nonce);
      return;
    }

    if (message.t === 'reject') {
      await this.handleReject(ws, attachment.seatId, message.proposalId, message.nonce);
      return;
    }

    if (message.t === 'chat') {
      await this.handleChat(ws, attachment.seatId, message.text, message.channel, message.nonce);
      return;
    }

    if (message.t === 'annotate') {
      await this.handleAnnotate(ws, attachment.seatId, message.annotations, message.nonce);
      return;
    }

    if (message.t === 'promote_spectator') {
      await this.handlePromoteSpectator(ws, attachment.seatId, message.publicId, message.team, message.nonce);
      return;
    }

    if (message.t === 'vote') {
      await this.handleVote(ws, attachment.seatId, message.kind, message.nonce);
      return;
    }

    if (message.t === 'rematch') {
      await this.handleRematch(ws, attachment.seatId, message.nonce);
      return;
    }

    if (message.t === 'ping') {
      this.handlePing(ws, message.ts);
      return;
    }

    // Every other message type is real wire protocol but has no engine
    // behind it yet.
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
   * `rematch` (§5.6): "Rematch button that returns everyone to team select
   * with settings retained." Not host-gated — any seated player can trigger
   * it, unlike `start_game`/`randomize_teams`/`update_settings` above.
   * `roomEngine.rematch` only allows the `FINISHED` -> `TEAM_SELECT`
   * transition, resets every seat's `ready` flag, and clears `game` while
   * leaving `seats` (teams) and `settings` untouched.
   */
  private async handleRematch(ws: WebSocket, seatId: string, nonce?: string): Promise<void> {
    if (!this.room) {
      this.sendError(ws, 'SEAT_NOT_FOUND', 'no room', nonce);
      return;
    }
    const result = rematch(this.room, seatId, Date.now());
    if (!result.ok) {
      this.sendError(ws, result.code, result.code, nonce);
      return;
    }
    this.room = result.value;
    await this.persist();
    await this.broadcastState();
  }

  /**
   * `promote_spectator` (§5.7/§7): host-only, moves a spectator into a seat
   * on `team`. Rejected during `IN_GAME` by `promoteSpectator` itself
   * (`INVALID_PHASE`) — "mid-game promotion is not allowed" — so this
   * handler only needs to forward the result, same shape as every other
   * host-only action above.
   */
  private async handlePromoteSpectator(
    ws: WebSocket,
    seatId: string,
    publicId: string,
    team: Team,
    nonce?: string,
  ): Promise<void> {
    if (!this.room) {
      this.sendError(ws, 'SEAT_NOT_FOUND', 'no room', nonce);
      return;
    }
    const result = promoteSpectator(this.room, seatId, publicId, team, Date.now());
    if (!result.ok) {
      this.sendError(ws, result.code, result.code, nonce);
      return;
    }
    this.room = result.value;
    await this.persist();
    await this.broadcastState();
  }

  /**
   * A team member's move attempt (T-14/T-18/T-20). `submitMove` (shared) is
   * the one entry point regardless of team size: a solo team (or a team
   * whose only other seat is disconnected — `connectedTeamSize`) commits the
   * instant it's made, exactly as T-14 always did; a team with two connected
   * players gets a real proposal slot instead, awaiting a teammate's
   * `accept`. Either way `propose` is also how re-propose and counter-propose
   * happen (§4.3 rule 4 — "counter-proposing is just proposing"), since
   * `submitMove`/`proposeMove` replace whatever was in the slot regardless of
   * who called it.
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

    const teamSize = connectedTeamSize(room.seats, mover);
    const result = submitMove(
      room.game,
      mover,
      seatId,
      { from, to, promotion },
      Date.now(),
      room.settings.timeControl,
      teamSize,
    );
    if (!result.ok) {
      this.sendError(ws, result.code, result.code, nonce);
      return;
    }

    if (requiresConfirmation(teamSize)) {
      // A real proposal, not a commit — await the teammate's `accept`.
      this.room = { ...room, game: result.value };
      await this.persist();
      await this.broadcastState();
      this.broadcastProposalUpdate(mover, result.value.proposals[mover]);
      return;
    }

    await this.applyCommit(room, result.value, seat!.publicId);
  }

  /** Proposer only (§4.3 rule 6's mirror — enforced by `withdrawProposal` itself). */
  private async handleWithdraw(ws: WebSocket, seatId: string, proposalId: string, nonce?: string): Promise<void> {
    const room = this.room;
    if (!room || !room.game) {
      this.sendError(ws, 'ILLEGAL_MOVE', 'no game in progress', nonce);
      return;
    }
    const team = room.seats.find((s) => s.seatId === seatId)?.team;
    if (!team) {
      this.sendError(ws, 'NOT_YOUR_TURN', 'not a player in this game', nonce);
      return;
    }
    const result = withdrawProposal(room.game, team, seatId, proposalId);
    if (!result.ok) {
      this.sendError(ws, result.code, result.code, nonce);
      return;
    }
    this.room = { ...room, game: result.value };
    await this.persist();
    await this.broadcastState();
    this.broadcastProposalUpdate(team, null);
  }

  /** Accepter only, a soft "try something else" (§4.3 rule 6) — clears the slot without committing. */
  private async handleReject(ws: WebSocket, seatId: string, proposalId: string, nonce?: string): Promise<void> {
    const room = this.room;
    if (!room || !room.game) {
      this.sendError(ws, 'ILLEGAL_MOVE', 'no game in progress', nonce);
      return;
    }
    const team = room.seats.find((s) => s.seatId === seatId)?.team;
    if (!team) {
      this.sendError(ws, 'NOT_YOUR_TURN', 'not a player in this game', nonce);
      return;
    }
    const result = rejectProposal(room.game, team, seatId, proposalId);
    if (!result.ok) {
      this.sendError(ws, result.code, result.code, nonce);
      return;
    }
    this.room = { ...room, game: result.value };
    await this.persist();
    await this.broadcastState();
    this.broadcastProposalUpdate(team, null);
  }

  /**
   * Accepter confirms the live proposal (§4.3 rule 2/3 — no self-accept, a
   * stale `proposalId` commits nothing). `move_committed`'s `by` is the
   * original proposer's publicId and `confirmedBy` the accepter's, so
   * clients can render "carol proposed, alice confirmed" — distinct from a
   * solo team's direct commit, which has no `confirmedBy` at all.
   */
  private async handleAccept(ws: WebSocket, seatId: string, proposalId: string, nonce?: string): Promise<void> {
    const room = this.room;
    if (!room || !room.game) {
      this.sendError(ws, 'ILLEGAL_MOVE', 'no game in progress', nonce);
      return;
    }
    const team = room.seats.find((s) => s.seatId === seatId)?.team;
    if (!team) {
      this.sendError(ws, 'NOT_YOUR_TURN', 'not a player in this game', nonce);
      return;
    }
    const proposal = room.game.proposals[team];
    const result = acceptProposal(room.game, team, seatId, proposalId, Date.now(), room.settings.timeControl);
    if (!result.ok) {
      this.sendError(ws, result.code, result.code, nonce);
      return;
    }
    const proposer = proposal ? room.seats.find((s) => s.seatId === proposal.by) : undefined;
    const accepter = room.seats.find((s) => s.seatId === seatId);
    await this.applyCommit(room, result.value, proposer?.publicId ?? accepter!.publicId, accepter!.publicId);
  }

  /**
   * The shared tail of every path that ends in a committed move — a solo
   * team's direct `propose` (T-14/T-19) and a confirmed team's `accept`
   * (T-18/T-20) both land here, so `move_committed`/`state`/`clock_sync`/
   * `game_over`/alarm-rescheduling only exist in one place. `confirmedBy` is
   * only set on the accept path (see `handleAccept`).
   */
  private async applyCommit(room: Room, game: GameState, by: string, confirmedBy?: string): Promise<void> {
    // §5.6/T-26: a game-ending commit also advances the room to `FINISHED` —
    // in the same assignment as `game`, so the `state` broadcast below (which
    // reaches clients before the `game_over` message) already reflects it.
    this.room = { ...room, game, phase: game.status === 'ACTIVE' ? room.phase : 'FINISHED' };
    await this.persist();

    const san = game.moveHistory.at(-1)!;
    this.broadcastAll({
      t: 'move_committed',
      san,
      fen: game.fen,
      clock: game.clock,
      by,
      ...(confirmedBy !== undefined ? { confirmedBy } : {}),
    });
    await this.broadcastState();
    // §4.3 rule 7: "cleared on every commit, including after the opponent
    // moves" — both teams' slots are cleared by `commitMove` regardless of
    // which team just moved, so both get the news, team-scoped.
    this.broadcastProposalUpdate('WHITE', null);
    this.broadcastProposalUpdate('BLACK', null);
    // §7/§8: "clock_sync ... Every ~5s and on every commit" — reset the
    // periodic timer here too, so a sync that just went out on commit isn't
    // immediately duplicated by the alarm a few seconds later.
    this.nextClockSyncAt = Date.now() + CLOCK_SYNC_INTERVAL_MS;
    this.broadcastClockSync();

    if (game.status !== 'ACTIVE') {
      this.broadcastAll({
        t: 'game_over',
        status: game.status,
        winner: game.winner,
        reason: GAME_OVER_REASON[game.status],
      });
    }

    // Rescheduled per commit (CLAUDE.md rule 4's single-slot deadline queue):
    // whichever of flag-fall or the next periodic sync is soonest wins the
    // DO's one alarm slot.
    await this.scheduleAlarm();
  }

  /**
   * `chat` (§5.8/§7): `sendChatMessage` (shared) enforces the 5/10s rate
   * limit, the 100-message retention cap, and rejects `TEAM` for a
   * spectator/solo team/outside `IN_GAME`. The retained `Room.chat` (part of
   * every persisted+redacted `state`) is what makes history replay on
   * join/reconnect free — no separate replay path needed. `chat_message`
   * itself, unlike `state`, is a small per-message broadcast (§8 "deltas
   * over snapshots"), scoped to the sender's team for `TEAM` and everyone
   * for `ALL` via `broadcastToTeam`/`broadcastAll`.
   */
  private async handleChat(
    ws: WebSocket,
    seatId: string,
    text: string,
    channel: ChatChannel,
    nonce?: string,
  ): Promise<void> {
    const room = this.room;
    if (!room) {
      this.sendError(ws, 'SEAT_NOT_FOUND', 'no room', nonce);
      return;
    }
    const result = sendChatMessage(room, seatId, text, channel, Date.now());
    if (!result.ok) {
      this.sendError(ws, result.code, result.code, nonce);
      return;
    }
    this.room = result.value;
    await this.persist();

    const chatMessage = result.value.chat.at(-1)!;
    const broadcast = { t: 'chat_message', message: chatMessage };
    if (chatMessage.channel === 'TEAM' && chatMessage.team) {
      this.broadcastToTeam(chatMessage.team, broadcast);
    } else {
      this.broadcastAll(broadcast);
    }
  }

  /**
   * `annotate` (§5.9/§7): "Full replacement of your own set." `color` is
   * derived server-side from seat order (`annotationColorFor`), never
   * trusted from the wire (same reasoning as every other client-supplied
   * value that's actually derivable). Deliberately **not persisted** — §9
   * "Annotations are intentionally not persisted... held in memory only" —
   * so unlike every other mutation in this file, there is no `this.persist()`
   * call here; `this.room` is updated in memory only, and a later,
   * unrelated `persist()` call incidentally carrying the live set to storage
   * is harmless (the next commit clears it anyway).
   */
  private async handleAnnotate(
    ws: WebSocket,
    seatId: string,
    annotations: WireAnnotation[],
    nonce?: string,
  ): Promise<void> {
    const room = this.room;
    if (!room || !room.game || room.phase !== 'IN_GAME') {
      this.sendError(ws, 'ILLEGAL_MOVE', 'no game in progress', nonce);
      return;
    }
    const seat = room.seats.find((s) => s.seatId === seatId);
    const team = seat?.team;
    if (!seat || !team) {
      this.sendError(ws, 'NOT_YOUR_TURN', 'not a player in this game', nonce);
      return;
    }

    const teamMemberIds = room.seats.filter((s) => s.team === team).map((s) => s.seatId);
    const color = annotationColorFor(teamMemberIds, seatId);
    const game = setAnnotations(room.game, team, seatId, color, annotations);
    this.room = { ...room, game };

    const ownAnnotations = game.annotations[team].filter((a) => a.by === seatId);
    this.broadcastAnnotationUpdate(team, seat.publicId, ownAnnotations);
  }

  /**
   * `vote` (§4.5/§7): resign, offer a draw, or accept the opponents' draw offer. `submitVote`
   * (shared) is the one entry point for all three, mirroring `submitMove`'s solo-vs-2-player
   * split — a solo team (or one with a disconnected member, via `connectedTeamSize`) resolves
   * immediately, a connected 2-player team's vote joins or replaces its slot. There is no
   * dedicated `vote_update` message (§7's server->client table has none) — a resolved or
   * still-pending vote is just part of `game.pendingVotes`/`game.drawOffer` on the next `state`,
   * the same "no delta message" treatment `set_team`/`set_ready` already get.
   */
  private async handleVote(ws: WebSocket, seatId: string, kind: TeamVoteKind, nonce?: string): Promise<void> {
    const room = this.room;
    if (!room || !room.game || room.phase !== 'IN_GAME') {
      this.sendError(ws, 'ILLEGAL_MOVE', 'no game in progress', nonce);
      return;
    }
    const team = room.seats.find((s) => s.seatId === seatId)?.team;
    if (!team) {
      this.sendError(ws, 'NOT_YOUR_TURN', 'not a player in this game', nonce);
      return;
    }

    const teamSize = connectedTeamSize(room.seats, team);
    const result = submitVote(room.game, team, seatId, kind, Date.now(), teamSize, this.voteExpiryMs);
    if (!result.ok) {
      this.sendError(ws, result.code, result.code, nonce);
      return;
    }

    this.room = { ...room, game: result.value, phase: result.value.status === 'ACTIVE' ? room.phase : 'FINISHED' };
    await this.persist();
    await this.broadcastState();
    if (result.value.status !== 'ACTIVE') {
      this.broadcastAll({
        t: 'game_over',
        status: result.value.status,
        winner: result.value.winner,
        reason: GAME_OVER_REASON[result.value.status],
      });
    }
    // Rescheduled per T-16's single-slot deadline queue (rule 4): a fresh
    // pending vote adds a new expiry deadline, and a resolved RESIGN/
    // DRAW_ACCEPT stops the clock, both of which can change what's next.
    await this.scheduleAlarm();
  }

  /**
   * Sends `message` only to sockets belonging to `team` — the shared loop
   * behind both `proposal_update` (§4.3) and `TEAM` `chat_message` (§5.8),
   * the two team-scoped-but-not-full-`state` broadcasts. Spectators are
   * never in `room.seats`, so the team-match filter excludes them for free.
   */
  private broadcastToTeam(team: Team, message: Record<string, unknown>): void {
    const room = this.room;
    if (!room) return;
    const json = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (!isSocketOpen(socket)) continue;
      const attachment = socket.deserializeAttachment();
      if (!isSocketAttachment(attachment)) continue;
      const seat = room.seats.find((s) => s.seatId === attachment.seatId);
      if (seat?.team === team) socket.send(json);
    }
  }

  /**
   * `proposal_update` (§7/§4.3): visible only to members of the proposing
   * team — the one place besides `redactFor()` that turns a server-internal
   * `Proposal` (seatId `by`) into its wire shape (`toWireProposal`), so
   * reusing that helper instead of re-deriving the seatId->publicId lookup
   * is what keeps this from becoming a second redaction choke point
   * (CLAUDE.md rule 3).
   */
  private broadcastProposalUpdate(team: Team, proposal: Proposal | null): void {
    const room = this.room;
    if (!room) return;
    const message = { t: 'proposal_update', proposal: proposal ? toWireProposal(room, proposal) : null };
    this.broadcastToTeam(team, message);
  }

  /**
   * `annotation_update` (§7/§5.9): team-scoped, `by` identifies whose full
   * set this is (the recipient's own client merges it into whichever slice
   * of its local annotation state belongs to that author — see the client's
   * own `annotationColorFor` usage). Reuses `toWireAnnotation` rather than
   * re-deriving the seatId-stripping, same precedent as `toWireProposal`
   * above (CLAUDE.md rule 3).
   */
  private broadcastAnnotationUpdate(team: Team, by: string, annotations: Annotation[]): void {
    const message = { t: 'annotation_update', by, annotations: annotations.map(toWireAnnotation) };
    this.broadcastToTeam(team, message);
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

    // Re-read after a possible flag-fall above — abandonment only applies to
    // a game that's still actually running.
    const gameAfterFlagFall = this.room?.game;
    if (this.room && gameAfterFlagFall && gameAfterFlagFall.status === 'ACTIVE') {
      const room = this.room;
      const abandonedTeams = (['WHITE', 'BLACK'] as const).filter((team) => {
        const deadline = abandonmentDeadline(room.seats, team, room.settings.disconnectGraceMs);
        return deadline !== null && now >= deadline;
      });
      if (abandonedTeams.length > 0) {
        await this.resolveTeamAbandonment(gameAfterFlagFall, abandonedTeams, now);
      }
    }

    // Re-read again — a resign/draw-accept vote resolving via `handleVote`
    // can't race the alarm (both run on the DO's single execution thread),
    // but a flag-fall/abandonment resolution just above can end the game
    // before any of its votes would otherwise have expired.
    const gameForVotes = this.room?.game;
    if (this.room && gameForVotes && gameForVotes.status === 'ACTIVE') {
      const expired = expireVotes(gameForVotes, now);
      if (expired !== gameForVotes) {
        this.room = { ...this.room, game: expired };
        await this.persist();
        await this.broadcastState();
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
    this.room = { ...room, game: { ...game, status, winner, clock }, phase: 'FINISHED' };
    await this.persist();
    await this.broadcastState();
    this.broadcastAll({ t: 'game_over', status, winner, reason: GAME_OVER_REASON[status] });
  }

  /**
   * Ends the game by abandonment (§9) — every seat on each of `abandonedTeams`
   * has been disconnected past `settings.disconnectGraceMs`. Mirrors
   * `resolveFlagFall`'s clock-freezing (`remainingMs` at `now`, not whatever
   * the stored value was) so a game nobody was around to finish doesn't leave
   * a stale-looking clock behind.
   */
  private async resolveTeamAbandonment(game: GameState, abandonedTeams: Team[], now: number): Promise<void> {
    const room = this.room;
    if (!room || !room.game) return;

    const { status, winner } = resolveAbandonment(abandonedTeams);
    const clock = {
      whiteMs: remainingMs(game.clock, 'WHITE', game.sideToMove, now),
      blackMs: remainingMs(game.clock, 'BLACK', game.sideToMove, now),
      turnStartedAt: null,
      running: false,
    };
    this.room = { ...room, game: { ...game, status, winner, clock }, phase: 'FINISHED' };
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
   * a game is in progress), each team's abandonment deadline, and every
   * pending vote's expiry (T-25) — and arms `ctx.storage.setAlarm()` for
   * whichever is soonest. The only place that calls `setAlarm`/`deleteAlarm`,
   * so every caller (join/rehydrate, start_game, propose, vote, the alarm
   * handler itself) routes through here rather than poking the alarm
   * directly.
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

    for (const team of ['WHITE', 'BLACK'] as const) {
      const deadline = abandonmentDeadline(room.seats, team, room.settings.disconnectGraceMs);
      if (deadline !== null) deadlines.push(deadline);
    }

    for (const vote of game.pendingVotes) {
      deadlines.push(vote.expiresAt);
    }

    await this.ctx.storage.setAlarm(Math.min(...deadlines));
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    ws.close(RESERVED_CLOSE_CODES.has(code) ? 1000 : code, reason);

    const attachment = ws.deserializeAttachment();
    if (!isSocketAttachment(attachment) || !this.room) return;

    this.room = setConnected(this.room, attachment.seatId, false, Date.now());
    await this.persist();
    await this.broadcastState();
    // §9: a disconnect can newly start (or shorten) a team's abandonment
    // grace deadline — re-derive the alarm immediately rather than waiting
    // for whatever was already scheduled (worst case, the next ~5s clock
    // sync) to happen to catch it.
    await this.scheduleAlarm();
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
        // §9: reconnecting can clear a team's abandonment deadline — re-derive
        // the alarm right away rather than leaving a stale one armed.
        await this.scheduleAlarm();
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
      if (!isSocketOpen(socket)) continue;
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

  /** §7: "RTT measurement; server replies `pong`" — echoes `ts` straight back with the server's own clock, no room state touched. */
  private handlePing(ws: WebSocket, ts: number): void {
    if (!isSocketOpen(ws)) return;
    ws.send(JSON.stringify({ t: 'pong', ts, serverNow: Date.now() }));
  }

  /**
   * Sends the same message verbatim to every joined socket — for message
   * types whose payload is already public (`move_committed`, `game_over`)
   * and so has no per-viewer redaction to do, unlike `broadcastState()`.
   */
  private broadcastAll(message: Record<string, unknown>): void {
    const json = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (!isSocketOpen(socket) || !isSocketAttachment(socket.deserializeAttachment())) continue;
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

  /**
   * Test-only vote-expiry override, same precedent and reason as
   * `debugSetTimeControl` above: T-25's harness tests need a genuinely short
   * expiry to prove the alarm actually clears a lapsed vote, rather than
   * waiting out the real 30s window. Not part of `Room`/`RoomSettings` (§4.5
   * never lists it as configurable), so — like `voteExpiryMs` itself — this
   * doesn't persist and resets to `VOTE_EXPIRY_MS` on eviction.
   */
  debugSetVoteExpiryMs(ms: number): void {
    this.voteExpiryMs = ms;
  }
}

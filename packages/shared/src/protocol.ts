/**
 * Wire protocol, per docs/DESIGN.md §7 "Wire protocol".
 *
 * Every message is `{ t: string, ...payload }`. Client messages carry an
 * optional idempotency `nonce`; server responses that answer a specific
 * client message echo it back.
 *
 * `parseClientMessage` / `parseServerMessage` are the only sanctioned entry
 * points for turning wire bytes into typed values — nothing else should call
 * `JSON.parse` and trust the result (rule 7 in CLAUDE.md).
 */
import { z } from 'zod';
import { isValidRoomCode } from './codes.js';
import type {
  AnnotationColor,
  ChatChannel,
  ChatMessage,
  ClientRoomView,
  ClockState,
  ErrorCode,
  GameStatus,
  PromotionPiece,
  PublicGameState,
  PublicSeat,
  PublicSpectator,
  RoomSettings,
  Square,
  Team,
  TeamVoteKind,
  TimeControl,
  WireAnnotation,
  WireProposal,
  WireTeamVote,
} from './types.js';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export const teamSchema: z.ZodType<Team> = z.enum(['WHITE', 'BLACK']);

export const squareSchema: z.ZodType<Square> = z
  .string()
  .regex(/^[a-h][1-8]$/)
  .transform((s) => s as Square);

export const promotionPieceSchema: z.ZodType<PromotionPiece> = z.enum(['q', 'r', 'b', 'n']);

export const usernameSchema = z.string().trim().min(2).max(16);

export const roomCodeSchema = z.string().refine(isValidRoomCode, {
  message: 'not a valid room code',
});

const nonceSchema = z.string().min(1).max(64).optional();

function withNonce<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.object({ ...shape, nonce: nonceSchema });
}

// ---------------------------------------------------------------------------
// Client → Server messages
// ---------------------------------------------------------------------------

export const joinMessageSchema = withNonce({
  t: z.literal('join'),
  code: roomCodeSchema,
  username: usernameSchema,
  resumeToken: z.string().min(1).optional(),
});

export const setTeamMessageSchema = withNonce({
  t: z.literal('set_team'),
  team: teamSchema.nullable(),
});

export const setReadyMessageSchema = withNonce({
  t: z.literal('set_ready'),
  ready: z.boolean(),
});

export const timeControlSchema: z.ZodType<TimeControl> = z.object({
  baseMs: z.number().int().nonnegative(),
  incrementMs: z.number().int().nonnegative(),
  label: z.string().min(1),
});

export const roomSettingsSchema: z.ZodType<RoomSettings> = z.object({
  timeControl: timeControlSchema,
  randomizeColors: z.boolean(),
  allowSpectators: z.boolean(),
  disconnectGraceMs: z.number().int().nonnegative(),
});

export const updateSettingsMessageSchema = withNonce({
  t: z.literal('update_settings'),
  settings: roomSettingsSchema,
});

export const startGameMessageSchema = withNonce({
  t: z.literal('start_game'),
});

/** Host-only "Randomize teams" (§5.4) — no payload, `RoomDO` reseats every player. */
export const randomizeTeamsMessageSchema = withNonce({
  t: z.literal('randomize_teams'),
});

export const proposeMessageSchema = withNonce({
  t: z.literal('propose'),
  from: squareSchema,
  to: squareSchema,
  promotion: promotionPieceSchema.optional(),
});

export const withdrawMessageSchema = withNonce({
  t: z.literal('withdraw'),
  proposalId: z.string().min(1),
});

export const acceptMessageSchema = withNonce({
  t: z.literal('accept'),
  proposalId: z.string().min(1),
});

export const rejectMessageSchema = withNonce({
  t: z.literal('reject'),
  proposalId: z.string().min(1),
});

export const teamVoteKindSchema: z.ZodType<TeamVoteKind> = z.enum([
  'RESIGN',
  'DRAW_OFFER',
  'DRAW_ACCEPT',
  'TAKEBACK',
]);

export const voteMessageSchema = withNonce({
  t: z.literal('vote'),
  kind: teamVoteKindSchema,
});

export const chatChannelSchema: z.ZodType<ChatChannel> = z.enum(['TEAM', 'ALL']);

export const chatMessageInputSchema = withNonce({
  t: z.literal('chat'),
  text: z.string().trim().min(1).max(300),
  channel: chatChannelSchema,
});

export const annotationColorSchema: z.ZodType<AnnotationColor> = z.enum(['A', 'B']);

const circleAnnotationSchema = z.object({
  kind: z.literal('CIRCLE'),
  from: squareSchema,
  color: annotationColorSchema,
});

const arrowAnnotationSchema = z.object({
  kind: z.literal('ARROW'),
  from: squareSchema,
  to: squareSchema,
  color: annotationColorSchema,
});

/** A single annotation as sent/received over the wire — author is implicit. */
export const wireAnnotationSchema: z.ZodType<WireAnnotation> = z.discriminatedUnion('kind', [
  circleAnnotationSchema,
  arrowAnnotationSchema,
]);

export const annotateMessageSchema = withNonce({
  t: z.literal('annotate'),
  annotations: z.array(wireAnnotationSchema),
});

export const promoteSpectatorMessageSchema = withNonce({
  t: z.literal('promote_spectator'),
  publicId: z.string().min(1),
  team: teamSchema,
});

export const pingMessageSchema = withNonce({
  t: z.literal('ping'),
  ts: z.number(),
});

export const clientMessageSchema = z.discriminatedUnion('t', [
  joinMessageSchema,
  setTeamMessageSchema,
  setReadyMessageSchema,
  updateSettingsMessageSchema,
  startGameMessageSchema,
  randomizeTeamsMessageSchema,
  proposeMessageSchema,
  withdrawMessageSchema,
  acceptMessageSchema,
  rejectMessageSchema,
  voteMessageSchema,
  chatMessageInputSchema,
  annotateMessageSchema,
  promoteSpectatorMessageSchema,
  pingMessageSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------------------------------------------------------------------------
// Server → Client messages
// ---------------------------------------------------------------------------

const publicSeatSchema: z.ZodType<PublicSeat> = z.object({
  publicId: z.string(),
  username: z.string(),
  team: teamSchema.nullable(),
  isHost: z.boolean(),
  connected: z.boolean(),
  lastSeenAt: z.number(),
  ready: z.boolean(),
});

const publicSpectatorSchema: z.ZodType<PublicSpectator> = z.object({
  publicId: z.string(),
  username: z.string(),
  connected: z.boolean(),
  joinedAt: z.number(),
});

const clockStateSchema: z.ZodType<ClockState> = z.object({
  whiteMs: z.number(),
  blackMs: z.number(),
  turnStartedAt: z.number().nullable(),
  running: z.boolean(),
});

const gameStatusSchema: z.ZodType<GameStatus> = z.enum([
  'ACTIVE',
  'CHECKMATE',
  'STALEMATE',
  'DRAW',
  'TIMEOUT',
  'RESIGNED',
  'ABANDONED',
]);

const wireTeamVoteSchema: z.ZodType<WireTeamVote> = z.object({
  kind: teamVoteKindSchema,
  initiator: teamSchema,
  agreedSeats: z.array(z.string()),
  expiresAt: z.number(),
});

const publicGameStateSchema: z.ZodType<PublicGameState> = z.object({
  fen: z.string(),
  moveHistory: z.array(z.string()),
  sideToMove: teamSchema,
  clock: clockStateSchema,
  status: gameStatusSchema,
  winner: teamSchema.nullable(),
  drawOffer: z.object({ by: teamSchema, at: z.number() }).nullable(),
  pendingVotes: z.array(wireTeamVoteSchema),
});

/** `by` is the proposer's publicId on the wire, never their seatId (§10). */
const wireProposalSchema: z.ZodType<WireProposal> = z.object({
  id: z.string(),
  by: z.string(),
  from: squareSchema,
  to: squareSchema,
  promotion: promotionPieceSchema.optional(),
  san: z.string(),
  proposedAt: z.number(),
});

export const chatMessageSchema: z.ZodType<ChatMessage> = z.object({
  id: z.string(),
  from: z.string(),
  fromName: z.string(),
  channel: chatChannelSchema,
  team: teamSchema.nullable(),
  isSpectator: z.boolean(),
  text: z.string().max(300),
  at: z.number(),
});

// `satisfies`, not `: z.ZodType<ClientRoomView>` — an explicit annotation
// widens to the abstract ZodType base and loses `.extend()`, which
// stateMessageSchema needs below.
const clientRoomViewSchema = z.object({
  code: roomCodeSchema,
  phase: z.enum(['LOBBY', 'TEAM_SELECT', 'IN_GAME', 'FINISHED']),
  seats: z.array(publicSeatSchema),
  spectators: z.array(publicSpectatorSchema),
  settings: roomSettingsSchema,
  game: publicGameStateSchema.nullable(),
  chat: z.array(chatMessageSchema),
  you: z.string(),
  proposal: wireProposalSchema.nullable(),
  annotations: z.array(wireAnnotationSchema),
}) satisfies z.ZodType<ClientRoomView>;

export const stateMessageSchema = clientRoomViewSchema.extend({
  t: z.literal('state'),
  seq: z.number().int().nonnegative(),
  // Present only on the `state` sent to a socket that just (re)joined —
  // carries the opaque token it should hold onto for §9 reconnection. Never
  // broadcast to any other socket.
  resumeToken: z.string().min(1).optional(),
});

export const patchMessageSchema = z.object({
  t: z.literal('patch'),
  seq: z.number().int().nonnegative(),
  changes: z.record(z.string(), z.unknown()),
});

export const proposalUpdateMessageSchema = z.object({
  t: z.literal('proposal_update'),
  proposal: wireProposalSchema.nullable(),
});

export const annotationUpdateMessageSchema = z.object({
  t: z.literal('annotation_update'),
  by: z.string(),
  annotations: z.array(wireAnnotationSchema),
});

export const chatMessageBroadcastSchema = z.object({
  t: z.literal('chat_message'),
  message: chatMessageSchema,
});

export const spectatorsUpdateMessageSchema = z.object({
  t: z.literal('spectators_update'),
  count: z.number().int().nonnegative(),
  list: z.array(publicSpectatorSchema),
});

export const moveCommittedMessageSchema = z.object({
  t: z.literal('move_committed'),
  san: z.string(),
  fen: z.string(),
  clock: clockStateSchema,
  by: z.string(),
  confirmedBy: z.string().optional(),
});

export const clockSyncMessageSchema = z.object({
  t: z.literal('clock_sync'),
  whiteMs: z.number(),
  blackMs: z.number(),
  turnStartedAt: z.number().nullable(),
  serverNow: z.number(),
});

export const gameOverMessageSchema = z.object({
  t: z.literal('game_over'),
  status: gameStatusSchema,
  winner: teamSchema.nullable(),
  reason: z.string(),
});

export const errorCodeSchema: z.ZodType<ErrorCode> = z.enum([
  'ILLEGAL_MOVE',
  'NOT_YOUR_TURN',
  'CANNOT_SELF_ACCEPT',
  'PROPOSAL_CHANGED',
  'ROOM_FULL',
  'SPECTATORS_DISABLED',
  'RATE_LIMITED',
  'NOT_HOST',
  'TEAM_FULL',
  'SEAT_NOT_FOUND',
  'SPECTATOR_NOT_FOUND',
  'INVALID_PHASE',
  'INVALID_MESSAGE',
  'NOT_JOINED',
  'TEAM_SIZE_INVALID',
  'NOT_ALL_READY',
  'NOT_PROPOSER',
  'CANNOT_SELF_REJECT',
  'TEAM_CHAT_UNAVAILABLE',
  'VOTE_NOT_SUPPORTED',
  'NO_DRAW_OFFER',
]);

export const errorMessageSchema = z.object({
  t: z.literal('error'),
  code: errorCodeSchema,
  message: z.string(),
  nonce: nonceSchema,
});

export const pongMessageSchema = z.object({
  t: z.literal('pong'),
  ts: z.number(),
  serverNow: z.number(),
});

export const serverMessageSchema = z.discriminatedUnion('t', [
  stateMessageSchema,
  patchMessageSchema,
  proposalUpdateMessageSchema,
  annotationUpdateMessageSchema,
  chatMessageBroadcastSchema,
  spectatorsUpdateMessageSchema,
  moveCommittedMessageSchema,
  clockSyncMessageSchema,
  gameOverMessageSchema,
  errorMessageSchema,
  pongMessageSchema,
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;

// ---------------------------------------------------------------------------
// Parsing entry points
// ---------------------------------------------------------------------------

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };

function toParseResult<T>(result: z.ZodSafeParseResult<T>): ParseResult<T> {
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return { ok: false, issues: result.error.issues.map((issue) => issue.message) };
}

/** The only sanctioned way to turn an inbound wire message into a typed value. */
export function parseClientMessage(raw: unknown): ParseResult<ClientMessage> {
  return toParseResult(clientMessageSchema.safeParse(raw));
}

export function parseServerMessage(raw: unknown): ParseResult<ServerMessage> {
  return toParseResult(serverMessageSchema.safeParse(raw));
}

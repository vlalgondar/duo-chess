/**
 * Domain types, per docs/DESIGN.md §6 "Data model" and §7 "Wire protocol".
 *
 * Pure types only — no zod, no runtime code. Wire-level validation schemas
 * live in protocol.ts and are kept structurally in sync with these.
 */

export type Team = 'WHITE' | 'BLACK';

/** Server-issued, private to the owning client. Never broadcast (§10). */
export type SeatId = string;

/** 6-character join code. See codes.ts for the alphabet and generator. */
export type RoomCode = string;

type File = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
type Rank = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
export type Square = `${File}${Rank}`;

export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

export interface Seat {
  seatId: SeatId;
  publicId: string;
  username: string;
  team: Team | null;
  isHost: boolean;
  connected: boolean;
  lastSeenAt: number;
  ready: boolean;
}

/** A Seat as it may appear on the wire: seatId stripped (§10). */
export type PublicSeat = Omit<Seat, 'seatId'>;

export interface Spectator {
  seatId: SeatId;
  publicId: string;
  username: string;
  connected: boolean;
  joinedAt: number;
}

export type PublicSpectator = Omit<Spectator, 'seatId'>;

export interface TimeControl {
  baseMs: number;
  incrementMs: number;
  label: string;
}

export interface Proposal {
  id: string;
  by: SeatId;
  from: Square;
  to: Square;
  promotion?: PromotionPiece | undefined;
  san: string;
  proposedAt: number;
}

/** A Proposal as it travels over the wire: `by` is the proposer's publicId, never their seatId (§10). */
export type WireProposal = Omit<Proposal, 'by'> & { by: string };

export type AnnotationColor = 'A' | 'B';

export interface Annotation {
  by: SeatId;
  kind: 'CIRCLE' | 'ARROW';
  from: Square;
  to?: Square | undefined;
  color: AnnotationColor;
}

/** An Annotation as it travels with an already-known author (§10). */
export type WireAnnotation = Omit<Annotation, 'by'>;

export type ChatChannel = 'TEAM' | 'ALL';

export interface ChatMessage {
  id: string;
  from: string; // publicId
  fromName: string;
  channel: ChatChannel;
  team: Team | null;
  isSpectator: boolean;
  text: string; // <= 300 chars
  at: number;
}

export interface ClockState {
  whiteMs: number;
  blackMs: number;
  turnStartedAt: number | null;
  running: boolean;
}

export type GameStatus =
  'ACTIVE' | 'CHECKMATE' | 'STALEMATE' | 'DRAW' | 'TIMEOUT' | 'RESIGNED' | 'ABANDONED';

export type TeamVoteKind = 'RESIGN' | 'DRAW_OFFER' | 'DRAW_ACCEPT' | 'TAKEBACK';

export interface TeamVote {
  kind: TeamVoteKind;
  initiator: Team;
  agreedSeats: Set<SeatId>;
  expiresAt: number;
}

/** A TeamVote as it travels over JSON: `Set` has no wire representation. */
export type WireTeamVote = Omit<TeamVote, 'agreedSeats'> & { agreedSeats: SeatId[] };

export interface GameState {
  fen: string;
  moveHistory: string[]; // SAN
  sideToMove: Team;
  proposals: Record<Team, Proposal | null>;
  annotations: Record<Team, Annotation[]>;
  clock: ClockState;
  status: GameStatus;
  winner: Team | null;
  drawOffer: { by: Team; at: number } | null;
  pendingVotes: TeamVote[];
}

/** A GameState as it travels to a client: per-team secrets stripped (§4.3, §10). */
export type PublicGameState = Omit<GameState, 'proposals' | 'annotations' | 'pendingVotes'> & {
  pendingVotes: WireTeamVote[];
};

export type RoomPhase = 'LOBBY' | 'TEAM_SELECT' | 'IN_GAME' | 'FINISHED';

export interface RoomSettings {
  timeControl: TimeControl;
  randomizeColors: boolean;
  allowSpectators: boolean;
  disconnectGraceMs: number; // default 90_000
}

export interface Room {
  code: RoomCode;
  createdAt: number;
  phase: RoomPhase;
  seats: Seat[]; // max 4 players
  spectators: Spectator[]; // max 20
  chat: ChatMessage[]; // last 100 retained
  settings: RoomSettings;
  game: GameState | null;
}

/**
 * The output of `redactFor()` (§6, built in T-08) — the only room shape ever
 * sent to a client. `proposal`/`annotations` are the viewer's own team only;
 * a spectator gets `null`/`[]`.
 */
export interface ClientRoomView {
  code: RoomCode;
  phase: RoomPhase;
  seats: PublicSeat[];
  spectators: PublicSpectator[];
  settings: RoomSettings;
  game: PublicGameState | null;
  chat: ChatMessage[];
  you: string; // publicId
  proposal: WireProposal | null;
  annotations: WireAnnotation[];
}

/**
 * §7 "Server → Client" error codes.
 *
 * `NOT_HOST`, `TEAM_FULL`, `SEAT_NOT_FOUND`, `SPECTATOR_NOT_FOUND`, and
 * `INVALID_PHASE` are room-lifecycle rejections (T-07) not enumerated in the
 * §7 table; the table's list wasn't exhaustive over every action added since
 * it was written, so this union is extended additively as new rejections
 * come up rather than treated as closed. `INVALID_MESSAGE` (malformed JSON or
 * a schema rejection) and `NOT_JOINED` (any message before `join` completes)
 * are the transport-level rejections added by the Durable Object (T-09).
 * `TEAM_SIZE_INVALID` is `start_game`'s rejection (T-14) when the room isn't
 * exactly two seats — Team Select (T-17) doesn't exist yet, so `start_game`
 * only supports the 1v1 case for now.
 */
export type ErrorCode =
  | 'ILLEGAL_MOVE'
  | 'NOT_YOUR_TURN'
  | 'CANNOT_SELF_ACCEPT'
  | 'PROPOSAL_CHANGED'
  | 'ROOM_FULL'
  | 'SPECTATORS_DISABLED'
  | 'RATE_LIMITED'
  | 'NOT_HOST'
  | 'TEAM_FULL'
  | 'SEAT_NOT_FOUND'
  | 'SPECTATOR_NOT_FOUND'
  | 'INVALID_PHASE'
  | 'INVALID_MESSAGE'
  | 'NOT_JOINED'
  | 'TEAM_SIZE_INVALID';

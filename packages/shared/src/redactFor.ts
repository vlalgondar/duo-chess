/**
 * The single choke point from server `Room` state to the wire (§6, §10).
 *
 * A team's live proposal, annotations, and `TEAM` chat are secrets shared by
 * exactly two seats; a spectator is a third team with no members and gets
 * `null`/`[]`/no `TEAM` messages. No other function may serialize a room —
 * if you find yourself writing a second one, stop (CLAUDE.md rule 3).
 */
import type {
  Annotation,
  ClientRoomView,
  GameState,
  Proposal,
  PublicGameState,
  PublicSeat,
  PublicSpectator,
  Room,
  Seat,
  Spectator,
  Team,
  TeamVote,
  WireAnnotation,
  WireProposal,
  WireTeamVote,
} from './types.js';

function toPublicSeat(seat: Seat): PublicSeat {
  const { seatId: _seatId, ...publicSeat } = seat;
  return publicSeat;
}

function toPublicSpectator(spectator: Spectator): PublicSpectator {
  const { seatId: _seatId, ...publicSpectator } = spectator;
  return publicSpectator;
}

/**
 * `by` is server-internal (§10); the wire form leaves it off entirely (a
 * teammate's fixed `color` already identifies who drew it). Exported so
 * `RoomDO`'s team-scoped `annotation_update` broadcast (T-22) can build the
 * same wire shape without a second seatId-stripping implementation, mirroring
 * `toWireProposal` above.
 */
export function toWireAnnotation(annotation: Annotation): WireAnnotation {
  const { by: _by, ...wireAnnotation } = annotation;
  return wireAnnotation;
}

/**
 * `agreedSeats` is server-internal (§10), same as `Proposal.by` — the wire form identifies each
 * agreeing teammate by publicId instead (T-25, fixing the leak TASKS.md's Findings flagged when
 * T-08 built this choke point ahead of team votes actually existing).
 */
function toWireTeamVote(room: Room, vote: TeamVote): WireTeamVote {
  const agreedSeats = [...vote.agreedSeats].map((seatId) => room.seats.find((s) => s.seatId === seatId)?.publicId ?? '');
  return { ...vote, agreedSeats };
}

/**
 * `by` is server-internal (§10); the wire form identifies the proposer by
 * publicId instead. Exported (not just used by `redactFor` itself) so
 * `RoomDO`'s team-scoped `proposal_update` broadcast (T-20) can build the
 * same wire shape without a second seatId->publicId lookup — this is still
 * the one function that knows how to do that translation, just called from
 * two broadcast paths instead of one.
 */
export function toWireProposal(room: Room, proposal: Proposal): WireProposal {
  const proposer = room.seats.find((s) => s.seatId === proposal.by);
  const { by: _by, ...rest } = proposal;
  return { ...rest, by: proposer?.publicId ?? '' };
}

function toPublicGameState(room: Room, game: GameState): PublicGameState {
  const { proposals: _proposals, annotations: _annotations, pendingVotes, ...rest } = game;
  return { ...rest, pendingVotes: pendingVotes.map((v) => toWireTeamVote(room, v)) };
}

function teamOf(viewer: Seat | Spectator): Team | null {
  return 'team' in viewer ? viewer.team : null;
}

/** `seatId` never appears in the return value, directly or nested — see redactFor.test.ts. */
export function redactFor(room: Room, viewer: Seat | Spectator): ClientRoomView {
  const team = teamOf(viewer);
  const proposal = team ? (room.game?.proposals[team] ?? null) : null;
  const annotations: Annotation[] = team ? (room.game?.annotations[team] ?? []) : [];

  return {
    code: room.code,
    phase: room.phase,
    seats: room.seats.map(toPublicSeat),
    spectators: room.spectators.map(toPublicSpectator),
    settings: room.settings,
    game: room.game ? toPublicGameState(room, room.game) : null,
    chat: room.chat.filter((m) => m.channel === 'ALL' || m.team === team),
    you: viewer.publicId,
    proposal: proposal ? toWireProposal(room, proposal) : null,
    annotations: annotations.map(toWireAnnotation),
  };
}


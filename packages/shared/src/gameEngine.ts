/**
 * Authoritative move engine, per docs/DESIGN.md §4.1.
 *
 * "`chess.js` covers all of the following; the spec is here so acceptance
 * testing has something to check against" — so this module is a thin,
 * pure wrapper: `chess.js` owns every legality rule (check, castling
 * conditions, en passant, promotion, draw detection), this module owns
 * turning that into `GameState` transitions. No I/O, no `Date.now()` (rule 1).
 *
 * Threefold repetition and the fifty-move rule depend on the *sequence* of
 * positions, not just the current FEN (the FEN's halfmove clock alone isn't
 * enough for repetition), so every check replays `moveHistory` (SAN) from
 * the start position through a fresh `chess.js` instance rather than trusting
 * `fen` in isolation.
 */
import { Chess } from 'chess.js';
import { advanceClock, remainingMs, startClock } from './clock.js';
import type {
  Annotation,
  AnnotationColor,
  ErrorCode,
  GameState,
  GameStatus,
  Proposal,
  PromotionPiece,
  SeatId,
  Square,
  Team,
  TeamVote,
  TeamVoteKind,
  TimeControl,
  WireAnnotation,
} from './types.js';

export type GameEngineResult<T> = { ok: true; value: T } | { ok: false; code: ErrorCode };

function ok<T>(value: T): GameEngineResult<T> {
  return { ok: true, value };
}

function fail<T>(code: ErrorCode): GameEngineResult<T> {
  return { ok: false, code };
}

export interface MoveInput {
  from: Square;
  to: Square;
  promotion?: PromotionPiece | undefined;
}

export interface LegalMove extends MoveInput {
  san: string;
}

function replay(sanHistory: readonly string[], startFen?: string): Chess {
  const chess = startFen !== undefined ? new Chess(startFen) : new Chess();
  for (const san of sanHistory) {
    chess.move(san);
  }
  return chess;
}

function endStateOf(chess: Chess): { status: GameStatus; winner: Team | null } {
  if (chess.isCheckmate()) {
    return { status: 'CHECKMATE', winner: chess.turn() === 'w' ? 'BLACK' : 'WHITE' };
  }
  if (chess.isStalemate()) return { status: 'STALEMATE', winner: null };
  if (chess.isInsufficientMaterial()) return { status: 'DRAW', winner: null };
  if (chess.isThreefoldRepetition()) return { status: 'DRAW', winner: null };
  if (chess.isDrawByFiftyMoves()) return { status: 'DRAW', winner: null };
  return { status: 'ACTIVE', winner: null };
}

/**
 * Every legal move from `fen`, one entry per promotion choice (so a pawn
 * reaching the last rank contributes four entries) — the shape perft needs.
 */
export function legalMoves(fen: string): LegalMove[] {
  const chess = new Chess(fen);
  return chess.moves({ verbose: true }).map((m) => ({
    from: m.from as Square,
    to: m.to as Square,
    promotion: m.promotion as PromotionPiece | undefined,
    san: m.san,
  }));
}

/**
 * Checkmate/stalemate/draw detection (§4.1) over the full SAN history.
 *
 * `startFen` is a test seam: real games always replay from the standard
 * starting position (the only one `startGame` ever produces), so production
 * callers omit it. It lets tests reach draw conditions — fifty-move,
 * insufficient material — that would otherwise need dozens of real moves to
 * set up, by seeding the position directly instead.
 */
export function checkGameEnd(
  sanHistory: readonly string[],
  startFen?: string,
): { status: GameStatus; winner: Team | null } {
  return endStateOf(replay(sanHistory, startFen));
}

export function startGame(timeControl: TimeControl): GameState {
  return {
    fen: new Chess().fen(),
    moveHistory: [],
    sideToMove: 'WHITE',
    proposals: { WHITE: null, BLACK: null },
    annotations: { WHITE: [], BLACK: [] },
    clock: startClock(timeControl),
    status: 'ACTIVE',
    winner: null,
    drawOffer: null,
    pendingVotes: [],
  };
}

/**
 * Applies one team's move to `game`. Legality — including check, castling
 * conditions, and en passant — is delegated entirely to `chess.js`, replayed
 * from `moveHistory` so repetition/fifty-move state is exact rather than
 * reconstructed from a single FEN. Clears both teams' proposals and
 * annotations (§4.3 rule 7: cleared on *every* commit, including the
 * opponent's) and re-derives `status`/`winner`. Also clears any live draw
 * offer and in-progress team votes (§4.5) — an offer or a resign/draw vote
 * that wasn't settled before the next move is stale by the time it lands,
 * the same "fresh slate on commit" reasoning already applied to proposals.
 *
 * Clock advancement (§4.6: increment on commit, idle until White's first
 * commit, unlimited mode) is `clock.ts`'s `advanceClock` — see there for the
 * arithmetic. Once the move ends the game, the clock stops running: there's
 * no next side to move, so nothing should still look like it's ticking.
 * Flag-fall *detection* (the alarm that ends a game nobody committed to) is
 * T-16's scope, not this function's — a move is never rejected here for
 * arriving after time technically expired.
 *
 * `startFen` is the same test seam as `checkGameEnd`'s — production callers
 * always omit it, since `game.moveHistory` is only ever meaningful relative
 * to the standard start.
 */
export function commitMove(
  game: GameState,
  move: MoveInput,
  mover: Team,
  now: number,
  timeControl: TimeControl,
  startFen?: string,
): GameEngineResult<GameState> {
  if (game.status !== 'ACTIVE') return fail('ILLEGAL_MOVE');
  if (mover !== game.sideToMove) return fail('NOT_YOUR_TURN');

  const chess = replay(game.moveHistory, startFen);
  let applied;
  try {
    applied =
      move.promotion !== undefined
        ? chess.move({ from: move.from, to: move.to, promotion: move.promotion })
        : chess.move({ from: move.from, to: move.to });
  } catch {
    return fail('ILLEGAL_MOVE');
  }

  const moveHistory = [...game.moveHistory, applied.san];
  const { status, winner } = endStateOf(chess);
  const advanced = advanceClock(game.clock, mover, now, timeControl);
  const clock = status === 'ACTIVE' ? advanced : { ...advanced, running: false };

  return ok({
    ...game,
    fen: chess.fen(),
    moveHistory,
    sideToMove: chess.turn() === 'w' ? 'WHITE' : 'BLACK',
    proposals: { WHITE: null, BLACK: null },
    annotations: { WHITE: [], BLACK: [] },
    clock,
    status,
    winner,
    drawOffer: null,
    pendingVotes: [],
  });
}

/**
 * The propose/accept state machine, per docs/DESIGN.md §4.3: a single
 * versioned proposal slot per team. `team`/`by` are supplied by the caller
 * (the Durable Object, which knows the acting seat's team from `room.seats`)
 * rather than looked up here — this module has no seat roster, only the
 * game's own `proposals` slot.
 */

/** `v1`, then `v2`, `v3`, ... — regenerated on every replacement (rule 1). */
function nextProposalId(current: Proposal | null): string {
  const match = current !== null ? /^v(\d+)$/.exec(current.id) : null;
  const n = match !== null ? Number(match[1]) : 0;
  return `v${n + 1}`;
}

/** Validates `move` against `fen` and returns its SAN, without mutating any GameState. */
function tryMove(fen: string, move: MoveInput): { ok: true; san: string } | { ok: false } {
  const chess = new Chess(fen);
  try {
    const applied =
      move.promotion !== undefined
        ? chess.move({ from: move.from, to: move.to, promotion: move.promotion })
        : chess.move({ from: move.from, to: move.to });
    return { ok: true, san: applied.san };
  } catch {
    return { ok: false };
  }
}

/**
 * Proposes (or re-proposes, or counter-proposes) `move` for `team`'s slot.
 * Re-propose and counter-propose are the same call (rule 4 — "counter-proposing
 * is just proposing"): whichever teammate calls this becomes `by`, replacing
 * whatever was there and bumping the version.
 *
 * Validated for legality here (rule 8), against the *current* position only —
 * unlike `commitMove`, a proposal never needs the full history replay, since
 * threefold/fifty-move state can't change until something actually commits.
 */
export function proposeMove(
  game: GameState,
  team: Team,
  by: SeatId,
  move: MoveInput,
  now: number,
): GameEngineResult<GameState> {
  if (game.status !== 'ACTIVE') return fail('ILLEGAL_MOVE');
  if (team !== game.sideToMove) return fail('NOT_YOUR_TURN');

  const attempt = tryMove(game.fen, move);
  if (!attempt.ok) return fail('ILLEGAL_MOVE');

  const proposal: Proposal = {
    id: nextProposalId(game.proposals[team]),
    by,
    from: move.from,
    to: move.to,
    promotion: move.promotion,
    san: attempt.san,
    proposedAt: now,
  };
  return ok({ ...game, proposals: { ...game.proposals, [team]: proposal } });
}

/** Proposer withdraws their own live proposal, clearing the slot. */
export function withdrawProposal(
  game: GameState,
  team: Team,
  by: SeatId,
  proposalId: string,
): GameEngineResult<GameState> {
  const current = game.proposals[team];
  if (current === null || current.id !== proposalId) return fail('PROPOSAL_CHANGED');
  if (current.by !== by) return fail('NOT_PROPOSER');
  return ok({ ...game, proposals: { ...game.proposals, [team]: null } });
}

/** Accepter rejects the live proposal — a soft "try something else" (rule 6). */
export function rejectProposal(
  game: GameState,
  team: Team,
  by: SeatId,
  proposalId: string,
): GameEngineResult<GameState> {
  const current = game.proposals[team];
  if (current === null || current.id !== proposalId) return fail('PROPOSAL_CHANGED');
  if (current.by === by) return fail('CANNOT_SELF_REJECT');
  return ok({ ...game, proposals: { ...game.proposals, [team]: null } });
}

/**
 * Accepter confirms the live proposal, committing it via the same
 * `commitMove` every other path uses (T-14/T-19's "exactly one code path").
 * A stale `proposalId` — the slot changed since the client last rendered it —
 * commits nothing (rule 3). Self-accept is refused (rule 2).
 */
export function acceptProposal(
  game: GameState,
  team: Team,
  by: SeatId,
  proposalId: string,
  now: number,
  timeControl: TimeControl,
): GameEngineResult<GameState> {
  const current = game.proposals[team];
  if (current === null || current.id !== proposalId) return fail('PROPOSAL_CHANGED');
  if (current.by === by) return fail('CANNOT_SELF_ACCEPT');
  return commitMove(game, { from: current.from, to: current.to, promotion: current.promotion }, team, now, timeControl);
}

/**
 * §4.4: a team of more than one *connected* player must confirm a move via
 * propose/accept; a solo team doesn't. `teamSize` is the caller's count of
 * currently-connected seats on the team (e.g. `roomEngine.connectedTeamSize`)
 * — a 2-player team with a disconnected teammate is solo too (§9), which is
 * why this takes a plain count rather than re-deriving "solo" from a seat
 * roster this module never has.
 */
export function requiresConfirmation(teamSize: number): boolean {
  return teamSize > 1;
}

/**
 * A team member's move submission — the one entry point regardless of team
 * size, matching §4.4's "implemented as `propose()` immediately followed by
 * an internal auto-commit, so there's exactly one code path for applying
 * moves." A team that requires confirmation gets a real proposal, awaiting a
 * teammate's `acceptProposal`; a solo team's move commits immediately,
 * through the exact same `commitMove` every accepted proposal uses.
 */
/**
 * §5.9 board annotations: "Full replacement of your own set" — replaces
 * everything `by` previously drew in `team`'s array, leaving the teammate's
 * live scribbles (if any) untouched, rather than replacing the whole team
 * slot the way a proposal does. `color` comes from the caller
 * (`roomEngine.annotationColorFor`), not the wire payload — a teammate's
 * drawing color is fixed by seat order, not whatever a client claims.
 * Unlike every other mutation here, the result is never validated for
 * legality (annotations aren't moves) and never fails.
 */
export function setAnnotations(
  game: GameState,
  team: Team,
  by: SeatId,
  color: AnnotationColor,
  annotations: readonly WireAnnotation[],
): GameState {
  const authored: Annotation[] = annotations.map((a) => ({ ...a, by, color }));
  return {
    ...game,
    annotations: {
      ...game.annotations,
      [team]: [...game.annotations[team].filter((a) => a.by !== by), ...authored],
    },
  };
}

/**
 * §9: "If both members of a team disconnect past the grace period, the game
 * is abandoned and the opposing team wins." Generalizes to any team with
 * zero *connected* seats, solo or 2-player alike — the same "temporarily
 * treated as solo" symmetry `requiresConfirmation`/`connectedTeamSize` already
 * use elsewhere, since a solo team's own player disconnecting is exactly as
 * game-ending as both members of a 2-player team going dark. `abandonedTeams`
 * is whichever teams the caller (`RoomDO`, from `roomEngine.abandonmentDeadline`)
 * found past their grace deadline on a given alarm tick; the pathological case
 * of both teams crossing it at once (e.g. the whole room dropped together) has
 * no team left to hand the win to, so it resolves winnerless rather than
 * picking one arbitrarily.
 */
export function resolveAbandonment(abandonedTeams: readonly Team[]): { status: GameStatus; winner: Team | null } {
  if (abandonedTeams.length !== 1) return { status: 'ABANDONED', winner: null };
  const [team] = abandonedTeams;
  return { status: 'ABANDONED', winner: team === 'WHITE' ? 'BLACK' : 'WHITE' };
}

export function submitMove(
  game: GameState,
  team: Team,
  by: SeatId,
  move: MoveInput,
  now: number,
  timeControl: TimeControl,
  teamSize: number,
): GameEngineResult<GameState> {
  const proposed = proposeMove(game, team, by, move, now);
  if (!proposed.ok) return proposed;
  if (requiresConfirmation(teamSize)) return proposed;

  const proposal = proposed.value.proposals[team]!;
  return commitMove(
    proposed.value,
    { from: proposal.from, to: proposal.to, promotion: proposal.promotion },
    team,
    now,
    timeControl,
  );
}

/**
 * §4.5: a resign/draw-offer/draw-accept vote has 30s for a 2-player team's
 * *other* member to agree before it lapses.
 */
export const VOTE_EXPIRY_MS = 30_000;

function opposingTeam(team: Team): Team {
  return team === 'WHITE' ? 'BLACK' : 'WHITE';
}

/** `remainingMs` for both teams at `now`, clock stopped — the same "freeze at the true live
 * value, not the stale stored one" treatment `RoomDO`'s own flag-fall/abandonment resolution
 * gives the clock (T-16/T-24), done here instead since `submitVote` already has full `GameState`
 * and `now` in hand.
 */
function freezeClock(game: GameState, now: number): GameState['clock'] {
  return {
    whiteMs: remainingMs(game.clock, 'WHITE', game.sideToMove, now),
    blackMs: remainingMs(game.clock, 'BLACK', game.sideToMove, now),
    turnStartedAt: null,
    running: false,
  };
}

/**
 * Applies an *agreed* vote's effect (§4.1's Resignation/Draw-agreement rows) and clears `team`'s
 * slot in `pendingVotes` — reached once a solo team votes at all, or a 2-player team's vote has
 * every connected member's agreement.
 */
function resolveVote(game: GameState, team: Team, kind: TeamVoteKind, now: number): GameState {
  const withoutOwnVote: GameState = {
    ...game,
    pendingVotes: game.pendingVotes.filter((v) => v.initiator !== team),
  };

  if (kind === 'RESIGN') {
    return { ...withoutOwnVote, status: 'RESIGNED', winner: opposingTeam(team), clock: freezeClock(game, now) };
  }
  if (kind === 'DRAW_ACCEPT') {
    return { ...withoutOwnVote, status: 'DRAW', winner: null, drawOffer: null, clock: freezeClock(game, now) };
  }
  // DRAW_OFFER: doesn't end the game — it goes to the opponents, who accept via their own vote.
  return { ...withoutOwnVote, drawOffer: { by: team, at: now } };
}

/**
 * A team member's `RESIGN`/`DRAW_OFFER`/`DRAW_ACCEPT` vote (§4.5), the generic `TeamVote`
 * mechanic: a solo team's vote (or a 2-player team with a disconnected member — `teamSize` is
 * the caller's *connected* count, same `requiresConfirmation`/`connectedTeamSize` convention
 * `submitMove` already uses) resolves immediately; a connected 2-player team's vote joins
 * whatever's already in `team`'s slot if it's the same `kind` (the teammate's agreement resolves
 * it), or replaces the slot with a fresh one otherwise — the same single-slot-per-team,
 * replace-on-mismatch shape `proposeMove`'s single proposal slot already uses.
 *
 * `TAKEBACK` is real wire protocol (§7) but not an implemented mechanic — TASKS.md's Backlog
 * lists takebacks as explicitly out of scope, and a `TeamVote` that resolves to nothing coherent
 * would be a half-built feature (CLAUDE.md's working agreement), so it's refused outright.
 * `DRAW_ACCEPT` requires a live offer from the *other* team — accepting your own team's offer,
 * or accepting when nothing was offered, is refused rather than silently ending the game.
 */
export function submitVote(
  game: GameState,
  team: Team,
  by: SeatId,
  kind: TeamVoteKind,
  now: number,
  teamSize: number,
  voteExpiryMs: number = VOTE_EXPIRY_MS,
): GameEngineResult<GameState> {
  if (game.status !== 'ACTIVE') return fail('ILLEGAL_MOVE');
  if (kind === 'TAKEBACK') return fail('VOTE_NOT_SUPPORTED');
  if (kind === 'DRAW_ACCEPT' && (game.drawOffer === null || game.drawOffer.by === team)) {
    return fail('NO_DRAW_OFFER');
  }

  if (!requiresConfirmation(teamSize)) {
    return ok(resolveVote(game, team, kind, now));
  }

  const current = game.pendingVotes.find((v) => v.initiator === team);
  const agreedSeats = new Set(current?.kind === kind ? current.agreedSeats : []);
  agreedSeats.add(by);

  if (agreedSeats.size >= teamSize) {
    return ok(resolveVote(game, team, kind, now));
  }

  const vote: TeamVote = { kind, initiator: team, agreedSeats, expiresAt: now + voteExpiryMs };
  return ok({ ...game, pendingVotes: [...game.pendingVotes.filter((v) => v.initiator !== team), vote] });
}

/** §4.5: an unresolved vote just lapses at `expiresAt` — no effect beyond clearing the slot. */
export function expireVotes(game: GameState, now: number): GameState {
  const pendingVotes = game.pendingVotes.filter((v) => v.expiresAt > now);
  return pendingVotes.length === game.pendingVotes.length ? game : { ...game, pendingVotes };
}

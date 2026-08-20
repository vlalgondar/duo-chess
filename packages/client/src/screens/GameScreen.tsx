import {
  annotationColorFor,
  connectedTeamSize,
  requiresConfirmation,
  type AnnotationColor,
  type ChatChannel,
  type ClientRoomView,
  type PromotionPiece,
  type PublicSeat,
  type Square,
  type Team,
  type TeamVoteKind,
  type WireAnnotation,
} from '@duo/shared';
import { Board, type ProposalOverlay } from '../components/Board.js';
import { BottomSheet } from '../components/BottomSheet.js';
import { Chat } from '../components/Chat.js';
import { Clock } from '../components/Clock.js';
import { SoundToggle } from '../components/SoundToggle.js';
import { Spectators } from '../components/Spectators.js';
import { TeamPanel } from '../components/TeamPanel.js';
import { VoteActions } from '../components/VoteActions.js';
import { Crown } from '../ui/Icon.js';
import { Panel } from '../ui/Panel.js';

interface GameScreenProps {
  view: ClientRoomView;
  onMove: (from: Square, to: Square, promotion?: PromotionPiece) => void;
  onAccept: (proposalId: string) => void;
  onReject: (proposalId: string) => void;
  onWithdraw: (proposalId: string) => void;
  onSendChat: (text: string, channel: ChatChannel) => void;
  onAnnotate: (annotations: WireAnnotation[]) => void;
  onVote: (kind: TeamVoteKind) => void;
  serverClockOffsetMs: number;
  soundEnabled: boolean;
  onToggleSound: () => void;
}

// docs/DESIGN.md §5.9's "team's accent color" — one color per team (not per teammate; that
// distinction is T-22's annotation colors), used for both the proposal ghost piece and arrow.
const TEAM_ACCENT: Record<'WHITE' | 'BLACK', string> = { WHITE: '#38bdf8', BLACK: '#c084fc' };

// §5.9: "each teammate gets a fixed color (Team 1: amber/cyan, Team 2: violet/lime)" — keyed by
// which chess side you're on (this data model has no separate Team 1/Team 2, per T-17's own
// judgment call), and deliberately distinct from `TEAM_ACCENT` above so a scribble is never
// mistaken for the live proposal.
const ANNOTATION_COLORS: Record<'WHITE' | 'BLACK', Record<AnnotationColor, string>> = {
  WHITE: { A: '#fbbf24', B: '#22d3ee' }, // amber-400 / cyan-400
  BLACK: { A: '#8b5cf6', B: '#a3e635' }, // violet-500 / lime-400
};

// Same §5.10 mobile formula BoardScreen's sandbox uses — see that file's comment for why the
// 220px deduction exists (bottom-sheet peeked height + flip-button headroom below 900px).
// Desktop (>=900px) keeps `w-full` (so a narrow-but->=900px window still shrinks the board to
// fit its actual flex column, same as before) but replaces the flat cap with a
// "min(cap, calc(100dvh - chrome))" ceiling. Chrome tally at >=900px, after the roster names
// were folded into the clock rows below (each row: 44 for the clock's text-xl/py-1.5/border-2):
// `p-6` (48) + header row (44) + gap (12) + clock row (44) + gap (12) + gap (12) + clock row
// (44) = 216px, rounded up to 250 for slack that covers `Spectators` rendering (+28) or the
// header wrapping to two lines on a narrow-but-desktop width (+52) — neither of which the specs
// exercise at 1280x720, but both are real states. `720` (was `560`) is the new flat cap; it only
// binds on very tall monitors (>=~970px viewport height), so raising it never shrinks anything.
// `max(360px, ...)` floors the board so it never shrinks to something unplayable on a very short
// window (a little scroll there is the better trade-off) — hence `min-h-dvh` below, not `h-dvh`:
// unlike ResultScreen's row layout, this column uses `justify-center`, and `h-dvh` would make a
// too-short window's overflow unreachable the same way ResultScreen's comment calls out.
const BOARD_SIZE_CLASSNAME =
  'mx-auto w-[min(100vw,calc(100dvh_-_220px))] min-[900px]:w-full min-[900px]:max-w-[max(360px,min(720px,calc(100dvh_-_250px)))]';

/**
 * Networked game screen (T-14, propose/accept UI wired up in T-20). No optimistic commit: the
 * board always renders `view.game.fen` as received from the server's `state` broadcast, and a
 * move attempt only ever sends `propose` (via `Board`'s `serverFen`/`onMove`). Below 900px the
 * team panel lives in the same `BottomSheet` T-12 built for the local sandbox; at/above it, a
 * static side panel next to the board — the exact §5.10/§5.5 split, now with live data instead
 * of `BoardScreen`'s disabled placeholder.
 */
export function GameScreen({
  view,
  onMove,
  onAccept,
  onReject,
  onWithdraw,
  onSendChat,
  onAnnotate,
  onVote,
  serverClockOffsetMs,
  soundEnabled,
  onToggleSound,
}: GameScreenProps) {
  const you = view.seats.find((seat) => seat.publicId === view.you);
  const yourTeam = you?.team ?? null;
  const orientation = yourTeam === 'BLACK' ? 'black' : 'white';
  const game = view.game;

  if (!game) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p data-testid="game-status" className="text-text-muted">
          Waiting for the game to start…
        </p>
      </main>
    );
  }

  const isYourTurn = yourTeam !== null && yourTeam === game.sideToMove;
  const locked = game.status !== 'ACTIVE' || !isYourTurn;

  const teamSize = yourTeam ? connectedTeamSize(view.seats, yourTeam) : 0;
  const needsConfirmation = yourTeam !== null && requiresConfirmation(teamSize);

  // §5.8: "Only if you're on a 2-player team" — the roster's full team size (not
  // `connectedTeamSize` above, which governs move-confirmation UX and treats a
  // disconnected teammate as solo), matching `sendChatMessage`'s own server-side check.
  const teamRosterSize = yourTeam ? view.seats.filter((s) => s.team === yourTeam).length : 0;
  const teamChatAvailable = yourTeam !== null && teamRosterSize >= 2;

  const proposal = view.proposal;
  const isProposer = proposal?.by === view.you;
  const proposerUsername = proposal ? view.seats.find((s) => s.publicId === proposal.by)?.username : undefined;
  const teammateSeat = view.seats.find((s) => s.team === yourTeam && s.publicId !== view.you);
  const teammateUsername = teammateSeat?.username;
  // §9: "the remaining teammate sees 'alice disconnected — you can move
  // alone'" — derived straight from the roster's own `connected` flag rather
  // than a dedicated wire message, since `PublicSeat` already carries it.
  const teammateDisconnected = teammateSeat !== undefined && !teammateSeat.connected;

  const boardProposal: ProposalOverlay | null =
    proposal && yourTeam
      ? { from: proposal.from, to: proposal.to, promotion: proposal.promotion, accentColor: TEAM_ACCENT[yourTeam] }
      : null;

  // T-22: undefined for a spectator/unassigned seat — no team to draw for, which is what turns
  // annotation drawing off in `Board` entirely.
  const ownAnnotationColor = yourTeam
    ? annotationColorFor(
        view.seats.filter((s) => s.team === yourTeam).map((s) => s.publicId),
        view.you,
      )
    : undefined;

  const statusText =
    game.status === 'ACTIVE'
      ? isYourTurn
        ? 'Your move'
        : "Opponent's move"
      : `Game over — ${game.status}${game.winner ? ` (${game.winner} wins)` : ''}`;

  // §4.6: `baseMs: 0` is "Unlimited — no clock" — nothing to show or interpolate.
  const showClocks = view.settings.timeControl.baseMs > 0;
  const top = orientation === 'white' ? 'BLACK' : 'WHITE';
  const bottom = orientation === 'white' ? 'WHITE' : 'BLACK';

  const teamPanelProps = {
    proposal,
    isProposer,
    proposerUsername,
    teammateUsername,
    requiresConfirmation: needsConfirmation,
    serverClockOffsetMs,
    onAccept,
    onReject,
    onWithdraw,
  };

  const chatProps = { messages: view.chat, teamChatAvailable, onSend: onSendChat };

  const isFinished = game.status !== 'ACTIVE';
  const topRoster = view.seats.filter((s) => s.team === top);
  const bottomRoster = view.seats.filter((s) => s.team === bottom);

  return (
    <main
      data-testid="game-shell"
      className="flex min-h-dvh flex-col min-[900px]:flex-row min-[900px]:items-stretch min-[900px]:justify-center min-[900px]:gap-6 min-[900px]:p-6"
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 pb-[220px] min-[900px]:gap-3 min-[900px]:p-0">
        {/* Mobile only: at 390px wide this column is ~870px tall (well past any phone's
            dvh), so a player scrolls to clear the fixed BottomSheet off the board — which
            used to carry the header, including Resign, off the top edge with it. Pinning
            it removes that dead zone. Inert at >=900px, where the column already fits and
            there's no sheet: `min-[900px]:*` resets it back to a plain child of the
            `gap-4 items-center` column, pixel-identical to the un-wrapped siblings before
            this change. */}
        {/* This row stays `flex-row flex-wrap` at every width, including desktop — it used to
            switch to `min-[900px]:flex-col`, stacking sound/status/vote vertically for no
            functional reason and eating ~100-150px of vertical space the desktop board formula
            above now needs back. */}
        <div className="sticky top-0 z-20 flex w-screen flex-row flex-wrap items-center justify-center gap-2 bg-bg py-2 min-[900px]:static min-[900px]:w-auto min-[900px]:bg-transparent min-[900px]:py-0">
          <SoundToggle enabled={soundEnabled} onToggle={onToggleSound} />
          <p
            data-testid="game-status"
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${
              !isFinished && isYourTurn ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-text-muted'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${!isFinished && isYourTurn ? 'bg-accent' : 'bg-text-dim'}`} />
            {statusText}
          </p>
          {teammateDisconnected && (
            <p data-testid="teammate-disconnected" className="text-sm text-warning">
              {teammateUsername} disconnected — you can move alone
            </p>
          )}
          <VoteActions
            yourTeam={yourTeam}
            you={view.you}
            gameStatus={game.status}
            pendingVotes={game.pendingVotes}
            drawOffer={game.drawOffer}
            requiresConfirmation={needsConfirmation}
            onVote={onVote}
          />
        </div>
        {/* §5.7: promotion is never offered here — `onPromote` omitted — since it's
            rejected outside LOBBY/TEAM_SELECT anyway (roomEngine.promoteSpectator). */}
        <Spectators spectators={view.spectators} seats={view.seats} />

        {/* One sizing wrapper carries `BOARD_SIZE_CLASSNAME` for all three children instead of
            repeating the calc() on each — `Board` just takes `w-full`. Default `align-items:
            stretch` is what keeps the name/clock rows aligned with the board's own edges. §5.5's
            player-name bars ("[Team 2: alice, bob]" above the board, "[Team 1: you, carol]"
            below) stay desktop-only (`hidden … min-[900px]:block`); each row is gated on the
            roster or the clock, not on `showClocks` alone, so names still show in an Unlimited
            game. On mobile the wrapper is just a centered `Clock` per row — pixel-identical to
            before this merge. */}
        <div className={`${BOARD_SIZE_CLASSNAME} flex flex-col gap-4 min-[900px]:gap-3`}>
          {(topRoster.length > 0 || showClocks) && (
            <div className="flex items-center justify-center gap-3 min-[900px]:justify-between">
              {topRoster.length > 0 && <PlayerBar team={top} roster={topRoster} />}
              {showClocks && (
                <Clock
                  clock={game.clock}
                  team={top}
                  sideToMove={game.sideToMove}
                  serverClockOffsetMs={serverClockOffsetMs}
                  active={game.status === 'ACTIVE' && game.sideToMove === top}
                />
              )}
            </div>
          )}
          <Board
            serverFen={game.fen}
            orientation={orientation}
            onMove={locked ? undefined : onMove}
            locked={locked}
            proposal={boardProposal}
            annotations={view.annotations}
            ownAnnotationColor={ownAnnotationColor}
            annotationColors={yourTeam ? ANNOTATION_COLORS[yourTeam] : undefined}
            onAnnotationsChange={onAnnotate}
            sizeClassName="w-full"
          />
          {(bottomRoster.length > 0 || showClocks) && (
            <div className="flex items-center justify-center gap-3 min-[900px]:justify-between">
              {bottomRoster.length > 0 && <PlayerBar team={bottom} roster={bottomRoster} />}
              {showClocks && (
                <Clock
                  clock={game.clock}
                  team={bottom}
                  sideToMove={game.sideToMove}
                  serverClockOffsetMs={serverClockOffsetMs}
                  active={game.status === 'ACTIVE' && game.sideToMove === bottom}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* `items-stretch` on the row above makes this match the board column's own rendered
          height (header through bottom player-name bar) instead of the old flat `h-[80dvh]`
          guess — that mismatch was why chat read as floating "way above" the board. `max-h`
          is just a ceiling so the panel's own minimum content (TeamPanel buttons + chat input)
          can never push the page past the viewport on a very short window; `Chat`'s existing
          internal `overflow-y-auto` absorbs that instead. */}
      <Panel
        data-testid="side-panel"
        className="hidden min-h-0 w-72 flex-col min-[900px]:flex min-[900px]:max-h-[calc(100dvh_-_48px)]"
      >
        <TeamPanel {...teamPanelProps} />
        <div className="flex min-h-0 flex-1 flex-col border-t border-line">
          <Chat {...chatProps} />
        </div>
      </Panel>

      <BottomSheet teamPanel={teamPanelProps} chat={chatProps} />
    </main>
  );
}

interface PlayerBarProps {
  team: Team;
  roster: PublicSeat[];
}

/**
 * §5.5's player-name bar, restyled to match Team Select's own "team identity" language (a
 * `TEAM_ACCENT`-tinted `Crown` plus a matching border, `TeamSelect.tsx`'s `TeamColumn`) instead
 * of the plain `text-xs text-text-dim` line it replaces. Deliberately stays under the `Clock`
 * badge's 44px (`border-2 px-4 py-1.5 text-xl`) that `BOARD_SIZE_CLASSNAME`'s chrome tally is
 * already budgeting for `44` — this pill is `border` 2 + `py-1.5` 12 + `text-sm` 20 = 34px, so
 * the board-sizing formula above needs no change. `truncate`/`whitespace-nowrap` guard the one
 * way this could still blow the tally: wrapping to a second line on a long roster.
 */
function PlayerBar({ team, roster }: PlayerBarProps) {
  return (
    <p
      data-testid={`player-bar-${team.toLowerCase()}`}
      className="hidden min-w-0 items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-surface px-3 py-1.5 min-[900px]:flex"
      style={{ borderLeftColor: TEAM_ACCENT[team], borderLeftWidth: '3px' }}
    >
      <Crown className="h-4 w-4 shrink-0" style={{ color: TEAM_ACCENT[team] }} aria-hidden="true" />
      <span className="font-display text-sm font-semibold text-text-muted">
        {team === 'WHITE' ? 'Team 1 — White' : 'Team 2 — Black'}
      </span>
      <span className="text-text-dim" aria-hidden="true">
        ·
      </span>
      <span className="truncate text-sm font-semibold text-text">{roster.map((s) => s.username).join(', ')}</span>
    </p>
  );
}
